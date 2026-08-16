import { el, qsa } from "../dom.js";
import { PAGE_SIZES } from "../config.js";
import { baseName, filesKey, humanSize, saveFile, saveFolder, withExtension } from "../lib/files.js";
import { bitmapToBytes } from "../lib/bitmap.js";
import { lib } from "../pdf/core.js";
import { ScanEngine } from "../scan/client.js";
import { autoUpscaleIfSmall } from "../enhance/quality.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { pad, reportFailure, reportSave, uid } from "./shared.js";

/**
 * @typedef {object} ScanPage
 * @property {string} id
 * @property {string} name
 * @property {string} key            worker-side handle for the source pixels
 * @property {ImageBitmap} display   downscaled copy used for the editing canvas
 * @property {number} width          source width in worker pixels
 * @property {number} height
 * @property {Array<{ x: number; y: number }>} corners
 * @property {{ width: number; height: number }} size
 * @property {string} mode
 * @property {number} rotate
 * @property {number} confidence
 * @property {string} method
 * @property {ImageBitmap | null} result
 * @property {string} resultKey      invalidation stamp for the cached result
 */

/**
 * Extracted documents are zoomed crops, so every source pixel counts:
 * work at a higher ceiling to preserve ink detail for the upscaler.
 */
const WORK_MAX = 3600;
const DISPLAY_MAX = 1400;
const HANDLE_HIT = 28;
const EDGE_HIT = 16;

/** Live canvas filters — export still uses engine.process(). */
const MODE_FILTER = {
  original: "none",
  color: "contrast(1.12) saturate(0.95) brightness(1.06)",
  sharp: "contrast(1.4) saturate(0.65) brightness(1.02)",
  gray: "grayscale(1) contrast(1.15)",
  bw: "grayscale(1) contrast(2.4) brightness(1.08)"
};

const engine = new ScanEngine();
/** @type {ScanPage[]} */
let pages = [];
let index = 0;
let acceptedKey = "";
/** @type {number} corner index, or -1 */
let dragging = -1;
/** @type {number} edge start-corner index, or -1 */
let draggingEdge = -1;
let selected = 0;
/** @type {{ x: number; y: number } | null} */
let lastPointer = null;
/** @type {HTMLCanvasElement | null} */
let canvas = null;
let renderQueued = false;

const current = () => pages[index] ?? null;

function stampOf(page) {
  return `${page.mode}|${page.rotate}|${page.corners.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(";")}`;
}

function turnsOf(page) {
  return (((Math.round((page.rotate || 0) / 90) % 4) + 4) % 4);
}

/** Source pixel → top-left of the clockwise-rotated bounding box. */
function mapSourceToRotated(x, y, width, height, turns) {
  if (turns === 1) return { x: height - y, y: x };
  if (turns === 2) return { x: width - x, y: height - y };
  if (turns === 3) return { x: y, y: width - x };
  return { x, y };
}

function mapRotatedToSource(rx, ry, width, height, turns) {
  if (turns === 1) return { x: ry, y: height - rx };
  if (turns === 2) return { x: width - rx, y: height - ry };
  if (turns === 3) return { x: width - ry, y: rx };
  return { x: rx, y: ry };
}

function screenDeltaToSource(dx, dy, turns) {
  if (turns === 1) return { x: dy, y: -dx };
  if (turns === 2) return { x: -dx, y: -dy };
  if (turns === 3) return { x: -dy, y: dx };
  return { x: dx, y: dy };
}

/* ---------------------------------------------------------------- *
 * Canvas — always the original/display image + corners.
 * Rotate and color filters are live; warped export is never shown here.
 * ---------------------------------------------------------------- */

function layout() {
  const page = current();
  if (!canvas || !page) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetW = Math.max(1, Math.round(rect.width * dpr));
  const targetH = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const turns = turnsOf(page);
  const swap = turns === 1 || turns === 3;
  const boxW = swap ? page.height : page.width;
  const boxH = swap ? page.width : page.height;
  const fit = Math.min(canvas.width / boxW, canvas.height / boxH) * 0.94;
  return {
    source: page.display,
    fit,
    offsetX: (canvas.width - boxW * fit) / 2,
    offsetY: (canvas.height - boxH * fit) / 2,
    sourceW: page.width,
    sourceH: page.height,
    boxW,
    boxH,
    turns
  };
}

function toCanvas(point, box) {
  const mapped = mapSourceToRotated(point.x, point.y, box.sourceW, box.sourceH, box.turns);
  return { x: box.offsetX + mapped.x * box.fit, y: box.offsetY + mapped.y * box.fit };
}

function draw() {
  renderQueued = false;
  const page = current();
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const box = layout();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!page || !box) return;

  ctx.imageSmoothingQuality = "high";
  const drawW = box.sourceW * box.fit;
  const drawH = box.sourceH * box.fit;
  ctx.save();
  ctx.translate(box.offsetX + box.boxW * box.fit / 2, box.offsetY + box.boxH * box.fit / 2);
  ctx.rotate(box.turns * Math.PI / 2);
  ctx.filter = MODE_FILTER[page.mode] || "none";
  ctx.drawImage(box.source, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.filter = "none";
  ctx.restore();

  const ink = getComputedStyle(document.documentElement).getPropertyValue("--act").trim() || "#5e6ad2";
  const points = page.corners.map((point) => toCanvas(point, box));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = "rgba(8, 9, 10, 0.45)";
  ctx.fill("evenodd");
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.stroke();

  for (const [i, point] of points.entries()) {
    const active = i === dragging || i === selected;
    const radius = (active ? 13 : 10) * (window.devicePixelRatio || 1);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 3 * (window.devicePixelRatio || 1);
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `${11 * (window.devicePixelRatio || 1)}px "Playfair Display", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), point.x, point.y);
  }
}

function scheduleDraw() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(draw);
}

function pointerToSource(event, box) {
  const rect = canvas.getBoundingClientRect();
  const dpr = canvas.width / rect.width;
  const canvasX = (event.clientX - rect.left) * dpr;
  const canvasY = (event.clientY - rect.top) * dpr;
  const rx = (canvasX - box.offsetX) / box.fit;
  const ry = (canvasY - box.offsetY) / box.fit;
  const source = mapRotatedToSource(rx, ry, box.sourceW, box.sourceH, box.turns);
  return { x: source.x, y: source.y, canvasX, canvasY };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clampCorner(page, point) {
  return {
    x: Math.max(0, Math.min(page.width, point.x)),
    y: Math.max(0, Math.min(page.height, point.y))
  };
}

function markDirty(page, message) {
  page.result = null;
  if (message) updateMeta(message);
}

function wireCanvas() {
  if (!canvas) return;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", (event) => {
    const page = current();
    const box = layout();
    if (!page || !box) return;
    const spot = pointerToSource(event, box);
    let nearest = -1;
    let best = HANDLE_HIT * (window.devicePixelRatio || 1);
    page.corners.forEach((corner, i) => {
      const point = toCanvas(corner, box);
      const distance = Math.hypot(point.x - spot.canvasX, point.y - spot.canvasY);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    if (nearest >= 0) {
      dragging = nearest;
      draggingEdge = -1;
      selected = nearest;
      lastPointer = { x: spot.x, y: spot.y };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
      scheduleDraw();
      return;
    }

    const edgeLimit = EDGE_HIT * (window.devicePixelRatio || 1);
    let edge = -1;
    let edgeBest = edgeLimit;
    const canvasPoints = page.corners.map((corner) => toCanvas(corner, box));
    for (let i = 0; i < 4; i++) {
      const a = canvasPoints[i];
      const b = canvasPoints[(i + 1) % 4];
      const distance = distToSegment(spot.canvasX, spot.canvasY, a.x, a.y, b.x, b.y);
      if (distance < edgeBest) {
        edgeBest = distance;
        edge = i;
      }
    }
    if (edge < 0) return;
    dragging = -1;
    draggingEdge = edge;
    selected = edge;
    lastPointer = { x: spot.x, y: spot.y };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    scheduleDraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragging < 0 && draggingEdge < 0) return;
    const page = current();
    const box = layout();
    if (!page || !box) return;
    const spot = pointerToSource(event, box);
    if (dragging >= 0) {
      page.corners[dragging] = clampCorner(page, spot);
      selected = dragging;
    } else if (draggingEdge >= 0 && lastPointer) {
      const dx = spot.x - lastPointer.x;
      const dy = spot.y - lastPointer.y;
      const a = draggingEdge;
      const b = (draggingEdge + 1) % 4;
      page.corners[a] = clampCorner(page, { x: page.corners[a].x + dx, y: page.corners[a].y + dy });
      page.corners[b] = clampCorner(page, { x: page.corners[b].x + dx, y: page.corners[b].y + dy });
    }
    lastPointer = { x: spot.x, y: spot.y };
    scheduleDraw();
  });

  const release = () => {
    if (dragging < 0 && draggingEdge < 0) return;
    dragging = -1;
    draggingEdge = -1;
    lastPointer = null;
    const page = current();
    if (page) markDirty(page, "حدود يدوية.");
    scheduleDraw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("keydown", (event) => {
    const page = current();
    if (!page || selected < 0) return;
    const step = event.shiftKey ? 12 : 2;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const screen = map[event.key];
    if (!screen) return;
    event.preventDefault();
    const delta = screenDeltaToSource(screen[0], screen[1], turnsOf(page));
    const corner = page.corners[selected];
    page.corners[selected] = clampCorner(page, { x: corner.x + delta.x, y: corner.y + delta.y });
    markDirty(page, "حدود يدوية.");
    scheduleDraw();
  });

  window.addEventListener("resize", scheduleDraw);
}

/* ---------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------- */

function updateMeta(text) {
  const node = el("scan-detect-meta");
  if (node) node.textContent = text;
}

function refresh() {
  const has = pages.length > 0;
  el("scan-workspace").hidden = !has;
  el("scan-start").hidden = has;

  if (!has) {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
    return;
  }

  index = Math.max(0, Math.min(index, pages.length - 1));
  const page = current();
  el("scan-count").textContent = `${index + 1} / ${pages.length}`;
  /** @type {HTMLButtonElement} */ (el("scan-prev")).disabled = index === 0;
  /** @type {HTMLButtonElement} */ (el("scan-next")).disabled = index === pages.length - 1;

  for (const input of qsa('input[name="scan-mode"]')) {
    /** @type {HTMLInputElement} */ (input).checked = input.value === page.mode;
  }

  const confidence = Math.round(page.confidence * 100);
  updateMeta(
    page.method === "fallback"
      ? "لم نتعرّف على حواف واضحة — اسحب الأركان يدوياً."
      : `كشف تلقائي بثقة ${confidence}% — عدّل الأركان إن لزم.`
  );

  setSource({ label: page.name, pages: String(pages.length), size: `${page.size.width}×${page.size.height}` });
  setRunEnabled(true);
  setState("idle");
  if (!/\S/.test(el("tb-name").value)) setName("مستند-ممسوح.pdf");
  syncOutputLabel();
  scheduleDraw();
}

function syncOutputLabel() {
  const format = /** @type {HTMLSelectElement} */ (el("scan-output")).value;
  el("tb-run-label").textContent = format === "pdf" ? "إنشاء PDF" : "حفظ الصور";
  const name = el("tb-name");
  if (name instanceof HTMLInputElement && format !== "pdf" && /\.pdf$/i.test(name.value)) {
    name.value = baseName(name.value);
  }
}

/** @param {File[]} files */
async function add(files) {
  startProgress({ title: "تحليل الصور", desc: "نكتشف حواف الورقة في كل صورة." });
  try {
    for (const [order, file] of files.entries()) {
      throwIfCancelled();
      updateProgress({ percent: (order / files.length) * 100, detail: file.name });

      const decoded = await createImageBitmap(file);
      const workScale = Math.min(1, WORK_MAX / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * workScale));
      const height = Math.max(1, Math.round(decoded.height * workScale));

      const buffer = document.createElement("canvas");
      buffer.width = width;
      buffer.height = height;
      const ctx = buffer.getContext("2d", { alpha: false, willReadFrequently: true });
      ctx.drawImage(decoded, 0, 0, width, height);
      decoded.close();

      const displayScale = Math.min(1, DISPLAY_MAX / Math.max(width, height));
      const display = await createImageBitmap(buffer, {
        resizeWidth: Math.max(1, Math.round(width * displayScale)),
        resizeHeight: Math.max(1, Math.round(height * displayScale)),
        resizeQuality: "high"
      });

      const pixels = ctx.getImageData(0, 0, width, height);
      buffer.width = 0;
      buffer.height = 0;

      const key = uid("scan");
      await engine.load(key, pixels);
      const detection = await engine.detect(key);

      pages.push({
        id: uid("page"),
        name: file.name,
        key,
        display,
        width,
        height,
        corners: detection.corners,
        size: detection.size,
        mode: "color",
        rotate: 0,
        confidence: detection.confidence,
        method: detection.method,
        result: null,
        resultKey: ""
      });
      index = pages.length - 1;
    }
  } catch (error) {
    reportFailure(error, "تعذّر تحليل الصورة.");
  } finally {
    endProgress();
    syncPreviewButton();
    refresh();
  }
}

async function removeCurrent() {
  const page = current();
  if (!page) return;
  page.display.close();
  page.result?.close();
  await engine.release(page.key);
  pages.splice(index, 1);
  if (index >= pages.length) index = pages.length - 1;
  syncPreviewButton();
  refresh();
}

async function clearAll() {
  for (const page of pages) {
    page.display.close();
    page.result?.close();
    engine.release(page.key);
  }
  pages = [];
  index = 0;
  acceptedKey = "";
  syncPreviewButton();
  refresh();
}

async function acceptFiles(files) {
  if (!files?.length) return;
  const key = filesKey(files);
  if (key === acceptedKey && pages.length) return;
  if (pages.length) await clearAll();
  acceptedKey = key;
  await add(files);
}

async function redetect() {
  const page = current();
  if (!page) return;
  startProgress({ title: "إعادة الكشف", desc: page.name, cancellable: false });
  try {
    const detection = await engine.detect(page.key);
    page.corners = detection.corners;
    page.size = detection.size;
    page.confidence = detection.confidence;
    page.method = detection.method;
    page.result = null;
  } catch (error) {
    reportFailure(error, "تعذّر الكشف التلقائي.");
  } finally {
    endProgress();
    refresh();
  }
}

function useFullFrame() {
  const page = current();
  if (!page) return;
  page.corners = [
    { x: 0, y: 0 },
    { x: page.width, y: 0 },
    { x: page.width, y: page.height },
    { x: 0, y: page.height }
  ];
  page.size = { width: page.width, height: page.height };
  page.method = "manual";
  page.confidence = 1;
  page.result = null;
  updateMeta("الصورة كاملة بدون قص.");
  scheduleDraw();
}

/** @returns {Promise<ImageBitmap>} */
async function renderResult(page) {
  const stamp = stampOf(page);
  if (page.result && page.resultKey === stamp) return page.result;
  const output = await engine.process(page.key, {
    corners: page.corners,
    size: page.size,
    mode: page.mode,
    rotate: page.rotate
  });
  const pixels = new ImageData(output.image.data, output.image.width, output.image.height);
  let result = await createImageBitmap(pixels);
  result = await autoUpscaleIfSmall(result);
  page.result?.close();
  page.result = result;
  page.resultKey = stamp;
  return page.result;
}

function syncPreviewButton() {
  const button = el("scan-preview");
  if (!button) return;
  button.classList.add("btn--act");
  const label = button.querySelector(".btn__label");
  if (label) label.textContent = "معاينة";
  button.setAttribute("aria-pressed", "true");
  const hint = el("scan-hint");
  if (hint) {
    hint.textContent = "اسحب الأركان على الصورة الأصلية. التدوير والألوان تظهر فوراً.";
  }
}

function focusLivePreview() {
  canvas?.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- *
 * Export
 * ---------------------------------------------------------------- */

async function run() {
  if (!pages.length) return;
  const format = /** @type {HTMLSelectElement} */ (el("scan-output")).value;

  setState("busy");
  startProgress({ title: "معالجة المستند", desc: "تسوية المنظور، ثم تحسين الإضاءة." });
  try {
    if (format === "pdf") {
      const { PDFDocument } = lib();
      const doc = await PDFDocument.create();

      for (const [order, page] of pages.entries()) {
        throwIfCancelled();
        updateProgress({ percent: (order / pages.length) * 100, detail: `صفحة ${order + 1} من ${pages.length}` });
        const bitmap = await renderResult(page);
        const bytes = await bitmapToBytes(bitmap, "image/jpeg", 0.9);
        const embedded = await doc.embedJpg(bytes);

        const landscape = embedded.width > embedded.height;
        const sheet = PAGE_SIZES.a4;
        const pageWidth = landscape ? sheet.height : sheet.width;
        const pageHeight = landscape ? sheet.width : sheet.height;
        const created = doc.addPage([pageWidth, pageHeight]);
        const scale = Math.min(pageWidth / embedded.width, pageHeight / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        created.drawImage(embedded, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight
        });
      }

      throwIfCancelled();
      updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
      const bytes = await doc.save();
      endProgress();
      const saved = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
      reportSave(saved, `تم مسح ${pages.length} صفحة إلى ملف PDF.`);
      return;
    }

    const mime = format === "png" ? "image/png" : "image/jpeg";
    const extension = format === "png" ? "png" : "jpg";
    const digits = String(pages.length).length;
    /** @type {Array<{ name: string; data: Uint8Array }>} */
    const files = [];

    for (const [order, page] of pages.entries()) {
      throwIfCancelled();
      updateProgress({ percent: (order / pages.length) * 100, detail: `صورة ${order + 1} من ${pages.length}` });
      const bitmap = await renderResult(page);
      files.push({
        name: `${baseName(el("tb-name").value || "مستند-ممسوح")}-${pad(order + 1, digits)}.${extension}`,
        data: await bitmapToBytes(bitmap, mime, 0.92)
      });
    }

    throwIfCancelled();
    endProgress();
    if (files.length === 1) {
      const saved = await saveFile(files[0].data, files[0].name, format === "png" ? "png" : "jpeg");
      reportSave(saved, "تم حفظ الصورة الممسوحة.");
      return;
    }
    const saved = await saveFolder(files, el("tb-name").value || "مستند-ممسوح");
    reportSave(saved, `تم حفظ ${files.length} صورة.`);
  } catch (error) {
    reportFailure(error, "تعذّرت المعالجة.");
  } finally {
    endProgress();
  }
}

/* ---------------------------------------------------------------- *
 * Tool
 * ---------------------------------------------------------------- */

/** @type {import("../ui/router.js").Tool} */
export const scanTool = {
  id: "scan",
  name: "صور → PDF",
  icon: "icon-scan",
  input: "صورة",
  actionLabel: "أنشئ",
  outputName: () => "مستند-ممسوح.pdf",

  setup() {
    canvas = /** @type {HTMLCanvasElement} */ (el("scan-canvas"));
    wireCanvas();
    wireIntake({ dropId: "scan-drop", inputId: "scan-input", browseId: "scan-browse", accept: "image", onFiles: add });

    el("scan-add")?.addEventListener("click", () => el("scan-input").click());
    el("scan-clear")?.addEventListener("click", clearAll);
    el("scan-remove")?.addEventListener("click", removeCurrent);
    el("scan-redetect")?.addEventListener("click", redetect);
    el("scan-full")?.addEventListener("click", useFullFrame);
    el("scan-preview")?.addEventListener("click", focusLivePreview);

    el("scan-prev")?.addEventListener("click", () => {
      if (index > 0) {
        index -= 1;
        refresh();
      }
    });
    el("scan-next")?.addEventListener("click", () => {
      if (index < pages.length - 1) {
        index += 1;
        refresh();
      }
    });

    el("scan-rotate")?.addEventListener("click", () => {
      const page = current();
      if (!page) return;
      page.rotate = (page.rotate + 90) % 360;
      page.result = null;
      scheduleDraw();
    });

    for (const input of qsa('input[name="scan-mode"]')) {
      input.addEventListener("change", () => {
        const page = current();
        if (!page) return;
        page.mode = /** @type {HTMLInputElement} */ (input).value;
        page.result = null;
        scheduleDraw();
      });
    }

    el("scan-output")?.addEventListener("change", syncOutputLabel);
    syncPreviewButton();
  },

  enter: refresh,
  acceptFiles,
  run
};
