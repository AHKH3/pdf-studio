import { el, qsa, yieldToUi } from "../dom.js";
import { MM_TO_PT, PAGE_SIZES } from "../config.js";
import { baseName, filesKey, saveFile, saveFolder, withExtension } from "../lib/files.js";
import { ensureDecodableImage } from "../lib/heic.js";
import { bitmapToBytes } from "../lib/bitmap.js";
import { lib } from "../pdf/core.js";
import { ScanEngine } from "../scan/client.js";
import { guardQuad } from "../scan/pipeline.js";
import { autoUpscaleIfSmall } from "../enhance/quality.js";
import { cancelledError, endProgress, isCancelled, isCancellation, setSkipHandler, setSkipVisible, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { confirmReplace } from "../ui/dialog.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { pad, readInputValues, reportFailure, reportSave, tabTitle, uid, writeInputValues } from "./shared.js";

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
 * @property {boolean} accepted      corners reviewed and pinned by the user
 * @property {{ prev: Array<{ x: number; y: number }>; prevAccepted: boolean } | null} review
 *                                  pending precise-detection awaiting accept/cancel
 */

/**
 * Extracted documents are zoomed crops, so every source pixel counts:
 * work at a higher ceiling to preserve ink detail for the upscaler.
 */
const WORK_MAX = 3600;
const DISPLAY_MAX = 1400;

/**
 * Per-page ceiling for the quality-upscale stage (AI + polish). TF/WASM
 * inference cannot be aborted mid-flight, so on expiry we continue with
 * the original pixels instead of hanging the export forever.
 */
const UPSCALE_STAGE_TIMEOUT_MS = 240000;
/** Pages that fell back to original quality in the current run. */
let upscaleFallbacks = 0;
/** Set by the overlay's "skip upscale" button: finish now with native pixels. */
let skipUpscale = false;
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
let showingResult = false;
/** Debounce timer for the live final-shape preview while editing. */
let previewTimer = 0;
/** قيم المدخلات الافتراضية (لتاب جديدة لا ترث إعدادات تاب أخرى). */
let defaultInputs = null;
let defaultMode = "color";
let togglePopover = () => {};

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

/** Paper sheet (in PDF points) for the final-shape preview, mirroring run(). */
function paperSheetForPage(resultW, resultH) {
  const preset = /** @type {HTMLSelectElement} */ (el("scan-page"))?.value || "a4";
  const orientation = /** @type {HTMLSelectElement} */ (el("scan-orient"))?.value || "auto";
  if (preset === "fit") return { paperW: resultW, paperH: resultH, margin: 0 };
  const base = PAGE_SIZES[preset] ?? PAGE_SIZES.a4;
  const landscape = orientation === "landscape" || (orientation === "auto" && resultW > resultH);
  const margin = Math.max(0, Number(/** @type {HTMLInputElement} */ (el("scan-margin"))?.value) || 0) * MM_TO_PT;
  return {
    paperW: landscape ? base.height : base.width,
    paperH: landscape ? base.width : base.height,
    margin
  };
}

function draw() {
  renderQueued = false;
  const page = current();
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const box = layout();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!page || !box) return;

  if (showingResult && page.result) {
    // Final-shape preview: the export bitmap placed on the selected paper
    // sheet with the configured margin — exactly like run() lays it out.
    const sheet = paperSheetForPage(page.result.width, page.result.height);
    const fit = Math.min(canvas.width / sheet.paperW, canvas.height / sheet.paperH) * 0.96;
    const pw = sheet.paperW * fit;
    const ph = sheet.paperH * fit;
    const px = (canvas.width - pw) / 2;
    const py = (canvas.height - ph) / 2;
    const m = Math.max(0, Math.min(sheet.margin * fit, pw / 2 - 1, ph / 2 - 1));
    const boxW = Math.max(1, pw - m * 2);
    const boxH = Math.max(1, ph - m * 2);
    const scale = Math.min(boxW / page.result.width, boxH / page.result.height);
    const dw = page.result.width * scale;
    const dh = page.result.height * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px, py, pw, ph);
    ctx.drawImage(page.result, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    return;
  }

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
    ctx.font = `${11 * (window.devicePixelRatio || 1)}px "Playfair Display", "Noto Naskh Arabic", serif`;
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
  // A hand edit means the user takes ownership of these corners — even
  // mid-review, so a later cancel can never eat hand-drawn work.
  page.review = null;
  page.accepted = true;
  if (message) updateMeta(message);
  syncHint();
  if (showingResult) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshResultPreview(), 600);
  }
}

/** Re-renders the live final-shape preview after an edit (debounced). */
async function refreshResultPreview() {
  const page = current();
  if (!page || !showingResult) return;
  try {
    await renderResult(page);
  } catch (error) {
    reportFailure(error, "تعذّرت معاينة الناتج.");
    return;
  }
  scheduleDraw();
}

function wireCanvas() {
  if (!canvas) return;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", (event) => {
    const page = current();
    const box = layout();
    if (!page || !box) return;
    // Never drag blind: a press on the final preview steps back to the
    // original first; the next press starts the drag.
    if (showingResult) {
      showingResult = false;
      syncPreviewButton();
      scheduleDraw();
      updateMeta("عدت للأصل — اسحب الأركان.");
      return;
    }
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
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      stepPage(event.key === "PageDown" ? 1 : -1);
      return;
    }
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
  const removeBtn = el("scan-remove");
  if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = !has;

  for (const input of qsa('input[name="scan-mode"]')) {
    /** @type {HTMLInputElement} */ (input).checked = input.value === page.mode;
  }

  const confidence = Math.round(page.confidence * 100);
  if (page.review) {
    updateMeta(
      page.method === "fallback"
        ? "الكشف الدقيق لم يجد حواف واضحة — اسحب الأركان يدويًا ثم اضغط موافق."
        : `كشف دقيق بثقة ${confidence}% بانتظار المراجعة — موافق للتثبيت أو إلغاء للرجوع.`
    );
  } else if (page.method === "fallback") {
    updateMeta("لم نتعرّف على حواف واضحة — اسحب الأركان يدوياً.");
  } else if (!page.accepted) {
    updateMeta(`كشف تلقائي بثقة ${confidence}% — راجعه ثم ثبّته.`);
  } else {
    updateMeta(`كشف تلقائي بثقة ${confidence}% — عدّل الأركان إن لزم.`);
  }

  // Stage detect button mirrors the review state (accept while staged).
  const detectLabel = el("scan-stage-detect")?.querySelector(".btn__label");
  if (detectLabel) detectLabel.textContent = page.review ? "موافق ✓" : "كشف دقيق";
  const cancel = el("scan-cancel");
  if (cancel) cancel.hidden = !page.review;

  setSource({ label: page.name, pages: String(pages.length), size: `${page.size.width}×${page.size.height}` });
  setRunEnabled(true);
  setState("idle");
  if (!/\S/.test(el("tb-name").value)) setName("مستند-ممسوح.pdf");
  const scanName = el("scan-name");
  if (scanName instanceof HTMLInputElement && !/\S/.test(scanName.value)) {
    scanName.value = el("tb-name").value || "مستند-ممسوح.pdf";
  }
  syncOutputLabel();
  renderStrip();
  syncStripSortable();
  syncHint();
  scheduleDraw();
}

function syncOutputLabel() {
  const format = /** @type {HTMLSelectElement} */ (el("scan-output")).value;
  const label = format === "pdf" ? "إنشاء PDF" : "حفظ الصور";
  el("tb-run-label").textContent = label;
  const saveLabel = el("scan-save-label");
  if (saveLabel) saveLabel.textContent = label;
  const pages = el("scan-pages-details");
  if (pages) pages.hidden = format !== "pdf";
  const name = el("tb-name");
  if (name instanceof HTMLInputElement && format !== "pdf" && /\.pdf$/i.test(name.value)) {
    name.value = baseName(name.value);
  }
  const sName = el("scan-name");
  if (sName instanceof HTMLInputElement) {
    if (format !== "pdf" && /\.pdf$/i.test(sName.value)) {
      sName.value = baseName(sName.value);
    } else if (format === "pdf" && !/\.pdf$/i.test(sName.value)) {
      sName.value = withExtension(sName.value, "pdf");
    }
  }
}

/** @param {File[]} files */
async function add(files) {
  // Appending must land on the first NEW page, not rewind a reviewed batch.
  const firstNew = pages.length;
  startProgress({ title: "تحليل الصور", desc: "نكتشف حواف الورقة في كل صورة." });
  try {
    for (const [order, file] of files.entries()) {
      throwIfCancelled();
      updateProgress({ percent: (order / files.length) * 100, detail: file.name });

      const decodable = await ensureDecodableImage(file);
      const decoded = await createImageBitmap(decodable);
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
      // Guard against stray-corner detections that explode the output size:
      // fall back to the full frame and leave the page unaccepted for review.
      const guard = guardQuad(detection.corners, { width, height });
      const usable = detection.method !== "fallback" && guard.ok;

      pages.push({
        id: uid("page"),
        name: file.name,
        key,
        display,
        width,
        height,
        corners: usable
          ? detection.corners
          : [
              { x: 0, y: 0 },
              { x: width, y: 0 },
              { x: width, y: height },
              { x: 0, y: height }
            ],
        size: detection.size,
        mode: "color",
        rotate: 0,
        confidence: usable ? detection.confidence : 0,
        method: usable ? detection.method : "fallback",
        accepted: usable,
        review: null,
        result: null,
        resultKey: ""
      });
    }
    // Review starts at the first new page: the batch was extracted start→end.
    index = Math.min(firstNew, Math.max(0, pages.length - 1));
    if (firstNew === 0 && files.length > 0) {
      const suggested = withExtension(baseName(files[0].name), "pdf");
      setName(suggested);
      const sName = el("scan-name");
      if (sName instanceof HTMLInputElement) sName.value = suggested;
    }
  } catch (error) {
    reportFailure(error, "تعذّر تحليل الصورة.");
  } finally {
    endProgress();
    syncPreviewButton();
    refresh();
  }
}

/** انقل الصفحة الحالية delta مواضع في ترتيب التصدير (سالب = تقديم، موجب = تأخير). */
function moveCurrent(delta) {
  if (pages.length < 2) return;
  const to = index + delta;
  if (to < 0 || to >= pages.length) return;
  const [page] = pages.splice(index, 1);
  pages.splice(to, 0, page);
  index = to;
  refresh();
}

/** Move the current page, clamped to the strip bounds. */
function stepPage(delta) {
  if (pages.length < 2) return;
  index = Math.max(0, Math.min(pages.length - 1, index + delta));
  refresh();
}

/** Closes a page's bitmaps and frees its worker-side pixels. */
async function discardPage(page) {
  if (!page) return;
  page.display.close();
  page.result?.close();
  await engine.release(page.key);
}

async function removeCurrent() {
  const page = current();
  if (!page) return;
  pages.splice(index, 1);
  await discardPage(page);
  if (index >= pages.length) index = pages.length - 1;
  if (index < 0) index = 0;
  syncPreviewButton();
  refresh();
}

async function removePageById(id) {
  const at = pages.findIndex((page) => page.id === id);
  if (at < 0) return;
  const [page] = pages.splice(at, 1);
  await discardPage(page);
  if (index >= pages.length) index = pages.length - 1;
  if (index < 0) index = 0;
  syncPreviewButton();
  refresh();
}

/* ---------------------------------------------------------------- *
 * Filmstrip — click to jump, drag to reorder, × to remove.
 * ---------------------------------------------------------------- */

let stripKey = "";
let stripSortable = null;

function thumbCover(ctx, bitmap, width, height) {
  // Contain (like the edit rail): the whole page stays visible, letterboxed.
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function renderStrip() {
  const host = el("scan-strip");
  if (!host) return;
  const flags = pages.map((page) => (page.review ? "r" : page.accepted ? "a" : "n")).join("");
  const key = `${pages.map((page) => page.id).join(",")}|${index}|${flags}`;
  if (key === stripKey && host.childElementCount === pages.length) {
    let position = 0;
    for (const node of host.children) {
      const active = position === index;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
      position += 1;
    }
    return;
  }
  stripKey = key;
  host.replaceChildren();
  pages.forEach((page, position) => {
    const thumb = document.createElement("div");
    thumb.className = "scan-page" + (position === index ? " is-active" : "");
    thumb.dataset.id = page.id;
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "option");
    thumb.setAttribute("aria-selected", String(position === index));
    thumb.setAttribute("aria-label", `صفحة ${position + 1}: ${page.name}`);
    thumb.title = `صفحة ${position + 1} — ثقة ${Math.round(page.confidence * 100)}% — اضغط للانتقال، اسحب لإعادة الترتيب، Delete للإزالة`;
    const shot = document.createElement("span");
    shot.className = "scan-page__img";
    const preview = document.createElement("canvas");
    preview.width = 120;
    preview.height = 160;
    const ctx = preview.getContext("2d", { alpha: false });
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 120, 160);
      thumbCover(ctx, page.display, 120, 160);
    }
    shot.append(preview);
    const num = document.createElement("span");
    num.className = "scan-page__num";
    num.textContent = String(position + 1);
    const flag = document.createElement("span");
    flag.className = "strip__flag" + (page.review || !page.accepted ? " is-pending" : "");
    flag.textContent = page.review ? "…" : page.accepted ? "✓" : "!";
    flag.title = page.review ? "بانتظار المراجعة" : page.accepted ? "مثبتة" : "تحتاج مراجعة";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "strip__remove";
    remove.dataset.remove = page.id;
    remove.setAttribute("aria-label", `إزالة صفحة ${position + 1}`);
    remove.title = "إزالة هذه الصفحة";
    remove.textContent = "×";
    thumb.append(shot, num, flag, remove);
    host.append(thumb);
  });
}

function syncStripSortable() {
  const host = el("scan-strip");
  if (!host || stripSortable) return;
  const SortableLib = /** @type {any} */ (window).Sortable;
  if (!SortableLib) return;
  stripSortable = new SortableLib(host, {
    animation: 150,
    draggable: ".scan-page",
    filter: ".strip__remove",
    preventOnFilter: false,
    direction: "vertical",
    ghostClass: "is-ghost",
    chosenClass: "is-chosen",
    forceFallback: true,
    fallbackOnBody: true,
    scroll: true,
    scrollSensitivity: 60,
    onEnd: () => {
      const ids = Array.from(host.querySelectorAll(".scan-page")).map(
        (node) => /** @type {HTMLElement} */ (node).dataset.id
      );
      applyStripOrder(ids.filter(Boolean));
    }
  });
}

function applyStripOrder(ids) {
  if (!ids.length || ids.length !== pages.length) {
    renderStrip();
    return;
  }
  const currentId = current()?.id;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const next = [];
  for (const id of ids) {
    const page = byId.get(id);
    if (page) next.push(page);
  }
  if (next.length !== pages.length) {
    renderStrip();
    return;
  }
  pages = next;
  index = Math.max(0, next.findIndex((page) => page.id === currentId));
  stripKey = "";
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
  setName("مستند-ممسوح.pdf");
  const sName = el("scan-name");
  if (sName instanceof HTMLInputElement) sName.value = "مستند-ممسوح.pdf";
  syncPreviewButton();
  refresh();
}

async function acceptFiles(files) {
  if (!files?.length) return;
  const key = filesKey(files);
  if (key === acceptedKey && pages.length) return;
  if (pages.length) {
    const ok = await confirmReplace(pages[0]?.name || "المستند الحالي");
    if (!ok) return;
    await clearAll();
  }
  acceptedKey = key;
  await add(files);
}

/**
 * Per-page precise detection. Runs from the ORIGINAL pixels through the
 * multi-recipe worker pass, then stages the new quad for review: the stage
 * button flips to "accept" and cancel appears. Nothing is pinned until
 * the user accepts, so hand-tuned corners are never silently destroyed.
 */
async function redetect() {
  const page = current();
  if (!page || page.review) return;
  startProgress({ title: "كشف دقيق", desc: page.name, cancellable: false });
  try {
    const detection = await engine.detect(page.key, { precise: true });
    const guard = guardQuad(detection.corners, { width: page.width, height: page.height });
    // Review happens on the ORIGINAL pixels: drop any result preview so
    // the staged quad is judged on the untouched image, live.
    showingResult = false;
    syncPreviewButton();
    page.review = { prev: page.corners, prevAccepted: page.accepted };
    if (detection.method !== "fallback" && guard.ok) {
      page.corners = detection.corners;
      page.size = detection.size;
      page.confidence = detection.confidence;
      page.method = detection.method;
    } else {
      // No usable quad: keep the old corners under the manual handles and
      // let the user draw the quad by hand, then accept.
      page.confidence = 0;
      page.method = "fallback";
    }
    page.accepted = false;
    page.result = null;
  } catch (error) {
    reportFailure(error, "تعذّر الكشف التلقائي.");
  } finally {
    endProgress();
    refresh();
  }
}

/** Pin the staged precise-detection corners, then show the final shape live. */
async function acceptDetection() {
  const page = current();
  if (!page || !page.review) return;
  page.review = null;
  page.accepted = true;
  page.result = null;
  updateMeta(`تم تثبيت الكشف بثقة ${Math.round(page.confidence * 100)}%.`);
  refresh();
  if (!showingResult) await toggleResultPreview();
}

/** Discard the staged detection and restore the previous corners. */
function cancelDetection() {
  const page = current();
  if (!page || !page.review) return;
  page.corners = page.review.prev;
  page.accepted = page.review.prevAccepted;
  page.review = null;
  page.result = null;
  refresh();
}

/** Precise detection for every unaccepted page; accepted pages are skipped. */
async function detectAll() {
  // Never stomp a staged review: those corners await the user's verdict.
  const skippedReview = pages.filter((page) => page.review).length;
  const targets = pages.filter((page) => !page.accepted && !page.review);
  if (!targets.length) {
    updateMeta(
      skippedReview > 0
        ? "بقيت صفحات بانتظار مراجعتك فقط — ثبّتها بموافق أو إلغاء."
        : "كل الصفحات مثبتة — لا شيء لكشفه."
    );
    return;
  }
  startProgress({ title: "كشف الكل", desc: `كشف دقيق لـ ${targets.length} صفحة.` });
  let pinned = 0;
  try {
    for (const [order, page] of targets.entries()) {
      throwIfCancelled();
      updateProgress({ percent: (order / targets.length) * 100, detail: page.name });
      try {
        const detection = await engine.detect(page.key, { precise: true });
        const guard = guardQuad(detection.corners, { width: page.width, height: page.height });
        if (detection.method === "fallback" || !guard.ok) continue;
        page.corners = detection.corners;
        page.size = detection.size;
        page.confidence = detection.confidence;
        page.method = detection.method;
        page.accepted = true;
        page.review = null;
        page.result = null;
        pinned++;
      } catch {
        // Keep the old corners and continue with the next page.
      }
    }
    updateMeta(`ثُبّت ${pinned} من ${targets.length} صفحة — راجع الباقي يدويًا.`);
  } catch (error) {
    reportFailure(error, "تعذّر كشف الكل.");
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
  page.accepted = true;
  page.review = null;
  page.result = null;
  updateMeta("الصورة كاملة بدون قص.");
  scheduleDraw();
}

/**
 * Races a long stage against the stop button (polled) and an optional
 * timeout. Worker/TF work cannot be aborted mid-flight — we stop waiting
 * for it instead, so the overlay can always close promptly. A late result
 * is simply ignored.
 * @template T
 * @param {Promise<T>} promise already-started stage promise
 * @param {{ timeoutMs?: number; timeoutMessage?: string; onTick?: (elapsed: number) => void; skipIf?: (() => boolean) | null; skipValue?: T }} [options]
 * @returns {Promise<T>}
 */
function awaitStage(promise, options = {}) {
  const { timeoutMs = 0, timeoutMessage = "", onTick = null, skipIf = null, skipValue = undefined } = options;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      fn(value);
    };
    const timer = setInterval(() => {
      const elapsed = Date.now() - t0;
      if (isCancelled()) {
        finish(reject, cancelledError());
        return;
      }
      if (typeof skipIf === "function") {
        let skip = false;
        try {
          skip = skipIf() === true;
        } catch {
          /* a broken predicate must never fail the export */
        }
        if (skip) {
          finish(resolve, skipValue);
          return;
        }
      }
      if (timeoutMs > 0 && elapsed >= timeoutMs) {
        finish(reject, new Error(timeoutMessage || "انتهت المهلة."));
        return;
      }
      if (typeof onTick === "function") {
        try {
          onTick(elapsed);
        } catch {
          /* progress-only; never fail the export */
        }
      }
    }, 500);
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

function reportUpscaleFallbacks() {
  if (upscaleFallbacks > 0) {
    toast(`تخطينا رفع الجودة في ${upscaleFallbacks} من الصفحات لانتهاء المهلة — حُفظت بالجودة الأصلية.`, "info");
    upscaleFallbacks = 0;
  }
}

/**
 * @param {ScanPage} page
 * @param {(frac: number, detail?: string) => void} [onStep] intra-page progress (0..1)
 * @returns {Promise<ImageBitmap>}
 */
async function renderResult(page, onStep) {
  const step = (frac, detail) => {
    if (typeof onStep === "function") onStep(frac, detail);
  };
  const stamp = stampOf(page);
  if (page.result && page.resultKey === stamp) {
    step(1);
    return page.result;
  }
  step(0.05, "تسوية المنظور…");
  const output = await awaitStage(engine.process(page.key, {
    corners: page.corners,
    size: page.size,
    mode: page.mode,
    rotate: page.rotate
  }));
  // Cancellation checkpoints between stages: without them the cancel button
  // never finds a safe step and the overlay looks frozen (stuck at 0%).
  throwIfCancelled();
  const pixels = new ImageData(output.image.data, output.image.width, output.image.height);
  let result = await awaitStage(createImageBitmap(pixels));
  throwIfCancelled();
  // Upscale is opt-in (off by default: it costs minutes per page) and can
  // be skipped mid-run from the overlay — both paths keep native pixels.
  const wantUpscale = !skipUpscale && el("scan-upscale")?.checked === true;
  let upgraded;
  if (!wantUpscale) {
    step(0.9);
    upgraded = result;
  } else {
    step(0.45, "رفع الجودة…");
    try {
      upgraded = await awaitStage(autoUpscaleIfSmall(result), {
        timeoutMs: UPSCALE_STAGE_TIMEOUT_MS,
        timeoutMessage: "انتهت مهلة رفع الجودة.",
        skipIf: () => skipUpscale,
        skipValue: result,
        onTick: (elapsed) => {
          const secs = Math.floor(elapsed / 1000);
          step(Math.min(0.85, 0.45 + secs * 0.005), `رفع الجودة… (${secs} ث)`);
        }
      });
    } catch (error) {
      if (isCancellation(error)) throw error;
      console.warn("scan: upscale stage failed — continuing with original pixels.", error);
      upscaleFallbacks += 1;
      upgraded = result;
    }
  }
  throwIfCancelled();
  step(0.9, "ترميز الصفحة…");
  if (upgraded !== result) {
    result.close();
    result = upgraded;
  }
  page.result?.close();
  page.result = result;
  page.resultKey = stamp;
  setSource({
    label: page.name,
    pages: String(pages.length),
    size: `${result.width}×${result.height}`
  });
  return page.result;
}

function syncPreviewButton() {
  const button = el("scan-preview");
  if (!button) return;
  button.classList.toggle("btn--act", showingResult);
  const label = button.querySelector(".btn__label");
  if (label) label.textContent = showingResult ? "العودة للأصل" : "شاهد النتيجة";
  button.setAttribute("aria-pressed", String(showingResult));
  syncHint();
}

/** The stage hint always describes the CURRENT state — never stale advice. */
function syncHint() {
  const hint = el("scan-hint");
  if (!hint) return;
  const page = current();
  if (!page) return;
  if (page.review) {
    hint.textContent =
      page.method === "fallback"
        ? "الكشف لم يجد حوافًا — اسحب الأركان الأربع ثم اضغط موافق."
        : "راجع الرباعي الجديد — حرّكه بيدك إن لزم، ثم موافق أو إلغاء.";
  } else if (showingResult) {
    hint.textContent = "هذه الجودة النهائية التي ستُصدَّر. اضغط «العودة للأصل» لضبط الأركان.";
  } else {
    hint.textContent = "اسحب الأركان على الصورة الأصلية. اضغط «شاهد النتيجة» لمعاينة الجودة المحسّنة.";
  }
}

function focusLivePreview() {
  canvas?.focus({ preventScroll: true });
}

async function toggleResultPreview() {
  const page = current();
  if (!page) return;
  if (!showingResult) {
    startProgress({ title: "معاينة الناتج", desc: "نحسّن الجودة الآن." });
    let ok = false;
    try {
      await renderResult(page);
      ok = true;
    } catch (error) {
      reportFailure(error, "تعذّرت معاينة الناتج.");
    } finally {
      endProgress();
    }
    showingResult = ok;
  } else {
    showingResult = false;
  }
  syncPreviewButton();
  scheduleDraw();
}

/* ---------------------------------------------------------------- *
 * Export
 * ---------------------------------------------------------------- */

async function run() {
  togglePopover(false);
  if (!pages.length) return;
  const format = /** @type {HTMLSelectElement} */ (el("scan-output")).value;
  const saveButton = /** @type {HTMLButtonElement} */ (el("scan-save"));

  setState("busy");
  if (saveButton) saveButton.disabled = true;
  startProgress({ title: "معالجة المستند", desc: "تسوية المنظور، ثم رفع الجودة." });
  upscaleFallbacks = 0;
  skipUpscale = false;
  setSkipHandler(() => {
    skipUpscale = true;
    updateProgress({ detail: "جارٍ تخطي رفع الجودة…" });
  });
  // The skip button only makes sense while upscale is enabled.
  setSkipVisible(el("scan-upscale")?.checked === true);
  try {
    if (format === "pdf") {
      const { PDFDocument } = lib();
      const doc = await PDFDocument.create();
      const preset = /** @type {HTMLSelectElement} */ (el("scan-page")).value;
      const orientation = /** @type {HTMLSelectElement} */ (el("scan-orient")).value;
      const margin = Math.max(0, Number(/** @type {HTMLInputElement} */ (el("scan-margin")).value) || 0) * MM_TO_PT;

      for (const [order, page] of pages.entries()) {
        throwIfCancelled();
        const pageBase = order / pages.length;
        const pageSpan = 1 / pages.length;
        const detail = `صفحة ${order + 1} من ${pages.length}`;
        updateProgress({ percent: pageBase * 100, detail });
        const bitmap = await renderResult(page, (frac, stepDetail) => {
          const clamped = Math.max(0, Math.min(1, frac));
          updateProgress({ percent: (pageBase + pageSpan * clamped) * 100, detail: stepDetail || detail });
        });
        throwIfCancelled();
        const bytes = await bitmapToBytes(bitmap, "image/jpeg", 0.9);
        throwIfCancelled();
        const embedded = await doc.embedJpg(bytes);

        let pageWidth;
        let pageHeight;
        if (preset === "fit") {
          pageWidth = embedded.width * 0.75 + margin * 2;
          pageHeight = embedded.height * 0.75 + margin * 2;
        } else {
          const base = PAGE_SIZES[preset] ?? PAGE_SIZES.a4;
          const landscape =
            orientation === "landscape" || (orientation === "auto" && embedded.width > embedded.height);
          pageWidth = landscape ? base.height : base.width;
          pageHeight = landscape ? base.width : base.height;
        }
        const created = doc.addPage([pageWidth, pageHeight]);
        const boxWidth = Math.max(1, pageWidth - margin * 2);
        const boxHeight = Math.max(1, pageHeight - margin * 2);
        const scale = Math.min(boxWidth / embedded.width, boxHeight / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        created.drawImage(embedded, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight
        });
        // Let the overlay paint between heavy pages.
        await yieldToUi();
      }

      throwIfCancelled();
      updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
      const bytes = await doc.save();
      endProgress();
      const docName = (/** @type {HTMLInputElement} */ (el("scan-name"))?.value || el("tb-name").value || "مستند-ممسوح").trim();
      const saved = await saveFile(bytes, withExtension(docName, "pdf"), "pdf");
      reportSave(saved, `تم مسح ${pages.length} صفحة إلى ملف PDF.`);
      if (saved) reportUpscaleFallbacks();
      return;
    }

    const mime = format === "png" ? "image/png" : "image/jpeg";
    const extension = format === "png" ? "png" : "jpg";
    const digits = String(pages.length).length;
    /** @type {Array<{ name: string; data: Uint8Array }>} */
    const files = [];
    const docName = (/** @type {HTMLInputElement} */ (el("scan-name"))?.value || el("tb-name").value || "مستند-ممسوح").trim();

    for (const [order, page] of pages.entries()) {
      throwIfCancelled();
      const pageBase = order / pages.length;
      const pageSpan = 1 / pages.length;
      const detail = `صورة ${order + 1} من ${pages.length}`;
      updateProgress({ percent: pageBase * 100, detail });
      const bitmap = await renderResult(page, (frac, stepDetail) => {
        const clamped = Math.max(0, Math.min(1, frac));
        updateProgress({ percent: (pageBase + pageSpan * clamped) * 100, detail: stepDetail || detail });
      });
      throwIfCancelled();
      files.push({
        name: `${baseName(docName)}-${pad(order + 1, digits)}.${extension}`,
        data: await bitmapToBytes(bitmap, mime, 0.92)
      });
      // Let the overlay paint between heavy pages.
      await yieldToUi();
    }

    throwIfCancelled();
    endProgress();
    if (files.length === 1) {
      const saved = await saveFile(files[0].data, files[0].name, format === "png" ? "png" : "jpeg");
      reportSave(saved, "تم حفظ الصورة الممسوحة.");
      if (saved) reportUpscaleFallbacks();
      return;
    }
    const saved = await saveFolder(files, docName);
    reportSave(saved, `تم حفظ ${files.length} صورة.`);
    if (saved) reportUpscaleFallbacks();
  } catch (error) {
    reportFailure(error, "تعذّرت المعالجة.");
  } finally {
    if (saveButton) saveButton.disabled = false;
    setSkipVisible(false);
    setSkipHandler(null);
    endProgress();
  }
}

/* ---------------------------------------------------------------- *
 * Tool
 * ---------------------------------------------------------------- */

/** @type {import("../ui/router.js").Tool} */
export const scanTool = {
  id: "scan",
  name: "صور ← PDF",
  icon: "icon-scan",
  input: "صورة",
  actionLabel: "أنشئ",
  outputName: () => "مستند-ممسوح.pdf",
  tabTitle: () => tabTitle(scanTool.name, pages[0]?.name),
  captureState() {
    if (!pages.length) return null;
    return {
      pages: pages.slice(), index, selected, showingResult, acceptedKey,
      inputs: readInputValues(["scan-output", "scan-page", "scan-upscale"])
    };
  },
  restoreState(state) {
    // الصور (bitmaps) ومقابض المحرك مشاركة بالمراجع — بلا close/release هنا.
    pages = state ? state.pages.slice() : [];
    // Review state is transient; old states predate the accepted flag.
    for (const page of pages) {
      if (page.accepted === undefined) page.accepted = true;
      page.review = null;
    }
    index = state ? state.index : 0;
    selected = state ? state.selected : 0;
    showingResult = state ? state.showingResult : false;
    acceptedKey = state ? state.acceptedKey : "";
    dragging = -1;
    draggingEdge = -1;
    lastPointer = null;
    writeInputValues(state?.inputs ?? defaultInputs);
    for (const input of qsa('input[name="scan-mode"]')) {
      /** @type {HTMLInputElement} */ (input).checked =
        input.value === (state && current() ? current().mode : defaultMode);
    }
    syncPreviewButton();
    refresh();
  },

  setup() {
    defaultInputs = readInputValues(["scan-output", "scan-page", "scan-upscale"]);
    defaultMode = document.querySelector('input[name="scan-mode"]:checked')?.value ?? "color";
    canvas = /** @type {HTMLCanvasElement} */ (el("scan-canvas"));
    wireCanvas();
    wireIntake({ dropId: "scan-drop", inputId: "scan-input", browseId: "scan-browse", accept: "image", onFiles: add });

    el("scan-add")?.addEventListener("click", () => el("scan-input").click());
    el("scan-clear")?.addEventListener("click", clearAll);
    el("scan-save")?.addEventListener("click", () => void run());
    el("scan-remove")?.addEventListener("click", removeCurrent);
    // The per-page detect lives on the stage itself; the external
    // button is detect-all. A staged review turns detect into accept.
    const stageDetect = () => {
      const page = current();
      if (!page) return;
      if (page.review) void acceptDetection();
      else void redetect();
    };
    el("scan-stage-detect")?.addEventListener("click", stageDetect);
    el("scan-cancel")?.addEventListener("click", cancelDetection);
    el("scan-detect-all")?.addEventListener("click", () => void detectAll());
    el("scan-full")?.addEventListener("click", useFullFrame);
    el("scan-preview")?.addEventListener("click", () => void toggleResultPreview());

    el("scan-prev")?.addEventListener("click", () => stepPage(-1));
    el("scan-next")?.addEventListener("click", () => stepPage(1));
    el("scan-strip")?.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const thumb = target?.closest(".scan-page");
      if (!thumb) return;
      const remove = target.closest("[data-remove]");
      if (remove) {
        void removePageById(remove.getAttribute("data-remove"));
        return;
      }
      const at = pages.findIndex((page) => page.id === thumb.dataset.id);
      if (at >= 0) {
        index = at;
        refresh();
      }
    });
    el("scan-strip")?.addEventListener("keydown", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const thumb = target?.closest(".scan-page");
      if (!thumb) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const at = pages.findIndex((page) => page.id === thumb.dataset.id);
        if (at >= 0) {
          index = at;
          refresh();
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void removePageById(thumb.dataset.id);
      }
    });
    syncStripSortable();

    const popover = el("scan-export-popover");
    const settingsBtn = el("scan-settings-btn");
    const closePopoverBtn = el("scan-popover-close");
    togglePopover = (show) => {
      if (!popover) return;
      const willOpen = typeof show === "boolean" ? show : popover.hidden;
      popover.hidden = !willOpen;
      settingsBtn?.setAttribute("aria-expanded", String(willOpen));
    };

    settingsBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover();
    });
    closePopoverBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover(false);
    });
    popover?.addEventListener("click", (e) => e.stopPropagation());
    window.addEventListener("click", () => togglePopover(false));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && popover && !popover.hidden) {
        togglePopover(false);
      }
    });

    const scanName = el("scan-name");
    scanName?.addEventListener("input", () => {
      setName(/** @type {HTMLInputElement} */ (scanName).value);
    });
    scanName?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        /** @type {HTMLInputElement} */ (scanName).blur();
        void run();
      }
    });
    scanName?.addEventListener("blur", () => {
      const format = /** @type {HTMLSelectElement} */ (el("scan-output"))?.value || "pdf";
      const input = /** @type {HTMLInputElement} */ (scanName);
      if (format === "pdf" && input.value.trim() && !/\.pdf$/i.test(input.value.trim())) {
        input.value = withExtension(input.value.trim(), "pdf");
        setName(input.value);
      }
    });

    el("scan-rotate")?.addEventListener("click", () => {
      const page = current();
      if (!page) return;
      page.rotate = (page.rotate + 90) % 360;
      page.result = null;
      scheduleDraw();
      if (showingResult) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => void refreshResultPreview(), 600);
      }
    });

    for (const input of qsa('input[name="scan-mode"]')) {
      input.addEventListener("change", () => {
        const page = current();
        if (!page) return;
        page.mode = /** @type {HTMLInputElement} */ (input).value;
        page.result = null;
        scheduleDraw();
        if (showingResult) {
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => void refreshResultPreview(), 600);
        }
      });
    }

    for (const id of ["scan-page", "scan-orient", "scan-margin"]) {
      el(id)?.addEventListener("change", () => {
        // Paper settings only change the PDF sheet: redraw the preview.
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
