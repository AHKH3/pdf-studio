import { baseName, humanSize, isPdfFile, saveFile, withExtension } from "../../lib/files.js";
import { renderPdfPage } from "../../pdf/core.js";
import { endProgress, isCancellation, startProgress, toast } from "../../ui/feedback.js";
import { getActiveTab } from "../../ui/tabs.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { confirmDiscard, confirmReplace, readPdfFile, reportFailure as reportFailureToChrome, reportSave as reportSaveToChrome, uid } from "../shared.js";
import { createBoard } from "./board.js";
import { clampBox, combinedBoundingBox } from "./coords.js";
import { flattenObjects } from "./flatten.js";
import { ARABIC_FONTS, rasterizeImageFile, renderStampPng } from "./text-png.js";
import { buildUi, injectStyles, removeStyles } from "./ui.js";

export const id = "edit";
export const title = "تحرير";

const STYLE_STORAGE_KEY = "pdfstudio.edit.style.v1";

const SHAPE_NAMES = {
  rect: "مستطيل",
  ellipse: "دائرة",
  triangle: "مثلث",
  arrow: "سهم",
  line: "خط",
  "double-arrow": "سهم مزدوج"
};

const session = {
  /** @type {HTMLElement | null} */
  root: null,
  /** @type {ReturnType<typeof buildUi> | null} */
  ui: null,
  /** @type {ReturnType<typeof createBoard> | null} */
  board: null,
  fileName: "",
  /** @type {Uint8Array | null} */
  bytes: null,
  pageCount: 0,
  size: 0,
  pageIndex: 0,
  pageRotations: [],
  /** @type {Map<number, any[]>} */
  pagesObjects: new Map(),
  selectedIds: [],
  /** @type {any[]} */
  history: [],
  /** @type {any[]} */
  redoStack: [],
  zoom: 1,
  pageW: 595,
  pageH: 842,
  sidebarOpen: true,
  currentShape: "rect"
};

let clipboard = [];

function hasTitleblock() {
  return Boolean(document.getElementById("tb-run"));
}

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
  const totalObjs = getAllObjects().length;
  if (session.bytes) {
    setSource({
      label: session.fileName,
      pages: String(session.pageCount),
      size: humanSize(session.size)
    });
    setName(`${baseName(session.fileName)}-محرّر.pdf`);
    setRunEnabled(totalObjs > 0);
    setState(totalObjs ? "idle" : "waiting");
  } else {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
  }
}

function saveSessionToTab() {
  try {
    const tab = getActiveTab();
    if (!tab) return;
    tab.toolData = tab.toolData || {};
    tab.toolData.edit = {
      fileName: session.fileName,
      bytes: session.bytes,
      pageCount: session.pageCount,
      size: session.size,
      pageIndex: session.pageIndex,
      pageRotations: [...session.pageRotations],
      pagesObjects: new Map(Array.from(session.pagesObjects.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
      zoom: session.zoom,
      currentShape: session.currentShape
    };
    tab.isDirty = isDirty();
  } catch (err) {
    console.warn("Failed to snapshot edit tab data:", err);
  }
}

function restoreSessionFromTab() {
  try {
    const tab = getActiveTab();
    if (!tab?.toolData?.edit?.bytes) return false;
    const data = tab.toolData.edit;
    session.fileName = data.fileName || "";
    session.bytes = data.bytes;
    session.pageCount = data.pageCount || 1;
    session.size = data.size || 0;
    session.pageIndex = data.pageIndex || 0;
    session.pageRotations = data.pageRotations || new Array(session.pageCount).fill(0);
    session.pagesObjects = new Map(data.pagesObjects || []);
    session.selectedIds = [];
    session.history = [];
    session.redoStack = [];
    session.zoom = data.zoom || 1;
    session.currentShape = data.currentShape || "rect";

    if (session.ui?.drop) session.ui.drop.hidden = true;
    if (session.ui?.workspace) session.ui.workspace.hidden = false;

    renderPage();
    renderThumbnails();
    syncChrome();
    updateButtonStates();
    return true;
  } catch (err) {
    console.warn("Failed to restore edit tab data:", err);
    return false;
  }
}

function getCurrentObjects() {
  return session.pagesObjects.get(session.pageIndex) || [];
}

function updateThumbBadge(pageIdx) {
  const container = session.ui?.thumbs;
  if (!container) return;
  const item = container.querySelector(`[data-page-index="${pageIdx}"]`);
  if (!item) return;
  const numSpan = item.querySelector(".edit-thumb-num");
  if (!numSpan) return;
  const hasEdits = (session.pagesObjects.get(pageIdx) || []).length > 0;
  const existingBadge = numSpan.querySelector(".edit-thumb-badge");
  if (hasEdits && !existingBadge) {
    const badge = document.createElement("span");
    badge.className = "edit-thumb-badge";
    badge.title = "تحتوي على تعديلات";
    numSpan.append(badge);
  } else if (!hasEdits && existingBadge) {
    existingBadge.remove();
  }
}

function setCurrentObjects(objs, pushHist = true) {
  if (pushHist) pushHistory();
  session.pagesObjects.set(session.pageIndex, objs);
  renderObjectsOnLayer();
  renderInspectorLayers();
  updateThumbBadge(session.pageIndex);
  syncChrome();
  updateButtonStates();
  updateStatusInfo();
  saveSessionToTab();
}

function getAllObjects() {
  const all = [];
  for (const [pageIdx, list] of session.pagesObjects.entries()) {
    for (const obj of list) {
      all.push({ ...obj, pageIndex: pageIdx });
    }
  }
  return all;
}

export function isDirty() {
  return getAllObjects().length > 0;
}

function pushHistory() {
  const snapshot = {
    pagesObjects: new Map(Array.from(session.pagesObjects.entries()).map(([k, v]) => [k, structuredClone(v)])),
    pageIndex: session.pageIndex
  };
  session.history.push(snapshot);
  if (session.history.length > 50) session.history.shift();
  session.redoStack = [];
  updateButtonStates();
  saveSessionToTab();
}

function undo() {
  if (!session.history.length) return;
  const currentSnapshot = {
    pagesObjects: new Map(Array.from(session.pagesObjects.entries()).map(([k, v]) => [k, structuredClone(v)])),
    pageIndex: session.pageIndex
  };
  session.redoStack.push(currentSnapshot);

  const prev = session.history.pop();
  session.pagesObjects = prev.pagesObjects;
  session.pageIndex = Math.min(session.pageCount - 1, prev.pageIndex);
  renderObjectsOnLayer();
  renderInspectorLayers();
  updateThumbBadge(session.pageIndex);
  renderPage();
  updateButtonStates();
  updateStatusInfo();
  saveSessionToTab();
  toast("تم التراجع", "info");
}

function redo() {
  if (!session.redoStack.length) return;
  const currentSnapshot = {
    pagesObjects: new Map(Array.from(session.pagesObjects.entries()).map(([k, v]) => [k, structuredClone(v)])),
    pageIndex: session.pageIndex
  };
  session.history.push(currentSnapshot);

  const next = session.redoStack.pop();
  session.pagesObjects = next.pagesObjects;
  session.pageIndex = Math.min(session.pageCount - 1, next.pageIndex);
  renderObjectsOnLayer();
  renderInspectorLayers();
  updateThumbBadge(session.pageIndex);
  renderPage();
  updateButtonStates();
  updateStatusInfo();
  saveSessionToTab();
  toast("تمت الإعادة", "info");
}

function updateButtonStates() {
  if (session.ui?.undo) session.ui.undo.disabled = session.history.length === 0;
  if (session.ui?.redo) session.ui.redo.disabled = session.redoStack.length === 0;
  if (session.ui?.remove) session.ui.remove.disabled = session.selectedIds.length === 0;
  if (session.ui?.save) session.ui.save.disabled = !session.bytes || getAllObjects().length === 0;
}

function activeTool() {
  const picked = session.root?.querySelector('input[name="edit-tool"]:checked');
  return picked?.value || "select";
}

function setTool(toolName) {
  const radio = session.root?.querySelector(`input[name="edit-tool"][value="${toolName}"]`);
  if (radio) radio.checked = true;

  const isShape = ["rect", "ellipse", "triangle", "arrow", "line", "double-arrow"].includes(toolName);
  if (isShape) {
    session.currentShape = toolName;
    if (session.ui?.shapesBtn) {
      session.ui.shapesBtn.classList.add("is-active");
    }
    if (session.ui?.shapesLabel) {
      session.ui.shapesLabel.textContent = SHAPE_NAMES[toolName] || "أشكال";
    }
  } else if (session.ui?.shapesBtn) {
    session.ui.shapesBtn.classList.remove("is-active");
  }

  updateInspectorPanels(toolName);
  updateViewportCursor(toolName);
}

function updateViewportCursor(tool) {
  const vp = session.ui?.viewport;
  if (!vp?.classList) return;
  vp.classList.remove("tool-crosshair", "tool-text", "tool-eraser");
  if (["rect", "ellipse", "triangle", "arrow", "line", "double-arrow", "pen", "highlight", "whiteout"].includes(tool)) {
    vp.classList.add("tool-crosshair");
  } else if (tool === "text") {
    vp.classList.add("tool-text");
  } else if (tool === "eraser") {
    vp.classList.add("tool-eraser");
  }
}

function updateInspectorPanels(tool) {
  const panels = session.root?.querySelectorAll ? session.root.querySelectorAll("[data-edit-panel]") : [];
  panels.forEach((p) => (p.hidden = true));

  if (["rect", "ellipse", "triangle", "arrow", "line", "double-arrow"].includes(tool)) {
    const p = session.root?.querySelector('[data-edit-panel="shape"]');
    if (p) p.hidden = false;
  } else if (tool && tool !== "select" && tool !== "hand" && tool !== "eraser") {
    const p = session.root?.querySelector(`[data-edit-panel="${tool}"]`);
    if (p) p.hidden = false;
  }
}

function updateStatusInfo() {
  const statusEl = session.ui?.statusInfo;
  if (!statusEl) return;
  if (!session.bytes) {
    statusEl.textContent = "جاهز";
    return;
  }
  const selCount = session.selectedIds.length;
  if (selCount === 1) {
    const obj = getCurrentObjects().find((o) => o.id === session.selectedIds[0]);
    if (obj) {
      statusEl.textContent = `محدد: ${Math.round(obj.width)}×${Math.round(obj.height)} pt (صفحة ${session.pageIndex + 1}/${session.pageCount})`;
      return;
    }
  } else if (selCount > 1) {
    statusEl.textContent = `محدد: ${selCount} عناصر (صفحة ${session.pageIndex + 1}/${session.pageCount})`;
    return;
  }
  const total = getCurrentObjects().length;
  statusEl.textContent = `${total} عنصر (صفحة ${session.pageIndex + 1}/${session.pageCount})`;
}

function syncInspectorWithSelection() {
  updateStatusInfo();
  const alignBlock = session.root?.querySelector("#panel-align");
  if (alignBlock) alignBlock.hidden = session.selectedIds.length < 2;

  if (session.selectedIds.length !== 1) {
    if (session.selectedIds.length === 0) {
      updateInspectorPanels(activeTool());
    }
    return;
  }

  const obj = getCurrentObjects().find((o) => o.id === session.selectedIds[0]);
  if (!obj) return;

  const ui = session.ui;
  updateInspectorPanels(obj.type === "shape" ? "shape" : obj.type);

  if (obj.type === "text") {
    if (ui.text) ui.text.value = obj.text || "";
    if (ui.textSize) ui.textSize.value = String(obj.fontSize || 18);
    if (ui.textFont) ui.textFont.value = obj.fontFamily || "naskh";
    if (ui.textColor) ui.textColor.value = obj.color || "#1E3A8A";
    if (ui.textBold) ui.textBold.checked = Boolean(obj.bold);
    if (ui.textItalic) ui.textItalic.checked = Boolean(obj.italic);
    if (ui.textUnderline) ui.textUnderline.checked = Boolean(obj.underline);
    if (ui.textStrike) ui.textStrike.checked = Boolean(obj.strike);
    if (ui.textBgOn) ui.textBgOn.checked = Boolean(obj.bgOn);
    if (ui.textBgColor) ui.textBgColor.value = obj.bgColor || "#FFFFFF";
    const alignRadio = session.root?.querySelector(`input[name="edit-align"][value="${obj.align || 'right'}"]`);
    if (alignRadio) alignRadio.checked = true;
  } else if (obj.type === "shape") {
    if (ui.fillOn) ui.fillOn.checked = Boolean(obj.fillOn);
    if (ui.fillColor) ui.fillColor.value = obj.fill || "#BFDBFE";
    if (ui.strokeColor) ui.strokeColor.value = obj.stroke || "#1E3A8A";
    if (ui.strokeWidth) ui.strokeWidth.value = String(obj.strokeWidth != null ? obj.strokeWidth : 1.5);
    if (ui.shapeOpacity) ui.shapeOpacity.value = String(obj.opacity != null ? obj.opacity : 1);
  } else if (obj.type === "highlight") {
    if (ui.hlColor) ui.hlColor.value = obj.color || "#FDE047";
    if (ui.hlOpacity) ui.hlOpacity.value = String(obj.opacity != null ? obj.opacity : 0.35);
  } else if (obj.type === "whiteout") {
    if (ui.woColor) ui.woColor.value = obj.color || "#FFFFFF";
    if (ui.woBorder) ui.woBorder.checked = Boolean(obj.stroke);
  } else if (obj.type === "stamp") {
    if (ui.stampCustom) ui.stampCustom.value = obj.label || "";
  }
}

function updateSelectedObjectFromInspector() {
  if (session.selectedIds.length !== 1) return;
  const objId = session.selectedIds[0];
  const obj = getCurrentObjects().find((o) => o.id === objId);
  if (!obj) return;

  const style = getStyle();
  let updated = null;

  if (obj.type === "text") {
    updated = {
      ...obj,
      text: session.ui?.text?.value != null ? session.ui.text.value : obj.text,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      color: style.textColor,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strike,
      align: style.align,
      bgOn: style.bgOn,
      bgColor: style.bgColor
    };
  } else if (obj.type === "shape") {
    updated = {
      ...obj,
      fillOn: style.fillOn,
      fill: style.fillColor,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      opacity: style.shapeOpacity
    };
  } else if (obj.type === "highlight") {
    updated = {
      ...obj,
      color: style.hlColor,
      opacity: style.hlOpacity
    };
  } else if (obj.type === "whiteout") {
    updated = {
      ...obj,
      color: style.woColor,
      stroke: style.woBorder ? "#E2E8F0" : null
    };
  } else if (obj.type === "stamp") {
    updated = {
      ...obj,
      label: session.ui?.stampCustom?.value || obj.label
    };
  }

  if (updated) {
    const list = getCurrentObjects().map((o) => (o.id === objId ? updated : o));
    session.pagesObjects.set(session.pageIndex, list);
    renderObjectsOnLayer();
    renderInspectorLayers();
    syncChrome();
    saveSessionToTab();
  }
}

function getStyle() {
  const ui = session.ui;
  const alignRadio = session.root?.querySelector('input[name="edit-align"]:checked');
  return {
    fontSize: Math.min(96, Math.max(10, Number(ui?.textSize?.value) || 18)),
    fontFamily: ui?.textFont?.value || "naskh",
    textColor: ui?.textColor?.value || "#1E3A8A",
    bold: Boolean(ui?.textBold?.checked),
    italic: Boolean(ui?.textItalic?.checked),
    underline: Boolean(ui?.textUnderline?.checked),
    strike: Boolean(ui?.textStrike?.checked),
    align: alignRadio?.value || "right",
    bgOn: Boolean(ui?.textBgOn?.checked),
    bgColor: ui?.textBgColor?.value || "#FFFFFF",
    hlColor: ui?.hlColor?.value || "#FDE047",
    hlOpacity: Number(ui?.hlOpacity?.value) || 0.35,
    woColor: ui?.woColor?.value || "#FFFFFF",
    woBorder: Boolean(ui?.woBorder?.checked),
    penColor: ui?.penColor?.value || "#1E3A8A",
    penWeight: Number(ui?.penWeight?.value) || 2.2,
    fillOn: Boolean(ui?.fillOn?.checked),
    fillColor: ui?.fillColor?.value || "#BFDBFE",
    strokeColor: ui?.strokeColor?.value || "#1E3A8A",
    strokeWidth: Number(ui?.strokeWidth?.value) || 1.5,
    shapeOpacity: Number(ui?.shapeOpacity?.value) || 1,
    stampText: ui?.stampCustom?.value || "معتمد",
    stampColor: "#DC2626"
  };
}

function persistStyles() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(getStyle()));
    }
  } catch {}
}

async function renderPage() {
  if (!session.bytes) return;
  const canvas = session.ui?.canvas;
  if (!canvas) return;

  const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const renderScale = session.zoom * dpr * 1.5;

  const rendered = await renderPdfPage(session.bytes, session.pageIndex, {
    scale: renderScale,
    rotation: session.pageRotations[session.pageIndex] || 0
  });

  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (ctx && rendered.canvas) ctx.drawImage(rendered.canvas, 0, 0);

  session.pageW = rendered.width / renderScale;
  session.pageH = rendered.height / renderScale;

  const z = session.zoom;
  if (canvas.style) {
    canvas.style.width = `${session.pageW * z}px`;
    canvas.style.height = `${session.pageH * z}px`;
  }

  renderObjectsOnLayer();
  renderInspectorLayers();
  updatePageCounter();
}

function updatePageCounter() {
  if (session.ui?.count) {
    session.ui.count.textContent = `${session.pageIndex + 1} / ${session.pageCount || 1}`;
  }
  if (session.ui?.sidebarCount) {
    session.ui.sidebarCount.textContent = String(session.pageCount);
  }
  if (session.ui?.prev) session.ui.prev.disabled = session.pageIndex <= 0;
  if (session.ui?.next) session.ui.next.disabled = session.pageIndex >= session.pageCount - 1;
}

function renderObjectsOnLayer() {
  const layer = session.ui?.layer;
  if (!layer) return;
  layer.innerHTML = "";

  const z = session.zoom;
  const h = session.pageH;
  const objs = getCurrentObjects();

  for (const obj of objs) {
    const el = document.createElement("div");
    el.className = "edit-obj";
    el.dataset.id = obj.id;
    el.dataset.type = obj.type;
    if (session.selectedIds.includes(obj.id)) el.classList.add("is-selected");
    if (obj.locked) el.classList.add("is-locked");

    const topPx = (h - (obj.y + obj.height)) * z;
    const leftPx = obj.x * z;
    const widthPx = obj.width * z;
    const heightPx = obj.height * z;

    el.style.left = `${leftPx}px`;
    el.style.top = `${topPx}px`;
    el.style.width = `${widthPx}px`;
    el.style.height = `${heightPx}px`;
    el.style.transform = obj.rotation ? `rotate(${obj.rotation}deg)` : "";

    if (obj.type === "text") {
      const textDiv = document.createElement("div");
      textDiv.className = "edit-obj__text";
      textDiv.textContent = obj.text || "";
      textDiv.style.fontSize = `${(obj.fontSize || 18) * z}px`;
      textDiv.style.fontFamily = ARABIC_FONTS[obj.fontFamily] || obj.fontFamily || "inherit";
      textDiv.style.color = obj.color || "#1E3A8A";
      textDiv.style.fontWeight = obj.bold ? "bold" : "normal";
      textDiv.style.fontStyle = obj.italic ? "italic" : "normal";
      textDiv.style.textDecoration = [
        obj.underline ? "underline" : "",
        obj.strike ? "line-through" : ""
      ].filter(Boolean).join(" ");
      textDiv.style.textAlign = obj.align || "right";
      if (obj.bgOn && obj.bgColor) {
        textDiv.style.backgroundColor = obj.bgColor;
      }
      el.append(textDiv);
    } else if (obj.type === "highlight") {
      const hlDiv = document.createElement("div");
      hlDiv.style.width = "100%";
      hlDiv.style.height = "100%";
      hlDiv.style.backgroundColor = obj.color || "#FDE047";
      hlDiv.style.opacity = String(obj.opacity != null ? obj.opacity : 0.35);
      hlDiv.style.borderRadius = "2px";
      el.append(hlDiv);
    } else if (obj.type === "whiteout") {
      const woDiv = document.createElement("div");
      woDiv.style.width = "100%";
      woDiv.style.height = "100%";
      woDiv.style.backgroundColor = obj.color || "#FFFFFF";
      if (obj.stroke) woDiv.style.border = `1px solid ${obj.stroke}`;
      woDiv.style.borderRadius = "2px";
      el.append(woDiv);
    } else if (obj.type === "stamp") {
      const stampDiv = document.createElement("div");
      stampDiv.style.width = "100%";
      stampDiv.style.height = "100%";
      stampDiv.style.border = `2.5px solid ${obj.color || "#DC2626"}`;
      stampDiv.style.borderRadius = "4px";
      stampDiv.style.display = "flex";
      stampDiv.style.flexDirection = "column";
      stampDiv.style.alignItems = "center";
      stampDiv.style.justifyContent = "center";
      stampDiv.style.color = obj.color || "#DC2626";
      stampDiv.style.fontFamily = '"Amiri", serif';
      stampDiv.style.fontWeight = "bold";
      stampDiv.style.fontSize = `${18 * z}px`;
      stampDiv.textContent = obj.label || "معتمد";
      el.append(stampDiv);
    } else if (obj.type === "shape") {
      const svg = document.createElement("svg");
      svg.setAttribute("viewBox", `0 0 ${obj.width} ${obj.height}`);
      const stroke = obj.stroke || "#1E3A8A";
      const strokeW = obj.strokeWidth || 1.5;
      const fill = obj.fillOn ? (obj.fill || "#BFDBFE") : "none";
      const opacity = obj.opacity != null ? obj.opacity : 1;

      if (obj.kind === "ellipse") {
        svg.innerHTML = `<ellipse cx="${obj.width / 2}" cy="${obj.height / 2}" rx="${Math.max(1, obj.width / 2 - strokeW / 2)}" ry="${Math.max(1, obj.height / 2 - strokeW / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" opacity="${opacity}" />`;
      } else if (obj.kind === "triangle") {
        svg.innerHTML = `<polygon points="${obj.width / 2},${strokeW} ${obj.width - strokeW},${obj.height - strokeW} ${strokeW},${obj.height - strokeW}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" opacity="${opacity}" />`;
      } else if (obj.kind === "arrow" || obj.kind === "line" || obj.kind === "double-arrow") {
        const headW = Math.max(8, strokeW * 3.5);
        const yMid = obj.height / 2;
        const startX = obj.kind === "double-arrow" ? headW : 4;
        const endX = obj.width - (obj.kind === "arrow" || obj.kind === "double-arrow" ? headW : 4);
        let d = `M ${startX} ${yMid} L ${endX} ${yMid}`;
        let headSvg = "";
        if (obj.kind === "arrow" || obj.kind === "double-arrow") {
          headSvg += `<polygon points="${obj.width - 2},${yMid} ${obj.width - headW},${yMid - headW / 2} ${obj.width - headW},${yMid + headW / 2}" fill="${stroke}" />`;
        }
        if (obj.kind === "double-arrow") {
          headSvg += `<polygon points="2,${yMid} ${headW},${yMid - headW / 2} ${headW},${yMid + headW / 2}" fill="${stroke}" />`;
        }
        svg.innerHTML = `<path d="${d}" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round" />${headSvg}`;
      } else {
        svg.innerHTML = `<rect x="${strokeW / 2}" y="${strokeW / 2}" width="${Math.max(1, obj.width - strokeW)}" height="${Math.max(1, obj.height - strokeW)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" rx="2" opacity="${opacity}" />`;
      }
      el.append(svg);
    } else if (obj.type === "ink" && obj.points?.length) {
      const svg = document.createElement("svg");
      svg.setAttribute("viewBox", `0 0 ${obj.width} ${obj.height}`);
      const color = obj.color || "#1E3A8A";
      const strokeW = obj.strokeWidth || 2.2;
      const d = obj.points
        .map((p, i) => `${i ? "L" : "M"} ${(p.x - obj.x).toFixed(1)} ${(obj.height - (p.y - obj.y)).toFixed(1)}`)
        .join(" ");
      svg.innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />`;
      el.append(svg);
    } else if (obj.type === "image" && obj.canvas) {
      const img = document.createElement("img");
      img.src = obj.canvas.toDataURL ? obj.canvas.toDataURL() : "";
      el.append(img);
    }

    // Handles
    const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const hPos of handles) {
      const hEl = document.createElement("span");
      hEl.className = "edit-handle";
      hEl.dataset.handle = hPos;
      el.append(hEl);
    }
    const rotateHandle = document.createElement("span");
    rotateHandle.className = "edit-rotate";
    el.append(rotateHandle);

    layer.append(el);
  }

  session.board?.updateFloatingBar();
}

function bringForward(id) {
  const objs = getCurrentObjects();
  const idx = objs.findIndex((o) => o.id === id);
  if (idx === -1 || idx >= objs.length - 1) return;
  pushHistory();
  const next = [...objs];
  const [item] = next.splice(idx, 1);
  next.splice(idx + 1, 0, item);
  setCurrentObjects(next, false);
  renderObjectsOnLayer();
  renderInspectorLayers();
}

function sendBackward(id) {
  const objs = getCurrentObjects();
  const idx = objs.findIndex((o) => o.id === id);
  if (idx <= 0) return;
  pushHistory();
  const next = [...objs];
  const [item] = next.splice(idx, 1);
  next.splice(idx - 1, 0, item);
  setCurrentObjects(next, false);
  renderObjectsOnLayer();
  renderInspectorLayers();
}

function copySelected() {
  const selected = getCurrentObjects().filter((o) => session.selectedIds.includes(o.id));
  if (!selected.length) return;
  clipboard = JSON.parse(JSON.stringify(selected));
  toast(`تم نسخ ${selected.length} عنصر`, "info");
}

function pasteSelected() {
  if (!clipboard.length) return;
  const pw = session.pageW || 595;
  const ph = session.pageH || 842;
  const newObjs = clipboard.map((o) => {
    const clone = JSON.parse(JSON.stringify(o));
    clone.id = `${clone.type || "obj"}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    clone.x = Math.min(pw - (clone.width || 50), Math.max(0, (clone.x || 0) + 15));
    clone.y = Math.min(ph - (clone.height || 50), Math.max(0, (clone.y || 0) - 15));
    return clone;
  });
  const current = getCurrentObjects();
  setCurrentObjects([...current, ...newObjs], true);
  session.selectedIds = newObjs.map((o) => o.id);
  session.board?.setSelectedIds(session.selectedIds);
  renderObjectsOnLayer();
  renderInspectorLayers();
  syncInspectorWithSelection();
  toast(`تم لصق ${newObjs.length} عنصر`, "done");
}

function addCustomStamp(text) {
  const stampText = String(text || session.ui?.stampCustom?.value || "").trim();
  if (!stampText) {
    toast("يرجى كتابة نص الختم أولاً.", "info");
    return;
  }
  const pw = session.pageW || 595;
  const ph = session.pageH || 842;
  const w = 180;
  const h = 80;
  const newStamp = {
    id: `stamp_${Date.now()}`,
    type: "stamp",
    label: stampText,
    color: "#DC2626",
    shape: "rect",
    x: (pw - w) / 2,
    y: (ph - h) / 2,
    width: w,
    height: h,
    rotation: 0
  };
  setCurrentObjects([...getCurrentObjects(), newStamp], true);
  session.selectedIds = [newStamp.id];
  session.board?.setSelectedIds(session.selectedIds);
  renderObjectsOnLayer();
  renderInspectorLayers();
  syncInspectorWithSelection();
  setTool("select");
  toast(`تمت إضافة الختم «${stampText}»`, "done");
}

function renderInspectorLayers() {
  const container = session.ui?.layers;
  if (!container) return;
  container.innerHTML = "";
  const objs = getCurrentObjects();

  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i];
    const row = document.createElement("div");
    row.className = "edit-layer-row";
    if (session.selectedIds.includes(obj.id)) row.classList.add("is-selected");

    const label = obj.type === "text"
      ? (obj.text?.slice(0, 18) || "نص")
      : obj.type === "shape"
      ? `شكل (${SHAPE_NAMES[obj.kind] || obj.kind || "مستطيل"})`
      : obj.type === "highlight"
      ? "تظليل"
      : obj.type === "whiteout"
      ? "حجب"
      : obj.type === "stamp"
      ? `ختم (${obj.label})`
      : obj.type === "ink"
      ? "قلم حر"
      : "صورة";

    row.innerHTML = `
      <span class="edit-layer-row__name">${label}</span>
      <button type="button" class="edit-layer-row__btn" data-act="up" title="تقديم للأمام">
        <svg class="icon" style="transform: rotate(90deg)"><use href="#icon-chev"></use></svg>
      </button>
      <button type="button" class="edit-layer-row__btn" data-act="down" title="إرجاع للخلف">
        <svg class="icon" style="transform: rotate(-90deg)"><use href="#icon-chev"></use></svg>
      </button>
      <button type="button" class="edit-layer-row__btn" data-act="lock" title="${obj.locked ? 'إلغاء القفل' : 'قفل'}">
        <svg class="icon"><use href="#${obj.locked ? 'icon-lock' : 'icon-lock-open'}"></use></svg>
      </button>
      <button type="button" class="edit-layer-row__btn edit-layer-row__btn--del edit-layer-row__del" data-act="del" title="حذف">
        <svg class="icon"><use href="#icon-trash"></use></svg>
      </button>
    `;

    row.addEventListener("click", (e) => {
      const act = e.target.closest ? e.target.closest("[data-act]")?.dataset.act : null;
      if (act === "del") {
        const remaining = getCurrentObjects().filter((o) => o.id !== obj.id);
        setCurrentObjects(remaining, true);
        session.selectedIds = session.selectedIds.filter((id) => id !== obj.id);
        renderObjectsOnLayer();
        renderInspectorLayers();
        syncInspectorWithSelection();
        return;
      }
      if (act === "up") {
        bringForward(obj.id);
        return;
      }
      if (act === "down") {
        sendBackward(obj.id);
        return;
      }
      if (act === "lock") {
        const updated = getCurrentObjects().map((o) => (o.id === obj.id ? { ...o, locked: !o.locked } : o));
        setCurrentObjects(updated, true);
        return;
      }
      session.selectedIds = [obj.id];
      session.board?.setSelectedIds(session.selectedIds);
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
    });

    container.append(row);
  }
}

const thumbCanvasCache = new Map();

async function renderThumbnails() {
  const container = session.ui?.thumbs;
  if (!container || !session.bytes) return;
  container.innerHTML = "";

  for (let i = 0; i < session.pageCount; i++) {
    const hasEdits = (session.pagesObjects.get(i) || []).length > 0;
    const item = document.createElement("div");
    item.className = `edit-thumb-item ${i === session.pageIndex ? "is-active" : ""}`;
    item.dataset.pageIndex = String(i);

    item.innerHTML = `
      <div class="edit-thumb-preview" id="thumb-preview-${i}">
        <span class="num" style="color:var(--text-muted);font-size:0.75rem">...</span>
      </div>
      <div class="edit-thumb-footer">
        <span class="edit-thumb-num">
          صفحة ${i + 1}
          ${hasEdits ? '<span class="edit-thumb-badge" title="تحتوي على تعديلات"></span>' : ''}
        </span>
        <div class="edit-thumb-actions">
          <button type="button" class="edit-thumb-btn" data-act="rotate" title="تدوير 90°">
            <svg class="icon"><use href="#icon-rotate"></use></svg>
          </button>
          <button type="button" class="edit-thumb-btn" data-act="dup" title="تكرار">
            <svg class="icon"><use href="#icon-duplicate"></use></svg>
          </button>
          <button type="button" class="edit-thumb-btn edit-thumb-btn--del" data-act="del" title="حذف" ${session.pageCount <= 1 ? "disabled" : ""}>
            <svg class="icon"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;

    item.addEventListener("click", (e) => {
      const act = e.target.closest ? e.target.closest("[data-act]")?.dataset.act : null;
      if (act === "rotate") {
        rotatePage(i);
        return;
      }
      if (act === "dup") {
        duplicatePage(i);
        return;
      }
      if (act === "del") {
        deletePage(i);
        return;
      }
      if (session.pageIndex !== i) {
        session.pageIndex = i;
        session.selectedIds = [];
        renderPage();
        container.querySelectorAll(".edit-thumb-item").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.pageIndex === String(i));
        });
        syncInspectorWithSelection();
      }
    });

    container.append(item);

    const rot = session.pageRotations[i] || 0;
    const cacheKey = `${i}_${rot}`;
    const previewEl = item.querySelector(`#thumb-preview-${i}`);

    if (thumbCanvasCache.has(cacheKey)) {
      const cached = thumbCanvasCache.get(cacheKey);
      if (previewEl) {
        previewEl.innerHTML = "";
        const cloneCanvas = document.createElement("canvas");
        cloneCanvas.width = cached.width;
        cloneCanvas.height = cached.height;
        const ctx = cloneCanvas.getContext("2d");
        ctx?.drawImage(cached, 0, 0);
        previewEl.append(cloneCanvas);
      }
    } else {
      renderPdfPage(session.bytes, i, { scale: 0.28, rotation: rot })
        .then((res) => {
          thumbCanvasCache.set(cacheKey, res.canvas);
          if (previewEl) {
            previewEl.innerHTML = "";
            previewEl.append(res.canvas);
          }
        })
        .catch(() => {});
    }
  }
}

function rotatePage(pageIdx) {
  pushHistory();
  const cur = session.pageRotations[pageIdx] || 0;
  session.pageRotations[pageIdx] = (cur + 90) % 360;
  renderPage();
  renderThumbnails();
  toast(`تم تدوير صفحة ${pageIdx + 1}`, "done");
}

function deletePage(pageIdx) {
  if (session.pageCount <= 1) {
    toast("لا يمكن حذف الصفحة الوحيدة في المستند.", "info");
    return;
  }
  pushHistory();
  session.pageCount -= 1;

  // Re-index pagesObjects Map: shift all keys above the deleted page down by 1
  const newMap = new Map();
  for (const [key, val] of session.pagesObjects.entries()) {
    if (key < pageIdx) {
      newMap.set(key, val);
    } else if (key > pageIdx) {
      newMap.set(key - 1, val);
    }
    // key === pageIdx is dropped (deleted page)
  }
  session.pagesObjects = newMap;

  // Re-index pageRotations array
  session.pageRotations.splice(pageIdx, 1);

  if (session.pageIndex >= session.pageCount) {
    session.pageIndex = session.pageCount - 1;
  }
  renderPage();
  renderThumbnails();
  syncChrome();
  updateButtonStates();
  saveSessionToTab();
  toast(`تم حذف صفحة ${pageIdx + 1}`, "done");
}

function duplicatePage(pageIdx) {
  pushHistory();
  session.pageCount += 1;
  const objs = session.pagesObjects.get(pageIdx) || [];
  session.pagesObjects.set(session.pageCount - 1, JSON.parse(JSON.stringify(objs)));
  renderThumbnails();
  toast(`تم تكرار صفحة ${pageIdx + 1}`, "done");
}

function setZoom(newZoom) {
  session.zoom = Math.min(4, Math.max(0.25, newZoom));
  if (session.ui?.zoomLabel) {
    session.ui.zoomLabel.textContent = `${Math.round(session.zoom * 100)}%`;
  }
  renderPage();
  saveSessionToTab();
}

function zoomFitWidth() {
  const vp = session.ui?.viewport;
  if (!vp || !session.pageW) return;
  const targetW = (vp.clientWidth || 800) - 48;
  setZoom(targetW / session.pageW);
}

function zoomFitPage() {
  const vp = session.ui?.viewport;
  if (!vp || !session.pageH) return;
  const targetH = (vp.clientHeight || 600) - 48;
  setZoom(targetH / session.pageH);
}

function alignSelected(direction) {
  const selected = getCurrentObjects().filter((o) => session.selectedIds.includes(o.id));
  if (selected.length < 2) {
    toast("اختر عنصرين على الأقل للمحاذاة.", "info");
    return;
  }
  pushHistory();
  const bbox = combinedBoundingBox(selected);
  if (!bbox) return;

  const updated = getCurrentObjects().map((o) => {
    if (!session.selectedIds.includes(o.id)) return o;
    let { x, y } = o;
    if (direction === "right") x = bbox.x + bbox.width - o.width;
    else if (direction === "center-h") x = bbox.x + (bbox.width - o.width) / 2;
    else if (direction === "left") x = bbox.x;
    else if (direction === "top") y = bbox.y + bbox.height - o.height;
    else if (direction === "center-v") y = bbox.y + (bbox.height - o.height) / 2;
    else if (direction === "bottom") y = bbox.y;
    return { ...o, x, y };
  });

  setCurrentObjects(updated, false);
  toast("تمت المحاذاة بنجاح", "done");
}

async function handleFile(file) {
  if (!file || !isPdfFile(file)) {
    toast("يرجى اختيار ملف PDF صالح.", "error");
    return;
  }
  try {
    const data = await readPdfFile(file);
    session.fileName = file.name;
    session.bytes = data.bytes;
    session.pageCount = data.pages;
    session.size = file.size;
    session.pageIndex = 0;
    session.pageRotations = new Array(data.pages).fill(0);
    session.pagesObjects = new Map();
    session.selectedIds = [];
    session.history = [];
    session.redoStack = [];

    session.ui.drop.hidden = true;
    session.ui.workspace.hidden = false;

    await renderPage();
    await renderThumbnails();
    zoomFitWidth();
    syncChrome();
    updateButtonStates();
    saveSessionToTab();
    toast(`تم فتح المستند (${data.pages} صفحة)`, "done");
  } catch (err) {
    reportFailure(err, "تعذّر فتح ملف الـ PDF.");
  }
}

export async function run() {
  if (!session.bytes) {
    toast("لا يوجد ملف مفتوح.", "info");
    return;
  }
  const allObjs = getAllObjects();
  if (!allObjs.length) {
    toast("لم تقم بإضافة أي تعديلات على المستند بعد.", "info");
    return;
  }
  startProgress({ desc: "جارٍ دمج الطبقات وحفظ المستند...", percent: 30 });
  try {
    const outBytes = await flattenObjects(session.bytes, allObjs);
    const outName = suggestedName();
    const saved = await saveFile(outBytes, outName, "application/pdf");
    endProgress();
    reportSave(saved, "تم حفظ المستند المحرّر بنجاح!");
  } catch (err) {
    endProgress();
    reportFailure(err, "تعذّر حفظ المستند المحرّر.");
  }
}

export function mount(container) {
  const root = container || document.getElementById("view-edit");
  if (!root) throw new Error("Root container required");
  injectStyles();
  session.root = root;
  session.ui = buildUi(root);

  session.pageCount = 1;
  session.pageIndex = 0;
  if (session.ui.prev) session.ui.prev.disabled = true;
  if (session.ui.next) session.ui.next.disabled = true;

  persistStyles();

  session.board = createBoard({
    layer: session.ui.layer,
    viewport: session.ui.viewport,
    board: session.ui.board,
    guidesWrap: session.ui.guides,
    floatingBar: session.ui.floatingBar,
    pageW: () => session.pageW,
    pageH: () => session.pageH,
    zoom: () => session.zoom,
    activeTool,
    getStyle,
    getObjects: getCurrentObjects,
    setObjects: setCurrentObjects,
    onSelect: (ids) => {
      session.selectedIds = ids;
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
      updateButtonStates();
    },
    onCommitInlineText: (obj) => {
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
      saveSessionToTab();
    }
  });

  updateButtonStates();

  // Root change delegated listener
  session.root.addEventListener("change", (e) => {
    const target = e.target;
    if (target?.name === "edit-tool") {
      updateInspectorPanels(target.value);
      updateViewportCursor(target.value);
    } else {
      updateSelectedObjectFromInspector();
    }
    persistStyles();
  });

  session.root.addEventListener("input", (e) => {
    if (e.target?.closest && e.target.closest("[data-edit-panel]")) {
      updateSelectedObjectFromInspector();
    }
  });

  // Shapes Popover Dropdown handling
  if (session.ui.shapesBtn && session.ui.shapesMenu) {
    session.ui.shapesBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = session.ui.shapesMenu.hidden;
      session.ui.shapesMenu.hidden = !isHidden;
      if (isHidden) {
        setTool(session.currentShape || "rect");
      }
    });

    session.ui.shapesMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = e.target.closest ? e.target.closest("[data-shape]") : null;
      if (item) {
        const shape = item.dataset.shape;
        session.ui.shapesMenu.querySelectorAll(".edit-popover-item").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.shape === shape);
        });
        setTool(shape);
        session.ui.shapesMenu.hidden = true;
      }
    });
  }

  // Root click delegated listener
  session.root.addEventListener("click", (e) => {
    if (session.ui?.shapesMenu && !e.target.closest("#edit-shapes-wrap")) {
      session.ui.shapesMenu.hidden = true;
    }

    const swatch = e.target.closest ? e.target.closest("[data-swatch]") : null;
    if (swatch) {
      const targetId = swatch.dataset.for;
      const val = swatch.dataset.swatch;
      const inp = document.getElementById(targetId);
      if (inp) {
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    const sizeChip = e.target.closest ? e.target.closest("[data-size-chip]") : null;
    if (sizeChip) {
      const targetId = sizeChip.dataset.for;
      const val = sizeChip.dataset.sizeChip;
      const inp = document.getElementById(targetId);
      if (inp) {
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    const preset = e.target.closest ? e.target.closest("[data-shape-preset]") : null;
    if (preset) {
      const p = preset.dataset.shapePreset;
      if (p === "frame") {
        if (session.ui.fillOn) session.ui.fillOn.checked = false;
        if (session.ui.strokeColor) session.ui.strokeColor.value = "#DC2626";
        if (session.ui.strokeWidth) session.ui.strokeWidth.value = "2";
      } else if (p === "highlight") {
        if (session.ui.fillOn) session.ui.fillOn.checked = true;
        if (session.ui.fillColor) session.ui.fillColor.value = "#FDE68A";
        if (session.ui.strokeWidth) session.ui.strokeWidth.value = "0";
      } else if (p === "fill") {
        if (session.ui.fillOn) session.ui.fillOn.checked = true;
        if (session.ui.fillColor) session.ui.fillColor.value = "#BFDBFE";
      } else if (p === "cover") {
        if (session.ui.fillOn) session.ui.fillOn.checked = true;
        if (session.ui.fillColor) session.ui.fillColor.value = "#FFFFFF";
        if (session.ui.strokeWidth) session.ui.strokeWidth.value = "0";
      }
      updateSelectedObjectFromInspector();
      return;
    }

    const stampPreset = e.target.closest ? e.target.closest("[data-stamp]") : null;
    if (stampPreset) {
      const label = stampPreset.dataset.stamp;
      const color = stampPreset.style.color || "#DC2626";
      const id = `stamp_${Date.now()}`;
      const pw = session.pageW;
      const ph = session.pageH;
      const w = 180;
      const h = 80;
      const newStamp = {
        id,
        type: "stamp",
        x: (pw - w) / 2,
        y: (ph - h) / 2,
        width: w,
        height: h,
        label,
        sub: new Date().toLocaleDateString("ar-EG"),
        color,
        shape: "rect",
        rotation: 0
      };
      setCurrentObjects([...getCurrentObjects(), newStamp], true);
      session.selectedIds = [id];
      session.board?.setSelectedIds(session.selectedIds);
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
      toast(`تمت إضافة ختم «${label}»`, "done");
    }
  });

  // Wire UI Events
  if (session.ui.browse) session.ui.browse.onclick = () => session.ui.input?.click();
  if (session.ui.input) {
    session.ui.input.onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    };
  }
  if (session.ui.drop) {
    session.ui.drop.ondragover = (e) => {
      e.preventDefault();
      session.ui.drop.classList.add("is-over");
    };
    session.ui.drop.ondragleave = () => session.ui.drop.classList.remove("is-over");
    session.ui.drop.ondrop = (e) => {
      e.preventDefault();
      session.ui.drop.classList.remove("is-over");
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    };
  }

  // Navigation
  if (session.ui.prev) {
    session.ui.prev.onclick = () => {
      if (session.pageIndex > 0) {
        session.pageIndex -= 1;
        session.selectedIds = [];
        renderPage();
        renderThumbnails();
        syncInspectorWithSelection();
        saveSessionToTab();
      }
    };
  }
  if (session.ui.next) {
    session.ui.next.onclick = () => {
      if (session.pageIndex < session.pageCount - 1) {
        session.pageIndex += 1;
        session.selectedIds = [];
        renderPage();
        renderThumbnails();
        syncInspectorWithSelection();
        saveSessionToTab();
      }
    };
  }

  // Zoom
  if (session.ui.zoomIn) session.ui.zoomIn.onclick = () => setZoom(session.zoom + 0.15);
  if (session.ui.zoomOut) session.ui.zoomOut.onclick = () => setZoom(session.zoom - 0.15);
  if (session.ui.zoomFit) session.ui.zoomFit.onclick = () => zoomFitWidth();

  // Sidebar toggles
  const toggleSidebar = () => {
    session.sidebarOpen = !session.sidebarOpen;
    session.ui.workspace?.classList?.toggle("sidebar-collapsed", !session.sidebarOpen);
  };
  if (session.ui.sidebarToggle) session.ui.sidebarToggle.onclick = toggleSidebar;
  if (session.ui.sidebarBtn) session.ui.sidebarBtn.onclick = toggleSidebar;

  // Actions
  if (session.ui.undo) session.ui.undo.onclick = undo;
  if (session.ui.redo) session.ui.redo.onclick = redo;
  if (session.ui.remove) {
    session.ui.remove.onclick = () => {
      if (session.selectedIds.length) {
        const remaining = getCurrentObjects().filter((o) => !session.selectedIds.includes(o.id));
        setCurrentObjects(remaining, true);
        session.selectedIds = [];
        renderObjectsOnLayer();
        renderInspectorLayers();
        syncInspectorWithSelection();
      }
    };
  }
  if (session.ui.layersClear) {
    session.ui.layersClear.onclick = () => {
      if (getCurrentObjects().length) {
        setCurrentObjects([], true);
        session.selectedIds = [];
        renderObjectsOnLayer();
        renderInspectorLayers();
        syncInspectorWithSelection();
        toast("تم تفريغ طبقات الصفحة", "info");
      }
    };
  }
  if (session.ui.save) session.ui.save.onclick = run;
  if (session.ui.clear) {
    session.ui.clear.onclick = async () => {
      // Confirm before discarding unsaved edits
      if (isDirty()) {
        const confirmed = await confirmDiscard();
        if (!confirmed) return;
      }
      session.bytes = null;
      session.pagesObjects.clear();
      session.selectedIds = [];
      session.history = [];
      session.redoStack = [];
      if (session.ui.workspace) session.ui.workspace.hidden = true;
      if (session.ui.drop) session.ui.drop.hidden = false;
      syncChrome();
      updateButtonStates();
      saveSessionToTab();
    };
  }

  // Floating Bar Actions
  if (session.ui.flDuplicate) {
    session.ui.flDuplicate.onclick = () => {
      if (!session.selectedIds.length) return;
      pushHistory();
      const toDup = getCurrentObjects().filter((o) => session.selectedIds.includes(o.id));
      const newOnes = toDup.map((o) => ({
        ...o,
        id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x: o.x + 16,
        y: o.y - 16
      }));
      setCurrentObjects([...getCurrentObjects(), ...newOnes], false);
      session.selectedIds = newOnes.map((o) => o.id);
      session.board?.setSelectedIds(session.selectedIds);
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
      toast("تم تكرار العنصر", "done");
    };
  }

  if (session.ui.flLock) {
    session.ui.flLock.onclick = () => {
      if (!session.selectedIds.length) return;
      pushHistory();
      const updated = getCurrentObjects().map((o) =>
        session.selectedIds.includes(o.id) ? { ...o, locked: !o.locked } : o
      );
      setCurrentObjects(updated, false);
      toast("تم تحديث حالة القفل", "info");
    };
  }

  if (session.ui.flDelete) {
    session.ui.flDelete.onclick = () => {
      if (!session.selectedIds.length) return;
      const remaining = getCurrentObjects().filter((o) => !session.selectedIds.includes(o.id));
      setCurrentObjects(remaining, true);
      session.selectedIds = [];
      session.board?.setSelectedIds([]);
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
    };
  }

  // Alignment buttons
  if (session.ui.alignRight) session.ui.alignRight.onclick = () => alignSelected("right");
  if (session.ui.alignCenterH) session.ui.alignCenterH.onclick = () => alignSelected("center-h");
  if (session.ui.alignLeft) session.ui.alignLeft.onclick = () => alignSelected("left");
  if (session.ui.alignTop) session.ui.alignTop.onclick = () => alignSelected("top");
  if (session.ui.alignCenterV) session.ui.alignCenterV.onclick = () => alignSelected("center-v");
  if (session.ui.alignBottom) session.ui.alignBottom.onclick = () => alignSelected("bottom");

  // Image insertion
  if (session.ui.imageBrowse) session.ui.imageBrowse.onclick = () => session.ui.imageInput?.click();
  if (session.ui.imageInput) {
    session.ui.imageInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const raster = await rasterizeImageFile(f);
        const pw = session.pageW;
        const ph = session.pageH;
        const scale = Math.min(1, 300 / Math.max(raster.width, raster.height));
        const w = raster.width * scale;
        const h = raster.height * scale;
        const newImg = {
          id: `img_${Date.now()}`,
          type: "image",
          png: raster.bytes,
          canvas: raster.canvas,
          x: (pw - w) / 2,
          y: (ph - h) / 2,
          width: w,
          height: h,
          rotation: 0
        };
        setCurrentObjects([...getCurrentObjects(), newImg], true);
        session.selectedIds = [newImg.id];
        session.board?.setSelectedIds(session.selectedIds);
        renderObjectsOnLayer();
        renderInspectorLayers();
        syncInspectorWithSelection();
        setTool("select");
        toast("تم إدراج الصورة", "done");
      } catch (err) {
        reportFailure(err, "تعذّر تحميل الصورة.");
      }
    };
  }

  // Custom stamp add button
  if (session.ui.stampAdd) session.ui.stampAdd.onclick = () => addCustomStamp();
  if (session.ui.stampCustom) {
    session.ui.stampCustom.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCustomStamp();
      }
    };
  }

  // Support drag-and-drop replacement of PDF onto workspace viewport
  if (session.ui.viewport) {
    session.ui.viewport.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    session.ui.viewport.ondrop = async (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && isPdfFile(file)) {
        if (isDirty()) {
          const ok = await confirmReplace();
          if (!ok) return;
        }
        handleFile(file);
      }
    };
  }

  // Keyboard Shortcuts
  session.root.addEventListener("keydown", handleKeyDown);
  if (typeof window !== "undefined") {
    window.addEventListener?.("keydown", handleKeyDown);
  }
  session.ui.viewport?.addEventListener?.("wheel", handleWheel, { passive: false });
}

function handleWheel(e) {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom(session.zoom + delta);
  }
}

function handleKeyDown(e) {
  if (e.target?.matches && e.target.matches("input, textarea, select")) return;

  // Ctrl+S — quick save
  if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    if (session.bytes && getAllObjects().length > 0) run();
    return;
  }

  if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
    e.preventDefault();
    copySelected();
    return;
  }
  if (e.ctrlKey && (e.key === "v" || e.key === "V")) {
    e.preventDefault();
    pasteSelected();
    return;
  }
  if (e.ctrlKey && (e.key === "]" || e.key === "[")) {
    e.preventDefault();
    if (session.selectedIds.length === 1) {
      if (e.key === "]") bringForward(session.selectedIds[0]);
      else sendBackward(session.selectedIds[0]);
    }
    return;
  }
  if (e.ctrlKey && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (session.selectedIds.length) {
      e.preventDefault();
      const remaining = getCurrentObjects().filter((o) => !session.selectedIds.includes(o.id));
      setCurrentObjects(remaining, true);
      session.selectedIds = [];
      session.board?.setSelectedIds([]);
      renderObjectsOnLayer();
      renderInspectorLayers();
      syncInspectorWithSelection();
    }
    return;
  }
  if (e.ctrlKey && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    session.ui?.flDuplicate?.click();
    return;
  }
  if (e.ctrlKey && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    session.selectedIds = getCurrentObjects().map((o) => o.id);
    session.board?.setSelectedIds(session.selectedIds);
    renderObjectsOnLayer();
    renderInspectorLayers();
    syncInspectorWithSelection();
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    if (session.selectedIds.length) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
      // In PDF coords y goes up, but visually ArrowUp should move the object
      // upward on screen (which means INCREASING y in PDF space, but the
      // screen formula is topPx = (h - (y + height)) * z, so increasing y
      // moves the element UP visually). Original had ArrowUp = +step which is
      // correct for PDF space AND visual direction. Re-checked: the bug was
      // actually that ArrowDown = -step moves objects UP visually. Fix: swap.
      const dy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
      const updated = getCurrentObjects().map((o) =>
        session.selectedIds.includes(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o
      );
      setCurrentObjects(updated, false);
    }
  }
}

export function enter() {
  const root = document.getElementById("view-edit");
  if (!session.ui || !root?.querySelector("#edit-workspace")) {
    mount(root);
  }
  const restored = restoreSessionFromTab();
  if (!restored && !session.bytes) {
    if (session.ui?.workspace) session.ui.workspace.hidden = true;
    if (session.ui?.drop) session.ui.drop.hidden = false;
  }
  syncChrome();
}

export function leave() {
  saveSessionToTab();
  if (typeof window !== "undefined") {
    window.removeEventListener?.("keydown", handleKeyDown);
  }
}

export function unmount() {
  leave();
  session.board?.destroy();
  if (session.root) {
    session.root.removeEventListener("keydown", handleKeyDown);
    session.root.innerHTML = "";
  }
  removeStyles();
}

export function acceptFiles(files) {
  const f = files?.find((file) => isPdfFile(file));
  if (f) handleFile(f);
}

export function asTool() {
  return {
    id,
    name: title,
    icon: "icon-edit",
    input: "pdf",
    actionLabel: "حفظ التحرير",
    outputName: suggestedName,
    setup: () => mount(),
    enter,
    leave,
    run,
    isDirty,
    acceptFiles
  };
}
