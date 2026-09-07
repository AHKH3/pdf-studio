import { baseName, humanSize, isPdfFile, saveFile, withExtension } from "../../lib/files.js";
import { endProgress, isCancellation, startProgress, toast } from "../../ui/feedback.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { confirmDiscard, confirmReplace, readPdfFile, reportFailure as reportFailureToChrome, reportSave as reportSaveToChrome, tabTitle, uid } from "../shared.js";
import { createBoard } from "./board.js";
import { clampBox } from "./coords.js";
import { flattenObjects } from "./flatten.js";
import { rasterizeImageFile } from "./text-png.js";
import { buildUi, injectStyles, removeStyles } from "./ui.js";

export const id = "edit";
export const title = "تعديل PDF";

const session = {
  /** @type {HTMLElement | null} */
  root: null,
  /** @type {AbortController | null} */
  ac: null,
  /** @type {ReturnType<typeof buildUi> | null} */
  ui: null,
  /** @type {ReturnType<typeof createBoard> | null} */
  board: null,
  fileName: "",
  /** @type {Uint8Array | null} */
  bytes: null,
  pages: 0,
  size: 0,
  pageIndex: 0,
  /** @type {any[]} */
  objects: [],
  /** @type {string[]} */
  selectedIds: [],
  saved: true,
  /** @type {any[][]} */
  history: [],
  /** @type {any[][]} */
  redoStack: [],
  historyBatch: false,
  syncing: false,
  zoom: 1,
  /** @type {"width" | "page"} */
  fitMode: "width",
  /** @type {IntersectionObserver | null} */
  pagesObserver: null,
  /** @type {Map<number, HTMLCanvasElement>} */
  thumbCache: new Map()
};

function hasTitleblock() {
  return Boolean(document.getElementById("tb-run"));
}

/** @param {unknown} error @param {string} fallbackMessage */
function reportFailure(error, fallbackMessage) {
  if (!hasTitleblock()) {
    if (isCancellation(error)) {
      toast("تم إيقاف العملية.", "info");
      return;
    }
    console.error(error);
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    toast(`${fallbackMessage}${detail}`, "error");
    return;
  }
  reportFailureToChrome(error, fallbackMessage);
}

/** @param {boolean} saved @param {string} message */
function reportSave(saved, message) {
  if (!hasTitleblock()) {
    toast(saved ? message : "أُلغي الحفظ", saved ? "done" : "info");
    return;
  }
  reportSaveToChrome(saved, message);
}

export function suggestedName() {
  const fromBlock = hasTitleblock() ? getName() : "";
  if (fromBlock) return withExtension(fromBlock, "pdf");
  return withExtension(`${baseName(session.fileName || "مستند")}-محرّر`, "pdf");
}

export function syncChrome() {
  if (!hasTitleblock()) return;
  if (session.bytes) {
    setSource({
      label: session.fileName,
      pages: String(session.pages),
      size: humanSize(session.size)
    });
    setName(`${baseName(session.fileName)}-محرّر.pdf`);
    setRunEnabled(session.objects.length > 0);
    setState(session.objects.length ? "idle" : "waiting");
  } else {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
  }
}

/** Board-level drawing tool: the unified "shapes" tool maps to its kind. */
function activeShapeKind() {
  const picked = session.root?.querySelector('input[name="edit-shape"]:checked');
  const value = /** @type {HTMLInputElement | null} */ (picked)?.value;
  return value === "ellipse" || value === "triangle" ? value : "rect";
}

function activeTool() {
  const picked = session.root?.querySelector('input[name="edit-tool"]:checked');
  const value = /** @type {HTMLInputElement | null} */ (picked)?.value || "select";
  if (value === "shapes") return activeShapeKind();
  if (value === "rect" || value === "ellipse" || value === "triangle") return value;
  if (value === "select" || value === "pen") return value;
  return "text";
}

function activePanel() {
  const picked = session.root?.querySelector('input[name="edit-tool"]:checked');
  const value = /** @type {HTMLInputElement | null} */ (picked)?.value || "select";
  if (value === "rect" || value === "ellipse" || value === "triangle" || value === "shapes") return "shapes";
  if (value === "select" || value === "pen" || value === "text") return value;
  return "text";
}

function activeAlign() {
  const picked = session.root?.querySelector('input[name="edit-align"]:checked');
  return /** @type {HTMLInputElement | null} */ (picked)?.value || "right";
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getStyle() {
  const ui = session.ui;
  return {
    fontSize: Math.min(96, Math.max(10, finiteNumber(ui?.textSize.value, 18))),
    textColor: ui?.textColor.value || "#1E3A8A",
    bold: Boolean(ui?.textBold.checked),
    italic: Boolean(ui?.textItalic?.checked),
    underline: Boolean(ui?.textUnderline?.checked),
    align: activeAlign(),
    penColor: ui?.penColor.value || "#1E3A8A",
    penWeight: finiteNumber(ui?.penWeight.value, 2.2),
    fillOn: Boolean(ui?.fillOn.checked),
    fill: ui?.fillColor.value || "#8AA4E0",
    stroke: ui?.strokeColor.value || "#1E3A8A",
    strokeWidth: Math.max(0, finiteNumber(ui?.strokeWidth.value, 1.5))
  };
}

/** @param {string[]} ids */
function setSelectedIds(ids) {
  const next = [...new Set(ids)].filter((id) => session.objects.some((obj) => obj.id === id));
  const prev = session.selectedIds;
  const prevPrimary = prev[prev.length - 1] || "";
  const nextPrimary = next[next.length - 1] || "";
  if (prev.length === next.length && prev.every((id, i) => id === next[i])) return;
  if (prevPrimary !== nextPrimary) pruneEmptyText(prevPrimary, nextPrimary);
  session.selectedIds = next;
}

function selectedObjects() {
  const set = new Set(session.selectedIds);
  return session.objects.filter((obj) => set.has(obj.id));
}

function singleSelectedObject() {
  if (session.selectedIds.length !== 1) return null;
  return session.objects.find((obj) => obj.id === session.selectedIds[0]) || null;
}

function showPanels() {
  const panel = activePanel();
  for (const node of session.root?.querySelectorAll("[data-edit-panel]") ?? []) {
    /** @type {HTMLElement} */ (node).hidden = node.getAttribute("data-edit-panel") !== panel;
  }
}

function cloneObjects(list) {
  return list.map((obj) => ({
    ...obj,
    points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined
  }));
}

function pushHistory() {
  session.history.push(cloneObjects(session.objects));
  if (session.history.length > 40) session.history.shift();
  session.redoStack = [];
}

function beginChange() {
  if (session.historyBatch) return;
  pushHistory();
  session.historyBatch = true;
}

function breakChange() {
  session.historyBatch = false;
}

function discardLastHistory() {
  session.history.pop();
  session.historyBatch = false;
}

function revokeUnusedUrls(previous, next) {
  const keep = new Set(next.filter((obj) => obj.url).map((obj) => obj.url));
  for (const obj of previous) {
    if (obj.url && !keep.has(obj.url)) URL.revokeObjectURL(obj.url);
  }
}

function undo() {
  if (!session.history.length) {
    toast("لا يوجد تراجع.", "info");
    return;
  }
  breakChange();
  session.redoStack.push(cloneObjects(session.objects));
  if (session.redoStack.length > 40) session.redoStack.shift();
  const previous = session.objects;
  session.objects = session.history.pop() || [];
  revokeUnusedUrls(previous, session.objects);
  session.selectedIds = session.selectedIds.filter((id) => session.objects.some((obj) => obj.id === id));
  session.saved = false;
  refresh();
}

function redo() {
  if (!session.redoStack.length) {
    toast("لا يوجد إعادة.", "info");
    return;
  }
  breakChange();
  session.history.push(cloneObjects(session.objects));
  if (session.history.length > 40) session.history.shift();
  const previous = session.objects;
  session.objects = session.redoStack.pop() || [];
  revokeUnusedUrls(previous, session.objects);
  session.selectedIds = session.selectedIds.filter((id) => session.objects.some((obj) => obj.id === id));
  session.saved = false;
  refresh();
}

function refresh(overlay = true) {
  if (overlay) session.board?.paintOverlay();
  session.board?.syncTool();
  showPanels();
  syncInspectorFromSelection();
  renderLayers();
  updateZoomLabel();
  if (session.ui?.count) {
    session.ui.count.textContent = `${session.pageIndex + 1} / ${session.pages || 1}`;
  }
  if (session.ui?.prev) session.ui.prev.disabled = session.pageIndex <= 0;
  if (session.ui?.next) session.ui.next.disabled = session.pageIndex >= session.pages - 1;
  if (session.ui?.save) session.ui.save.disabled = session.objects.length === 0;
  const hasSel = session.selectedIds.length > 0;
  if (session.ui?.remove) session.ui.remove.disabled = !hasSel;
  if (session.ui?.dup) session.ui.dup.disabled = !hasSel;
  if (session.ui?.front) session.ui.front.disabled = !hasSel;
  if (session.ui?.back) session.ui.back.disabled = !hasSel;
  if (session.ui?.clearSel) session.ui.clearSel.disabled = !hasSel;
  if (session.ui?.selCount) {
    session.ui.selCount.textContent = hasSel ? `${session.selectedIds.length} محدد` : "لا تحديد";
  }
  if (session.ui?.layersCount) {
    session.ui.layersCount.textContent = session.objects.length ? String(session.objects.length) : "";
  }
  if (session.ui?.undo) session.ui.undo.disabled = session.history.length === 0;
  if (session.ui?.redo) session.ui.redo.disabled = session.redoStack.length === 0;
  markActivePage();
  syncChrome();
}

function layerLabel(obj) {
  if (obj.type === "text") return obj.text ? `نص: ${String(obj.text).trim().slice(0, 20)}` : "نص فارغ";
  if (obj.type === "ink") return "رسم حر";
  if (obj.type === "image") return obj.label ? `صورة: ${String(obj.label).slice(0, 16)}` : "صورة";
  if (obj.kind === "ellipse") return "دائرة";
  if (obj.kind === "triangle") return "مثلث";
  return "مستطيل";
}

function layerIcon(obj) {
  if (obj.type === "text") return "icon-file";
  if (obj.type === "ink") return "icon-sign";
  if (obj.type === "image") return "icon-images";
  return "icon-crop";
}

function renderLayers() {
  const host = session.ui?.layers;
  if (!host) return;
  host.replaceChildren();
  const selected = new Set(session.selectedIds);
  const byPage = new Map();
  for (const obj of session.objects) {
    if (!byPage.has(obj.pageIndex)) byPage.set(obj.pageIndex, []);
    byPage.get(obj.pageIndex).push(obj);
  }
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const group = document.createElement("div");
    const head = document.createElement("div");
    head.className = `edit-layers__page${page === session.pageIndex ? " is-current" : ""}`;
    head.textContent = `صفحة ${page + 1}`;
    group.append(head);
    for (const obj of byPage.get(page)) {
      const row = document.createElement("div");
      row.className = `edit-layer-row${selected.has(obj.id) ? " is-selected" : ""}`;
      row.dataset.id = obj.id;
      row.draggable = true;
      row.innerHTML =
        `<span class="edit-layer-row__grip"><svg class="icon" aria-hidden="true"><use href="#icon-grip"></use></svg></span>` +
        `<svg class="icon" aria-hidden="true"><use href="#${layerIcon(obj)}"></use></svg>` +
        `<span class="edit-layer-row__name"></span>` +
        `<button class="edit-layer-row__btn" aria-label="مضاعفة" data-dup="${obj.id}"><svg class="icon" aria-hidden="true"><use href="#icon-plus"></use></svg></button>` +
        `<button class="edit-layer-row__btn edit-layer-row__btn--del" aria-label="حذف" data-del="${obj.id}"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg></button>`;
      row.querySelector(".edit-layer-row__name").textContent = layerLabel(obj);
      row.addEventListener("click", (e) => {
        const dup = e.target.closest("[data-dup]");
        if (dup) {
          e.stopPropagation();
          duplicateObjects([obj.id]);
          return;
        }
        const del = e.target.closest("[data-del]");
        if (del) {
          e.stopPropagation();
          deleteObjects([obj.id]);
          return;
        }
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          const next = selected.has(obj.id)
            ? session.selectedIds.filter((item) => item !== obj.id)
            : [...session.selectedIds, obj.id];
          setSelectedIds(next);
        } else {
          setSelectedIds([obj.id]);
        }
        if (obj.pageIndex !== session.pageIndex) {
          void goTo(obj.pageIndex);
          return;
        }
        refresh(false);
      });
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", obj.id);
        row.style.opacity = "0.5";
      });
      row.addEventListener("dragend", () => { row.style.opacity = ""; });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === obj.id) return;
        const draggedIndex = session.objects.findIndex((o) => o.id === draggedId && o.pageIndex === obj.pageIndex);
        const targetIndex = session.objects.findIndex((o) => o.id === obj.id && o.pageIndex === obj.pageIndex);
        if (draggedIndex < 0 || targetIndex < 0) return;
        breakChange();
        pushHistory();
        const [dragged] = session.objects.splice(draggedIndex, 1);
        const newTarget = session.objects.findIndex((o) => o.id === obj.id && o.pageIndex === obj.pageIndex);
        session.objects.splice(newTarget, 0, dragged);
        session.saved = false;
        refresh();
      });
      group.append(row);
    }
    host.append(group);
  }
}

/* ——— pages rail: sharp lazy thumbnails ——— */

function buildPages() {
  const host = session.ui?.pages;
  if (!host) return;
  session.pagesObserver?.disconnect();
  session.pagesObserver = null;
  session.thumbCache.clear();
  host.replaceChildren();
  if (!session.pages) return;
  session.pagesObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const holder = /** @type {HTMLElement} */ (entry.target);
        session.pagesObserver?.unobserve(holder);
        void paintThumb(holder);
      }
    },
    { root: host, rootMargin: "240px 0px" }
  );
  for (let i = 0; i < session.pages; i += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edit-page";
    btn.dataset.page = String(i);
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", `صفحة ${i + 1}`);
    const holder = document.createElement("span");
    holder.className = "edit-page__img";
    holder.dataset.page = String(i);
    holder.textContent = `${i + 1}`;
    const num = document.createElement("span");
    num.className = "edit-page__num num";
    num.textContent = String(i + 1);
    btn.append(holder, num);
    btn.addEventListener("click", () => {
      if (i !== session.pageIndex) void goTo(i);
    });
    host.append(btn);
    session.pagesObserver.observe(holder);
  }
  markActivePage();
}

async function paintThumb(holder) {
  const index = Number(holder.dataset.page);
  if (!Number.isInteger(index)) return;
  if (holder.querySelector("canvas")) return;
  const cached = session.thumbCache.get(index);
  if (cached) {
    holder.replaceChildren(cached);
    return;
  }
  const thumb = await session.board?.renderThumb(index, 336);
  if (!thumb || !holder.isConnected || holder.querySelector("canvas")) return;
  session.thumbCache.set(index, thumb);
  holder.replaceChildren(thumb);
}

function markActivePage() {
  const host = session.ui?.pages;
  if (!host) return;
  for (const node of host.children) {
    if (node instanceof HTMLElement) {
      node.classList.toggle("is-active", Number(node.dataset.page) === session.pageIndex);
    }
  }
  host.querySelector(".edit-page.is-active")?.scrollIntoView({ block: "nearest" });
}

function updateZoomLabel() {
  if (session.ui?.zoomLabel) session.ui.zoomLabel.textContent = `${Math.round(session.zoom * 100)}%`;
}

function setZoom(value) {
  session.zoom = Math.max(0.5, Math.min(2.5, value));
  session.board?.setZoom?.(session.zoom);
  updateZoomLabel();
}

/** @param {"width" | "page"} mode */
function setFitMode(mode) {
  if (mode !== "width" && mode !== "page") return;
  session.fitMode = mode;
  session.board?.setFitMode?.(mode);
  for (const input of session.root?.querySelectorAll('input[name="edit-fit"]') ?? []) {
    /** @type {HTMLInputElement} */ (input).checked = input.value === mode;
  }
  saveStylePrefs();
}

function syncInspectorFromSelection() {
  const obj = singleSelectedObject();
  const ui = session.ui;
  if (!ui || session.syncing) return;
  session.syncing = true;
  try {
    if (obj?.type === "text") {
      ui.text.value = obj.text || "";
      ui.textSize.value = String(obj.fontSize || 18);
      ui.textColor.value = obj.color || "#1E3A8A";
      ui.textBold.checked = Boolean(obj.bold);
      ui.textItalic.checked = Boolean(obj.italic);
      ui.textUnderline.checked = Boolean(obj.underline);
      const align = obj.align || "right";
      for (const input of session.root?.querySelectorAll('input[name="edit-align"]') ?? []) {
        /** @type {HTMLInputElement} */ (input).checked = input.value === align;
      }
    } else if (obj?.type === "ink") {
      ui.penColor.value = obj.color || "#1E3A8A";
      ui.penWeight.value = String(obj.strokeWidth || 2.2);
    } else if (obj?.type === "shape") {
      const kind = obj.kind === "ellipse" || obj.kind === "triangle" ? obj.kind : "rect";
      for (const input of session.root?.querySelectorAll('input[name="edit-shape"]') ?? []) {
        /** @type {HTMLInputElement} */ (input).checked = input.value === kind;
      }
      ui.fillOn.checked = obj.fillOn !== false;
      ui.fillColor.value = obj.fill || "#8AA4E0";
      ui.strokeColor.value = obj.stroke || "#1E3A8A";
      ui.strokeWidth.value = String(obj.strokeWidth ?? 1.5);
    }
  } finally {
    session.syncing = false;
  }
  updateStyleChips();
}

const STYLE_KEY = "pdfstudio.edit.style.v1";

function loadStylePrefs() {
  try {
    return JSON.parse(localStorage.getItem(STYLE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveStylePrefs() {
  const ui = session.ui;
  if (!ui) return;
  try {
    const picked = session.root?.querySelector('input[name="edit-tool"]:checked');
    localStorage.setItem(
      STYLE_KEY,
      JSON.stringify({
        tool: /** @type {HTMLInputElement | null} */ (picked)?.value || "select",
        shape: activeShapeKind(),
        fit: session.fitMode,
        textSize: ui.textSize.value,
        textColor: ui.textColor.value,
        bold: ui.textBold.checked,
        italic: ui.textItalic?.checked ?? false,
        underline: ui.textUnderline?.checked ?? false,
        align: activeAlign(),
        penColor: ui.penColor.value,
        penWeight: ui.penWeight.value,
        fillOn: ui.fillOn.checked,
        fill: ui.fillColor.value,
        stroke: ui.strokeColor.value,
        strokeWidth: ui.strokeWidth.value
      })
    );
  } catch {
    /* التخزين غير متاح */
  }
}

function applySavedStyle() {
  const ui = session.ui;
  const saved = loadStylePrefs();
  if (!ui || !saved) return;
  if (saved.tool) {
    const radio = session.root?.querySelector(`input[name="edit-tool"][value="${saved.tool}"]`);
    if (radio instanceof HTMLInputElement) radio.checked = true;
    else if (saved.tool === "rect" || saved.tool === "ellipse" || saved.tool === "triangle") {
      const shapes = session.root?.querySelector('input[name="edit-tool"][value="shapes"]');
      if (shapes instanceof HTMLInputElement) shapes.checked = true;
    }
  }
  const shape = saved.shape === "ellipse" || saved.shape === "triangle" ? saved.shape : saved.tool;
  if (shape === "rect" || shape === "ellipse" || shape === "triangle") {
    const radio = session.root?.querySelector(`input[name="edit-shape"][value="${shape}"]`);
    if (radio instanceof HTMLInputElement) radio.checked = true;
  }
  const fit = saved.fit === "page" ? "page" : "width";
  session.fitMode = fit;
  for (const input of session.root?.querySelectorAll('input[name="edit-fit"]') ?? []) {
    /** @type {HTMLInputElement} */ (input).checked = input.value === fit;
  }
  if (saved.textSize) ui.textSize.value = String(saved.textSize);
  if (saved.textColor) ui.textColor.value = saved.textColor;
  if (typeof saved.bold === "boolean") ui.textBold.checked = saved.bold;
  if (typeof saved.italic === "boolean" && ui.textItalic) ui.textItalic.checked = saved.italic;
  if (typeof saved.underline === "boolean" && ui.textUnderline) ui.textUnderline.checked = saved.underline;
  if (saved.align) {
    for (const input of session.root?.querySelectorAll('input[name="edit-align"]') ?? []) {
      /** @type {HTMLInputElement} */ (input).checked = input.value === saved.align;
    }
  }
  if (saved.penColor) ui.penColor.value = saved.penColor;
  if (saved.penWeight) ui.penWeight.value = String(saved.penWeight);
  if (typeof saved.fillOn === "boolean") ui.fillOn.checked = saved.fillOn;
  if (saved.fill) ui.fillColor.value = saved.fill;
  if (saved.stroke) ui.strokeColor.value = saved.stroke;
  if (saved.strokeWidth !== undefined) ui.strokeWidth.value = String(saved.strokeWidth);
}

const SHAPE_PRESETS = {
  highlight: { fillOn: true, fill: "#FDE68A", stroke: "#FDE68A", strokeWidth: 0 },
  frame: { fillOn: false, fill: "#BFDBFE", stroke: "#DC2626", strokeWidth: 2 },
  fill: { fillOn: true, fill: "#BFDBFE", stroke: "#1E3A8A", strokeWidth: 1.5 },
  cover: { fillOn: true, fill: "#FFFFFF", stroke: "#FFFFFF", strokeWidth: 0 }
};

function updateStyleChips() {
  const root = session.root;
  const ui = session.ui;
  if (!root || !ui) return;
  for (const swatch of root.querySelectorAll("[data-swatch]")) {
    const input = document.getElementById(/** @type {HTMLElement} */ (swatch).dataset.for || "");
    swatch.classList.toggle(
      "is-active",
      input instanceof HTMLInputElement && input.value.toLowerCase() === /** @type {HTMLElement} */ (swatch).dataset.swatch?.toLowerCase()
    );
  }
  for (const chip of root.querySelectorAll("[data-size-chip]")) {
    chip.classList.toggle("is-active", ui.textSize.value === /** @type {HTMLElement} */ (chip).dataset.sizeChip);
  }
}

function setStyleInput(inputId, value, eventName) {
  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  input.dispatchEvent(new Event(eventName, { bubbles: true }));
  updateStyleChips();
}

function applyInspectorToSelection() {
  if (session.syncing) return;
  const obj = singleSelectedObject();
  if (!obj || (obj.type !== "text" && obj.type !== "ink" && obj.type !== "shape")) return;
  beginChange();
  const style = getStyle();
  if (obj.type === "text") {
    obj.text = session.ui?.text.value ?? obj.text;
    obj.fontSize = style.fontSize;
    obj.color = style.textColor;
    obj.bold = style.bold;
    obj.italic = style.italic;
    obj.underline = style.underline;
    obj.align = style.align;
    session.board?.syncSelectedText?.(obj.text);
    session.saved = false;
    refresh();
    // The box grows to fit: style changes can never clip (look "deleted").
    session.board?.fitSelectedBox?.();
    refresh(false);
    return;
  } else if (obj.type === "ink") {
    obj.color = style.penColor;
    obj.strokeWidth = style.penWeight;
  } else if (obj.type === "shape") {
    obj.fillOn = style.fillOn;
    obj.fill = style.fill;
    obj.stroke = style.stroke;
    obj.strokeWidth = style.strokeWidth;
  }
  session.saved = false;
  refresh();
}

function createObject(partial) {
  if (!session.board || !session.board.visualWidth || !session.board.visualHeight) {
    toast("انتظر اكتمال تحميل الصفحة.", "info");
    return;
  }
  const previousPrimary = session.selectedIds[session.selectedIds.length - 1] || "";
  // The object always lands on the page the user actually sees: never trust a
  // stale pageIndex, or edits silently end up on the wrong page of the output.
  const pageIndex = session.board.getPageIndex?.() ?? session.pageIndex;
  const obj = {
    id: uid("edit"),
    rotation: 0,
    ...partial,
    pageIndex
  };
  pruneEmptyText(previousPrimary, obj.id);
  clampBox(obj, session.board.visualWidth, session.board.visualHeight);
  if (obj.type === "image") obj.aspect = obj.width / Math.max(1, obj.height);
  breakChange();
  session.objects.push(obj);
  session.selectedIds = [obj.id];
  session.saved = false;
  refresh();
  if (obj.type === "text") {
    queueMicrotask(() => session.board?.focusSelectedText());
  }
  // No auto-switch to the select tool: each tool keeps working directly.
}

function pruneEmptyText(previousId, nextId) {
  if (!previousId || previousId === nextId) return;
  const index = session.objects.findIndex(
    (obj) => obj.id === previousId && obj.type === "text" && !String(obj.text || "").trim()
  );
  if (index < 0) return;
  const [removed] = session.objects.splice(index, 1);
  if (removed.url && !session.objects.some((obj) => obj.url === removed.url)) {
    URL.revokeObjectURL(removed.url);
  }
  session.saved = false;
}

/** @param {string[]} ids */
function deleteObjects(ids) {
  const set = new Set(ids);
  const doomed = session.objects.filter((obj) => set.has(obj.id));
  if (!doomed.length) return;
  breakChange();
  pushHistory();
  session.objects = session.objects.filter((obj) => !set.has(obj.id));
  session.selectedIds = session.selectedIds.filter((id) => !set.has(id));
  revokeUnusedUrls(doomed, session.objects);
  session.saved = false;
  refresh();
}

/** @param {string[]} ids */
function duplicateObjects(ids) {
  const set = new Set(ids);
  const sources = session.objects.filter((obj) => set.has(obj.id));
  if (!sources.length) return;
  breakChange();
  pushHistory();
  const clones = sources.map((obj) => {
    const clone = {
      ...obj,
      id: uid("edit"),
      points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined,
      x: obj.x + 12,
      y: obj.y + 12
    };
    if (session.board?.visualWidth && session.board?.visualHeight) {
      clampBox(clone, session.board.visualWidth, session.board.visualHeight);
    }
    return clone;
  });
  // Images share the same blob URL + bytes: no new object URLs to leak, and
  // revokeUnusedUrls keeps the shared URL alive while any clone uses it.
  for (const clone of clones) session.objects.push(clone);
  session.selectedIds = clones.map((clone) => clone.id);
  session.saved = false;
  refresh();
}

/**
 * Move the selection one step through the paint order of its page.
 * @param {1 | -1} dir +1 paints later (on top), -1 paints earlier.
 */
function reorderSelected(dir) {  const set = new Set(session.selectedIds);
  const targets = session.objects.filter((obj) => set.has(obj.id) && obj.pageIndex === session.pageIndex);
  if (!targets.length) return;
  breakChange();
  pushHistory();
  const order = dir > 0 ? targets.slice().reverse() : targets.slice();
  let moved = false;
  for (const obj of order) {
    const index = session.objects.findIndex((o) => o.id === obj.id);
    const swap = index + dir;
    if (index < 0 || swap < 0 || swap >= session.objects.length) continue;
    if (session.objects[swap].pageIndex !== obj.pageIndex || set.has(session.objects[swap].id)) continue;
    [session.objects[index], session.objects[swap]] = [session.objects[swap], session.objects[index]];
    moved = true;
  }
  if (!moved) {
    discardLastHistory();
    return;
  }
  session.saved = false;
  refresh();
}

/** @param {number} factor >1 grows, <1 shrinks the whole selection */
function scaleSelection(factor) {
  if (!(factor > 0) || factor === 1 || !session.selectedIds.length) return;
  pushHistory();
  if (!session.board?.scaleSelected?.(factor)) discardLastHistory();
  else session.saved = false;
}

function deleteSelected() {
  deleteObjects(session.selectedIds);
}

async function goTo(index) {
  if (!session.board || index < 0 || index >= session.pages) return;
  session.pageIndex = index;
  await session.board.showPage(index);
  refresh();
}

function wireIntake(signal) {
  const { drop, browse, input } = session.ui;
  const accept = (fileList) => {
    const all = Array.from(fileList || []);
    const good = all.filter(isPdfFile);
    if (good.length < all.length) toast("تم تجاهل ملفات ليست PDF.", "info");
    if (good[0]) loadFile(good[0]);
  };

  const open = () => input.click();
  browse.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      open();
    },
    { signal }
  );
  drop.addEventListener("click", open, { signal });
  drop.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    { signal }
  );
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");

  input.addEventListener(
    "change",
    () => {
      accept(input.files);
      input.value = "";
    },
    { signal }
  );

  let depth = 0;
  drop.addEventListener(
    "dragenter",
    (event) => {
      event.preventDefault();
      depth += 1;
      drop.classList.add("is-over");
    },
    { signal }
  );
  drop.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    { signal }
  );
  drop.addEventListener(
    "dragleave",
    () => {
      depth = Math.max(0, depth - 1);
      if (!depth) drop.classList.remove("is-over");
    },
    { signal }
  );
  drop.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      depth = 0;
      drop.classList.remove("is-over");
      accept(event.dataTransfer?.files);
    },
    { signal }
  );
}

async function resetObjects() {
  const urls = new Set(session.objects.map((obj) => obj.url).filter(Boolean));
  for (const url of urls) URL.revokeObjectURL(url);
  session.objects = [];
  session.selectedIds = [];
  session.history = [];
  session.redoStack = [];
  session.historyBatch = false;
  session.saved = true;
}

/** البايتات المحمّلة حاليًا في اللوحة (لتفادي إعادة التحميل عند العودة لنفس الملف). */
/** @type {Uint8Array | null} */
let boardBytes = null;

/** لقطة عمل التحرير (مراجع + كائنات) أو null. */
function captureEditState() {
  if (!session.bytes) return null;
  return {
    fileName: session.fileName,
    bytes: session.bytes,
    pages: session.pages,
    size: session.size,
    pageIndex: session.pageIndex,
    objects: session.objects.slice(),
    selectedIds: session.selectedIds.slice(),
    saved: session.saved,
    history: session.history.map((step) => step.slice()),
    redoStack: session.redoStack.map((step) => step.slice()),
    zoom: session.zoom,
    fitMode: session.fitMode
  };
}

/** @param {any} state */
async function restoreEditState(state) {
  // تفريغ لطيف بلا revoke — لقطات التابات الأخرى تشارك المراجع.
  if (!state) {
    session.fileName = "";
    session.bytes = null;
    session.pages = 0;
    session.size = 0;
    session.pageIndex = 0;
    session.objects = [];
    session.selectedIds = [];
  session.saved = true;
    session.history = [];
    session.redoStack = [];
    session.historyBatch = false;
    session.zoom = 1;
    session.fitMode = "width";
    boardBytes = null;
    if (session.ui) {
      session.ui.drop.hidden = false;
      session.ui.workspace.hidden = true;
    }
    syncChrome();
    return;
  }
  session.fileName = state.fileName;
  session.bytes = state.bytes;
  session.pages = state.pages;
  session.size = state.size;
  session.pageIndex = state.pageIndex;
  session.objects = state.objects.slice();
  session.selectedIds = Array.isArray(state.selectedIds)
    ? state.selectedIds.slice()
    : state.selectedId
      ? [state.selectedId]
      : [];
  session.saved = state.saved;
  session.history = state.history.map((step) => step.slice());
  session.redoStack = state.redoStack.map((step) => step.slice());
  session.historyBatch = false;
  session.zoom = state.zoom;
  session.fitMode = state.fitMode === "page" ? "page" : "width";
  if (session.board) {
    if (boardBytes !== session.bytes) {
      boardBytes = session.bytes;
      await session.board.load(session.bytes);
    }
    session.board.setZoom?.(session.zoom);
    session.board.setFitMode?.(session.fitMode);
    for (const input of session.root?.querySelectorAll('input[name="edit-fit"]') ?? []) {
      /** @type {HTMLInputElement} */ (input).checked = input.value === session.fitMode;
    }
    updateZoomLabel();
    if (session.ui) {
      session.ui.drop.hidden = true;
      session.ui.workspace.hidden = false;
    }
    await session.board.whenLaidOut?.();
    await session.board.showPage(session.pageIndex);
    buildPages();
    renderLayers();
  }
  syncChrome();
}

async function loadFile(file) {
  if (session.bytes && session.objects.length && !session.saved) {
    const ok = await confirmReplace(session.fileName);
    if (!ok) return;
  }
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    const loaded = await readPdfFile(file);
    if (!loaded) return;
    await resetObjects();
    const pages = await session.board.load(loaded.bytes);
    boardBytes = loaded.bytes;
    session.fileName = loaded.name;
    session.bytes = loaded.bytes;
    session.pages = pages;
    session.size = loaded.size;
    session.pageIndex = 0;
    session.zoom = 1;
    session.board.setZoom?.(1);
    updateZoomLabel();
    session.ui.drop.hidden = true;
    session.ui.workspace.hidden = false;
    await session.board.whenLaidOut?.();
    await session.board.showPage(0);
    buildPages();
    refresh();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

async function closeDocument() {
  if (session.objects.length && !session.saved) {
    const ok = await confirmDiscard(title);
    if (!ok) return;
  }
  await resetObjects();
  session.fileName = "";
  session.bytes = null;
  session.pages = 0;
  session.size = 0;
  session.pageIndex = 0;
  if (session.ui?.drop) session.ui.drop.hidden = false;
  if (session.ui?.workspace) session.ui.workspace.hidden = true;
  session.thumbCache.clear();
  await session.board?.clear();
  refresh();
}

function isOverlayImage(file) {
  return (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp" ||
    /\.(png|jpe?g|webp)$/i.test(file.name)
  );
}

async function pickImage(file) {
  if (!file || !isOverlayImage(file)) {
    toast("اختر صورة PNG أو JPG أو WEBP.", "info");
    return;
  }
  try {
    const image = await rasterizeImageFile(file);
    const pageIndex = session.board?.getPageIndex?.() ?? session.pageIndex;
    // A single selected image is replaced in place; otherwise a new layer.
    const current = singleSelectedObject();
    if (current?.type === "image" && current.pageIndex === pageIndex) {
      breakChange();
      pushHistory();
      const url = URL.createObjectURL(new Blob([image.bytes], { type: "image/png" }));
      const oldUrl = current.url;
      current.png = image.bytes;
      current.url = url;
      current.label = file.name;
      current.aspect = image.width / Math.max(1, image.height);
      current.height = current.width / current.aspect;
      if (session.board?.visualWidth && session.board?.visualHeight) {
        clampBox(current, session.board.visualWidth, session.board.visualHeight);
      }
      if (oldUrl && !session.objects.some((obj) => obj.url === oldUrl)) URL.revokeObjectURL(oldUrl);
      session.saved = false;
      refresh();
      return;
    }
    const pageW = session.board?.visualWidth || 400;
    const targetWidth = Math.min(180, pageW * 0.45);
    const aspect = image.width / Math.max(1, image.height);
    const height = targetWidth / aspect;
    const url = URL.createObjectURL(new Blob([image.bytes], { type: "image/png" }));
    pushHistory();
    createObject({
      type: "image",
      pageIndex,
      x: (pageW - targetWidth) / 2,
      y: 80,
      width: targetWidth,
      height,
      aspect,
      png: image.bytes,
      url,
      label: file.name
    });
  } catch (error) {
    reportFailure(error, "تعذّر قراءة الصورة.");
  }
}

function onRootKey(event) {
  const typing = event.target.closest?.("input, textarea, select");

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
    if (typing) return;
    event.preventDefault();
    undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
    if (typing) return;
    event.preventDefault();
    redo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    if (typing) return;
    event.preventDefault();
    duplicateObjects(session.selectedIds);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    if (typing || activeTool() !== "select") return;
    event.preventDefault();
    setSelectedIds(session.objects.filter((obj) => obj.pageIndex === session.pageIndex).map((obj) => obj.id));
    refresh(false);
    return;
  }

  if (typing) return;

  if (event.key === "Escape") {
    if (session.selectedIds.length) {
      event.preventDefault();
      setSelectedIds([]);
      refresh();
    }
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && session.selectedIds.length) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if ((event.key === "+" || event.key === "=") && session.selectedIds.length) {
    event.preventDefault();
    scaleSelection(1.1);
    return;
  }
  if ((event.key === "-" || event.key === "_") && session.selectedIds.length) {
    event.preventDefault();
    scaleSelection(1 / 1.1);
    return;
  }
  if (event.key === "0" && !session.selectedIds.length) {
    event.preventDefault();
    setFitMode("width");
    setZoom(1);
    session.board?.fit?.();
    return;
  }
  if (event.altKey && event.key === "ArrowUp" && session.selectedIds.length) {
    event.preventDefault();
    reorderSelected(1);
    return;
  }
  if (event.altKey && event.key === "ArrowDown" && session.selectedIds.length) {
    event.preventDefault();
    reorderSelected(-1);
    return;
  }
  const step = event.shiftKey ? 8 : 1;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    pushHistory();
    if (!session.board?.nudge(step, 0)) discardLastHistory();
    else session.saved = false;
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    pushHistory();
    if (!session.board?.nudge(-step, 0)) discardLastHistory();
    else session.saved = false;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    pushHistory();
    if (!session.board?.nudge(0, step)) discardLastHistory();
    else session.saved = false;
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    pushHistory();
    if (!session.board?.nudge(0, -step)) discardLastHistory();
    else session.saved = false;
  }
}

export async function run() {
  if (!session.bytes) {
    toast("افتح ملف PDF أولاً.", "info");
    return;
  }
  if (!session.objects.length) {
    toast("أضف نصاً أو رسماً أو شكلاً أو صورة أولاً.", "info");
    return;
  }
  if (hasTitleblock()) setState("busy");
  startProgress({ title: "حفظ التعديل", desc: "ندمج العناصر فوق الصفحات." });
  try {
    const bytes = await flattenObjects(session.bytes, session.objects);
    endProgress();
    const saved = await saveFile(bytes, suggestedName(), "pdf");
    if (saved) session.saved = true;
    reportSave(saved, `دُمج ${session.objects.length} عنصر في الملف.`);
  } catch (error) {
    reportFailure(error, "تعذّر حفظ الملف المحرَّر.");
  } finally {
    endProgress();
  }
}

/** @param {HTMLElement} rootEl */
export function mount(rootEl) {
  if (!rootEl) throw new Error("edit.mount يحتاج عنصر جذر.");
  unmount();

  injectStyles();
  session.root = rootEl;
  session.ac = new AbortController();
  const { signal } = session.ac;
  session.ui = buildUi(rootEl);

  session.board = createBoard({
    canvas: session.ui.canvas,
    layer: session.ui.layer,
    wrap: session.ui.wrap,
    getObjects: () => session.objects,
    getSelectedIds: () => session.selectedIds,
    setSelectedIds: (value) => {
      setSelectedIds(value);
    },
    getTool: activeTool,
    getStyle,
    onCreate: createObject,
    onZoomChange: (value) => {
      session.zoom = value;
      updateZoomLabel();
    },
    onChange: () => {
      session.saved = false;
      refresh(false);
    },
    onBeginChange: beginChange,
    onHistory: () => {
      breakChange();
      pushHistory();
    },
    onDiscardHistory: discardLastHistory
  });

  wireIntake(signal);
  applySavedStyle();
  session.board?.setFitMode?.(session.fitMode);
  showPanels();
  refresh();

  rootEl.addEventListener(
    "change",
    (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target instanceof HTMLInputElement && (target.name === "edit-tool" || target.name === "edit-shape")) {
        session.board?.syncTool();
        showPanels();
        saveStylePrefs();
        return;
      }
      if (target instanceof HTMLInputElement && target.name === "edit-fit") {
        setFitMode(target.value === "page" ? "page" : "width");
        return;
      }
      applyInspectorToSelection();
      saveStylePrefs();
    },
    { signal }
  );

  rootEl.addEventListener(
    "click",
    (event) => {
      const swatch = /** @type {HTMLElement} */ (event.target).closest?.("[data-swatch]");
      if (swatch?.dataset.for && swatch.dataset.swatch) {
        setStyleInput(swatch.dataset.for, swatch.dataset.swatch, "input");
        return;
      }
      const chip = /** @type {HTMLElement} */ (event.target).closest?.("[data-size-chip]");
      if (chip?.dataset.for && chip.dataset.sizeChip) {
        setStyleInput(chip.dataset.for, chip.dataset.sizeChip, "input");
        return;
      }
      const preset = /** @type {HTMLElement} */ (event.target).closest?.("[data-shape-preset]");
      const style = preset?.dataset.shapePreset ? SHAPE_PRESETS[preset.dataset.shapePreset] : null;
      const ui = session.ui;
      if (!style || !ui) return;
      ui.fillOn.checked = style.fillOn;
      ui.fillColor.value = style.fill;
      ui.strokeColor.value = style.stroke;
      ui.strokeWidth.value = String(style.strokeWidth);
      ui.fillOn.dispatchEvent(new Event("change", { bubbles: true }));
      ui.fillColor.dispatchEvent(new Event("input", { bubbles: true }));
      ui.strokeColor.dispatchEvent(new Event("input", { bubbles: true }));
      ui.strokeWidth.dispatchEvent(new Event("input", { bubbles: true }));
      saveStylePrefs();
    },
    { signal }
  );

  rootEl.addEventListener(
    "input",
    (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target === session.ui.text || target?.closest?.("[data-edit-panel]")) {
        applyInspectorToSelection();
      }
    },
    { signal }
  );

  rootEl.addEventListener("keydown", onRootKey, { signal });

  session.ui.undo.addEventListener("click", undo, { signal });
  session.ui.redo?.addEventListener("click", redo, { signal });
  session.ui.remove.addEventListener("click", deleteSelected, { signal });
  session.ui.dup?.addEventListener("click", () => duplicateObjects(session.selectedIds), { signal });
  session.ui.front?.addEventListener("click", () => reorderSelected(1), { signal });
  session.ui.back?.addEventListener("click", () => reorderSelected(-1), { signal });
  session.ui.clearSel?.addEventListener("click", () => {
    setSelectedIds([]);
    refresh();
  }, { signal });
  session.ui.save.addEventListener("click", () => run(), { signal });
  session.ui.clear.addEventListener("click", () => closeDocument(), { signal });
  session.ui.prev.addEventListener("click", () => goTo(session.pageIndex - 1), { signal });
  session.ui.next.addEventListener("click", () => goTo(session.pageIndex + 1), { signal });
  session.ui.imageAdd.addEventListener("click", () => session.ui.imageInput.click(), { signal });
  session.ui.imageInput.addEventListener(
    "change",
    () => {
      const file = session.ui.imageInput.files?.[0];
      session.ui.imageInput.value = "";
      if (file) pickImage(file);
    },
    { signal }
  );

  session.ui.zoomIn?.addEventListener("click", () => setZoom(session.zoom + 0.15), { signal });
  session.ui.zoomOut?.addEventListener("click", () => setZoom(session.zoom - 0.15), { signal });
  setZoom(1);
}

export function unmount() {
  session.ac?.abort();
  session.ac = null;
  session.pagesObserver?.disconnect();
  session.pagesObserver = null;
  session.thumbCache.clear();
  const urls = new Set(session.objects.map((obj) => obj.url).filter(Boolean));
  for (const url of urls) URL.revokeObjectURL(url);
  session.objects = [];
  session.selectedIds = [];
  session.history = [];
  session.redoStack = [];
  session.historyBatch = false;
  session.bytes = null;
  session.fileName = "";
  session.pages = 0;
  session.size = 0;
  session.pageIndex = 0;
  session.saved = true;
  session.zoom = 1;
  session.fitMode = "width";
  const board = session.board;
  const root = session.root;
  session.board = null;
  session.ui = null;
  session.root = null;
  void board?.destroy();
  if (root) {
    root.replaceChildren();
    root.classList.remove("edit-root");
  }
  removeStyles();
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file || !isPdfFile(file)) return;
  if (session.bytes && session.fileName === file.name && session.size === file.size) return;
  await loadFile(file);
}

/** @returns {import("../../ui/router.js").Tool} */
export function asTool() {
  return {
    id,
    name: "تعديل PDF",
    icon: "icon-edit",
    input: "PDF",
    actionLabel: "حفظ",
    tabTitle: () => tabTitle("تعديل PDF", session.fileName || ""),
    setup() {
      const root = document.getElementById("view-edit");
      if (root) mount(root);
    },
    enter() {
      syncChrome();
    },
    leave() {},
    isDirty: () => Boolean(session.bytes) && session.objects.length > 0 && !session.saved,
    captureState: () => captureEditState(),
    restoreState: (state) => restoreEditState(state),
    run,
    acceptFiles,
    outputName: suggestedName
  };
}
