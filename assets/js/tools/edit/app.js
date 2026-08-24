import { baseName, humanSize, isPdfFile, saveFile, withExtension } from "../../lib/files.js";
import { endProgress, isCancellation, startProgress, toast } from "../../ui/feedback.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { confirmDiscard, confirmReplace, readPdfFile, reportFailure as reportFailureToChrome, reportSave as reportSaveToChrome, uid } from "../shared.js";
import { createBoard } from "./board.js";
import { clampBox } from "./coords.js";
import { flattenObjects } from "./flatten.js";
import { rasterizeImageFile } from "./text-png.js";
import { buildUi, injectStyles, removeStyles } from "./ui.js";

export const id = "edit";
export const title = "تحرير";

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
  selectedId: "",
  saved: true,
  /** @type {any[][]} */
  history: [],
  historyBatch: false,
  syncing: false,
  zoom: 1
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

function activeTool() {
  const picked = session.root?.querySelector('input[name="edit-tool"]:checked');
  return /** @type {HTMLInputElement | null} */ (picked)?.value || "select";
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
    align: activeAlign(),
    penColor: ui?.penColor.value || "#1E3A8A",
    penWeight: finiteNumber(ui?.penWeight.value, 2.2),
    fillOn: Boolean(ui?.fillOn.checked),
    fill: ui?.fillColor.value || "#8AA4E0",
    stroke: ui?.strokeColor.value || "#1E3A8A",
    strokeWidth: Math.max(0, finiteNumber(ui?.strokeWidth.value, 1.5))
  };
}

function selectedObject() {
  return session.objects.find((obj) => obj.id === session.selectedId) || null;
}

function showPanels() {
  const tool = activeTool();
  const selected = selectedObject();
  /** @type {string} */
  let panel = "";
  if (selected?.type === "text" || tool === "text") panel = "text";
  else if (selected?.type === "ink" || tool === "pen") panel = "pen";
  else if (selected?.type === "shape" || tool === "rect" || tool === "ellipse" || tool === "triangle") {
    panel = "shape";
  } else if (selected?.type === "image" || tool === "image") panel = "image";

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
  const previous = session.objects;
  session.objects = session.history.pop() || [];
  revokeUnusedUrls(previous, session.objects);
  if (!session.objects.some((obj) => obj.id === session.selectedId)) session.selectedId = "";
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
  if (session.ui?.remove) session.ui.remove.disabled = !session.selectedId;
  if (session.ui?.undo) session.ui.undo.disabled = session.history.length === 0;
  syncChrome();
}

function renderLayers() {
  const host = session.ui?.layers;
  if (!host) return;
  host.replaceChildren();
  const currentPageObjects = session.objects.filter((obj) => obj.pageIndex === session.pageIndex);
  for (const obj of currentPageObjects) {
    const row = document.createElement("div");
    row.className = `edit-layer-row${obj.id === session.selectedId ? " is-selected" : ""}`;
    row.dataset.id = obj.id;
    const iconMap = { text: "icon-file", ink: "icon-sign", shape: "icon-crop", image: "icon-images", select: "icon-quad" };
    const labelMap = { text: obj.text ? `نص: ${String(obj.text).slice(0, 18)}` : "نص", ink: "قلم", shape: obj.type === "shape" ? "شكل" : "شكل", image: obj.label || "صورة" };
    const icon = iconMap[obj.type] || "icon-file";
    const label = labelMap[obj.type] || obj.type;
    row.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${icon}"></use></svg><span class="edit-layer-row__name">${label}</span><button class="edit-layer-row__del" aria-label="حذف" data-del="${obj.id}"><svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg></button>`;
    row.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        session.selectedId = obj.id;
        deleteSelected();
        return;
      }
      session.selectedId = obj.id;
      refresh(false);
    });
    host.append(row);
  }
}

function updateZoomLabel() {
  if (session.ui?.zoomLabel) session.ui.zoomLabel.textContent = `${Math.round(session.zoom * 100)}%`;
  if (session.ui?.board) session.ui.board.style.transform = `scale(${session.zoom})`;
  if (session.ui?.board) session.ui.board.style.transformOrigin = "top center";
}

function setZoom(value) {
  session.zoom = Math.max(0.5, Math.min(2.5, value));
  const board = session.ui?.board;
  const wrap = session.ui?.wrap;
  if (board && wrap) {
    board.style.zoom = String(session.zoom);
    // fallback for transform
    board.style.transform = `scale(${session.zoom})`;
  }
  updateZoomLabel();
}

function syncInspectorFromSelection() {
  const obj = selectedObject();
  const ui = session.ui;
  if (!ui || session.syncing) return;
  session.syncing = true;
  try {
    if (obj?.type === "text") {
      ui.text.value = obj.text || "";
      ui.textSize.value = String(obj.fontSize || 18);
      ui.textColor.value = obj.color || "#1E3A8A";
      ui.textBold.checked = Boolean(obj.bold);
      const align = obj.align || "right";
      for (const input of session.root?.querySelectorAll('input[name="edit-align"]') ?? []) {
        /** @type {HTMLInputElement} */ (input).checked = input.value === align;
      }
    } else if (obj?.type === "ink") {
      ui.penColor.value = obj.color || "#1E3A8A";
      ui.penWeight.value = String(obj.strokeWidth || 2.2);
    } else if (obj?.type === "shape") {
      ui.fillOn.checked = obj.fillOn !== false;
      ui.fillColor.value = obj.fill || "#8AA4E0";
      ui.strokeColor.value = obj.stroke || "#1E3A8A";
      ui.strokeWidth.value = String(obj.strokeWidth ?? 1.5);
    }
  } finally {
    session.syncing = false;
  }
}

function applyInspectorToSelection() {
  if (session.syncing) return;
  const obj = selectedObject();
  if (!obj || (obj.type !== "text" && obj.type !== "ink" && obj.type !== "shape")) return;
  beginChange();
  const style = getStyle();
  if (obj.type === "text") {
    obj.text = session.ui?.text.value ?? obj.text;
    obj.fontSize = style.fontSize;
    obj.color = style.textColor;
    obj.bold = style.bold;
    obj.align = style.align;
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
  const obj = {
    id: uid("edit"),
    rotation: 0,
    ...partial
  };
  pruneEmptyText(session.selectedId, obj.id);
  if (session.board) clampBox(obj, session.board.visualWidth || 400, session.board.visualHeight || 400);
  if (obj.type === "image") obj.aspect = obj.width / Math.max(1, obj.height);
  breakChange();
  session.objects.push(obj);
  session.selectedId = obj.id;
  session.saved = false;
  refresh();
  if (obj.type === "text") {
    queueMicrotask(() => session.board?.focusSelectedText());
  }
  if (obj.type === "image" || obj.type === "text" || obj.type === "shape") {
    const select = session.root?.querySelector('input[name="edit-tool"][value="select"]');
    if (select instanceof HTMLInputElement) {
      select.checked = true;
      session.board?.syncTool();
      showPanels();
    }
  }
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

function deleteSelected() {
  const index = session.objects.findIndex((obj) => obj.id === session.selectedId);
  if (index < 0) return;
  breakChange();
  pushHistory();
  const [removed] = session.objects.splice(index, 1);
  session.selectedId = "";
  if (removed.url && !session.objects.some((obj) => obj.url === removed.url)) {
    URL.revokeObjectURL(removed.url);
  }
  session.saved = false;
  refresh();
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
  session.selectedId = "";
  session.history = [];
  session.historyBatch = false;
  session.saved = true;
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
    session.fileName = loaded.name;
    session.bytes = loaded.bytes;
    session.pages = pages;
    session.size = loaded.size;
    session.pageIndex = 0;
    await session.board.showPage(0);
    session.ui.drop.hidden = true;
    session.ui.workspace.hidden = false;
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
    const pageW = session.board?.visualWidth || 400;
    const targetWidth = Math.min(180, pageW * 0.45);
    const aspect = image.width / Math.max(1, image.height);
    const height = targetWidth / aspect;
    const url = URL.createObjectURL(new Blob([image.bytes], { type: "image/png" }));
    pushHistory();
    createObject({
      type: "image",
      pageIndex: session.pageIndex,
      x: (pageW - targetWidth) / 2,
      y: 80,
      width: targetWidth,
      height,
      aspect,
      png: image.bytes,
      url,
      label: file.name
    });
    if (session.ui?.imageMeta) session.ui.imageMeta.textContent = file.name;
  } catch (error) {
    reportFailure(error, "تعذّر قراءة الصورة.");
  }
}

function onRootKey(event) {
  const typing = event.target.closest?.("input, textarea, select");

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    if (typing) return;
    event.preventDefault();
    undo();
    return;
  }

  if (typing) return;

  if ((event.key === "Delete" || event.key === "Backspace") && session.selectedId) {
    event.preventDefault();
    deleteSelected();
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
  startProgress({ title: "حفظ التحرير", desc: "ندمج العناصر فوق الصفحات." });
  try {
    const bytes = await flattenObjects(session.bytes, session.objects);
    endProgress();
    const saved = await saveFile(bytes, suggestedName(), "pdf");
    if (saved) session.saved = true;
    reportSave(saved, `دُمج ${session.objects.length} عنصر في الملف.`);
  } catch (error) {
    reportFailure(error, "تعذّر حفظ الملف المحرَّر.");
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
    getObjects: () => session.objects,
    getSelectedId: () => session.selectedId,
    setSelectedId: (value) => {
      if (value !== session.selectedId) breakChange();
      pruneEmptyText(session.selectedId, value);
      session.selectedId = value;
    },
    getTool: activeTool,
    getStyle,
    onCreate: createObject,
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
  showPanels();
  refresh();

  rootEl.addEventListener(
    "change",
    (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target instanceof HTMLInputElement && target.name === "edit-tool") {
        session.board?.syncTool();
        showPanels();
        return;
      }
      applyInspectorToSelection();
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
  session.ui.remove.addEventListener("click", deleteSelected, { signal });
  session.ui.save.addEventListener("click", () => run(), { signal });
  session.ui.clear.addEventListener("click", () => closeDocument(), { signal });
  session.ui.prev.addEventListener("click", () => goTo(session.pageIndex - 1), { signal });
  session.ui.next.addEventListener("click", () => goTo(session.pageIndex + 1), { signal });
  session.ui.imageBrowse.addEventListener("click", () => session.ui.imageInput.click(), { signal });
  session.ui.imageInput.addEventListener(
    "change",
    () => {
      const file = session.ui.imageInput.files?.[0];
      session.ui.imageInput.value = "";
      if (file) pickImage(file);
      const select = session.root?.querySelector('input[name="edit-tool"][value="select"]');
      if (select instanceof HTMLInputElement) select.checked = true;
      session.board?.syncTool();
      showPanels();
    },
    { signal }
  );

  session.ui.zoomIn?.addEventListener("click", () => setZoom(session.zoom + 0.15), { signal });
  session.ui.zoomOut?.addEventListener("click", () => setZoom(session.zoom - 0.15), { signal });
  session.ui.zoomFit?.addEventListener("click", () => setZoom(1), { signal });
  setZoom(1);
}

export function unmount() {
  session.ac?.abort();
  session.ac = null;
  const urls = new Set(session.objects.map((obj) => obj.url).filter(Boolean));
  for (const url of urls) URL.revokeObjectURL(url);
  session.objects = [];
  session.selectedId = "";
  session.history = [];
  session.historyBatch = false;
  session.bytes = null;
  session.fileName = "";
  session.pages = 0;
  session.size = 0;
  session.pageIndex = 0;
  session.saved = true;
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
    name: "تحرير",
    icon: "icon-edit",
    input: "PDF",
    actionLabel: "حفظ",
    setup() {
      const root = document.getElementById("view-edit");
      if (root) mount(root);
    },
    enter() {
      syncChrome();
    },
    leave() {},
    isDirty: () => Boolean(session.bytes) && session.objects.length > 0 && !session.saved,
    run,
    acceptFiles,
    outputName: suggestedName
  };
}
