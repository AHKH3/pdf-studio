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
 * @property {{ fx: number; fy: number; fw: number; fh: number } | null} layout
 *                                  free-layout rect as sheet fractions (null = auto fill)
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
/**
 * Bottom strip (CSS px) kept empty for the floating corner buttons
 * (rotate + preview) so they never cover the paper — portrait or landscape.
 */
const STAGE_ACTION_RESERVE = 56;

/**
 * بطاقة الهوية المصرية بمقاس ID-1 الحقيقي (مم). بريست البطاقة يطبع
 * بهذا المقاس الثابت في منتصف الورقة المختارة — لا نسبة من حجم الورقة.
 */
const ID_CARD_MM = { width: 85.6, height: 53.98 };

/** @returns {"fill" | "id-card"} التحكم المسبق المختار (مستند أم بطاقة هوية) */
function currentPreset() {
  const checked = document.querySelector('input[name="scan-preset"]:checked');
  return checked?.value === "id-card" ? "id-card" : "fill";
}

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
/** Free-layout drag on the result sheet: null or { mode, ... } */
let layoutDrag = null;
/** Corner-drag backup for Esc-cancel in cut mode. */
let dragOrigCorners = null;
/** Center-snap highlight flags consumed by draw(). */
let lastSnap = { x: false, y: false };
/**
 * Stage view mode:
 * - 'crop': adjust raw perspective corners on the original photo
 * - 'layout': free transform / resize / position image on the paper sheet
 * - 'preview': pure WYSIWYG preview of the final printout with no handles
 */
let viewMode = "crop";
let cropOpen = true;
/** @type {HTMLCanvasElement | null} */
let canvas = null;
let renderQueued = false;
let showingResult = false;
/** Debounce timer for the live final-shape preview while editing. */
let previewTimer = 0;
/** Guards overlapping result renders during fast page flips — only the latest wins. */
let resultViewSeq = 0;
/** Guards overlapping debounced refreshes after instant edits — only the latest paints. */
let previewSeq = 0;
/** قيم المدخلات الافتراضية (لتاب جديدة لا ترث إعدادات تاب أخرى). */
let defaultInputs = null;
let defaultMode = "color";
let defaultPreset = "fill";

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
  // Keep the bottom strip empty for the corner buttons — the photo and its
  // corner handles always sit above rotate/preview, never underneath.
  const availH = Math.max(1, canvas.height - STAGE_ACTION_RESERVE * dpr);
  const fit = Math.min(canvas.width / boxW, availH / boxH) * 0.94;
  return {
    source: page.display,
    fit,
    offsetX: (canvas.width - boxW * fit) / 2,
    offsetY: (availH - boxH * fit) / 2,
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
  // No numeric margin: placement is fully manual (free layout on the sheet).
  return {
    paperW: landscape ? base.height : base.width,
    paperH: landscape ? base.width : base.height,
    margin: 0
  };
}

/* ---------------------------------------------------------------- *
 * Free layout — the image rectangle on the paper sheet, in PDF pt
 * (origin bottom-left). Each page owns its rect as sheet fractions
 * (fx/fy from top-left, fw/fh) so a paper-size switch keeps the
 * relative placement; null layout = automatic centered fill.
 * ---------------------------------------------------------------- */

/** Automatic rect (pt, bottom-left origin): centered fill, or the fixed ID-1 card. */
function autoPaperRect(paperW, paperH, imgW, imgH) {
  if (currentPreset() === "id-card") {
    const isPortrait = imgH > imgW;
    const cardW = (isPortrait ? ID_CARD_MM.height : ID_CARD_MM.width) * MM_TO_PT;
    const cardH = (isPortrait ? ID_CARD_MM.width : ID_CARD_MM.height) * MM_TO_PT;
    const cardScale = Math.min(1, paperW / cardW, paperH / cardH);
    const imgScale = Math.min((cardW * cardScale) / imgW, (cardH * cardScale) / imgH);
    const w = Math.max(1, imgW * imgScale);
    const h = Math.max(1, imgH * imgScale);
    return { x: (paperW - w) / 2, y: (paperH - h) / 2, w, h };
  }
  const scale = Math.min(paperW / imgW, paperH / imgH);
  const w = Math.max(1, imgW * scale);
  const h = Math.max(1, imgH * scale);
  return { x: (paperW - w) / 2, y: (paperH - h) / 2, w, h };
}

/** Effective rect (pt, bottom-left origin) for a page: stored layout or auto. */
function rectForPagePt(page, paperW, paperH, imgW, imgH) {
  const stored = page.layout;
  if (stored && Number.isFinite(stored.fx) && Number.isFinite(stored.fw) && stored.fw > 0 && stored.fh > 0) {
    const w = Math.max(1, Math.min(paperW, stored.fw * paperW));
    const h = Math.max(1, Math.min(paperH, stored.fh * paperH));
    const x = Math.max(0, Math.min(paperW - w, stored.fx * paperW));
    const yTop = Math.max(0, Math.min(paperH - h, stored.fy * paperH));
    return { x, y: paperH - yTop - h, w, h };
  }
  return autoPaperRect(paperW, paperH, imgW, imgH);
}

/** Persist a pt rect (bottom-left origin) as sheet fractions (top-left origin). */
function storeLayoutFromPt(page, paperW, paperH, rect) {
  const w = Math.max(8, Math.min(paperW, rect.w));
  const h = Math.max(8, Math.min(paperH, rect.h));
  const x = Math.max(0, Math.min(paperW - w, rect.x));
  const y = Math.max(0, Math.min(paperH - h, rect.y));
  page.layout = {
    fx: x / paperW,
    fy: (paperH - y - h) / paperH,
    fw: w / paperW,
    fh: h / paperH
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

  if (!cropOpen && page.result) {
    // The single workspace: the export bitmap placed on the paper sheet
    // exactly like run() lays it out (free layout rect, or the automatic
    // centered fill / fixed-size ID card when untouched).
    // The rect is directly draggable — no modes, the paper IS the workspace.
    const sheet = paperSheetForPage(page.result.width, page.result.height);
    // Same empty bottom strip as layout(): the sheet never slides under the buttons.
    const availH = Math.max(1, canvas.height - STAGE_ACTION_RESERVE * Math.min(2, window.devicePixelRatio || 1));
    const fit = Math.min(canvas.width / sheet.paperW, availH / sheet.paperH) * 0.96;
    const pw = sheet.paperW * fit;
    const ph = sheet.paperH * fit;
    const px = (canvas.width - pw) / 2;
    const py = (availH - ph) / 2;
    const paperKind = /** @type {HTMLSelectElement} */ (el("scan-page"))?.value || "a4";
    const rect = paperKind === "fit"
      ? { x: 0, y: 0, w: sheet.paperW, h: sheet.paperH }
      : rectForPagePt(page, sheet.paperW, sheet.paperH, page.result.width, page.result.height);
    const ix = px + rect.x * fit;
    const iy = py + (sheet.paperH - rect.y - rect.h) * fit;
    const iw = Math.max(1, rect.w * fit);
    const ih = Math.max(1, rect.h * fit);
    ctx.imageSmoothingQuality = "high";
    const dark = document.documentElement.dataset.theme === "blueprint";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.save();
    ctx.shadowColor = dark ? "rgba(0, 0, 0, 0.55)" : "rgba(15, 23, 42, 0.28)";
    ctx.shadowBlur = 26 * dpr;
    ctx.shadowOffsetY = 8 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = dark ? "rgba(0, 0, 0, 0.6)" : "rgba(15, 23, 42, 0.16)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(px + 0.5, py + 0.5, Math.max(1, pw - 1), Math.max(1, ph - 1));
    ctx.restore();
    ctx.drawImage(page.result, ix, iy, iw, ih);
    if (paperKind !== "fit" && viewMode === "layout") {
      // Sheet center lines: always faintly on (the user asked for them by
      // default), flashing strong on the snapped axis while dragging.
      // The paper is always white, so one fixed indigo works in both themes.
      const scaleDpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setLineDash([6 * scaleDpr, 6 * scaleDpr]);
      ctx.lineWidth = Math.max(1, scaleDpr);
      ctx.strokeStyle = lastSnap.x ? "rgba(79, 70, 229, 0.9)" : "rgba(79, 70, 229, 0.30)";
      if (lastSnap.x) ctx.lineWidth = 2 * scaleDpr;
      ctx.beginPath();
      ctx.moveTo(px + pw / 2, py);
      ctx.lineTo(px + pw / 2, py + ph);
      ctx.stroke();
      ctx.strokeStyle = lastSnap.y ? "rgba(79, 70, 229, 0.9)" : "rgba(79, 70, 229, 0.30)";
      ctx.lineWidth = lastSnap.y ? 2 * scaleDpr : Math.max(1, scaleDpr);
      ctx.beginPath();
      ctx.moveTo(px, py + ph / 2);
      ctx.lineTo(px + pw, py + ph / 2);
      ctx.stroke();
      ctx.restore();
      // Selection frame + corner handles (free-layout affordance).
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--act").trim() || "#5e6ad2";
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2 * scaleDpr;
      ctx.setLineDash([8 * scaleDpr, 5 * scaleDpr]);
      ctx.strokeRect(ix, iy, iw, ih);
      ctx.setLineDash([]);
      const radius = 12 * scaleDpr;
      for (const [hx, hy] of [[ix, iy], [ix + iw, iy], [ix + iw, iy + ih], [ix, iy + ih]]) {
        ctx.beginPath();
        ctx.arc(hx, hy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 3 * scaleDpr;
        ctx.strokeStyle = ink;
        ctx.stroke();
        // Outer dark ring: white-on-white vanishes in the light theme.
        ctx.beginPath();
        ctx.arc(hx, hy, radius + 1.5 * scaleDpr, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, scaleDpr);
        ctx.strokeStyle = "rgba(8, 9, 10, 0.45)";
        ctx.stroke();
      }
      ctx.restore();
    }
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
    const radius = (active ? 14 : 11) * (window.devicePixelRatio || 1);
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

/**
 * Instant-edit invariant: any edit that changes the final pixels drops the
 * cached result bitmap right away, so the stage AND the rail fall back to
 * the original (with the edit applied) on the very next frame — never a
 * stale result lingering for seconds while the worker recomputes behind it.
 * Callers then debounce refreshResultPreview() to come back to the result.
 */
function invalidateResult(page) {
  page.result?.close();
  page.result = null;
  page.resultKey = "";
}

function markDirty(page, message) {
  // Instant feedback first: the cached result is dropped (see
  // invalidateResult) so the stage shows the edit on the next frame.
  // A hand edit means the user takes ownership of these corners — even
  // mid-review, so a later cancel can never eat hand-drawn work.
  page.review = null;
  page.accepted = true;
  invalidateResult(page);
  renderStrip();
  if (message && !showingResult) updateMeta(message);
  syncHint();
  scheduleDraw();
  if (showingResult) {
    updateMeta("جارٍ تحديث المعاينة…");
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshResultPreview(), 600);
  }
}

/** Re-renders the live final-shape preview after an edit (debounced). */
async function refreshResultPreview() {
  const page = current();
  if (!page || !showingResult) return;
  const seq = ++previewSeq;
  try {
    await renderResult(page);
  } catch (error) {
    if (seq !== previewSeq || current() !== page || !showingResult) return;
    reportFailure(error, "تعذّرت معاينة الناتج.");
    return;
  }
  // The user may have flipped pages mid-render, or edited again (which
  // schedules its own newer refresh): never draw over the new page's own
  // result flow, and never let a superseded render win.
  if (seq !== previewSeq || current() !== page || !showingResult) return;
  renderStrip();
  scheduleDraw();
}

/**
 * Restores the result-view invariant after navigation: the preview button is
 * global but each page caches its own bitmap, so a fresh page must render
 * its result instead of flashing the corners under a pressed button.
 * A stale (superseded or failed) render never touches the UI — and on
 * failure we step back to the original so the button matches the view.
 */
async function ensureResultView() {
  const page = current();
  if (!page || !showingResult) return;
  if (page.result && page.resultKey === stampOf(page)) {
    scheduleDraw();
    return;
  }
  const seq = ++resultViewSeq;
  startProgress({ title: "معاينة الناتج", desc: "نحسّن الجودة الآن." });
  try {
    await renderResult(page);
  } catch (error) {
    if (seq !== resultViewSeq) return;
    showingResult = false;
    reportFailure(error, "تعذّرت معاينة الناتج.");
    syncPreviewButton();
    scheduleDraw();
    return;
  } finally {
    endProgress();
  }
  if (seq !== resultViewSeq) return;
  syncPreviewButton();
  renderStrip();
  scheduleDraw();
}

/* ---------------------------------------------------------------- *
 * Free-layout interaction — mirrors draw()'s result branch exactly.
 * Pointer positions map to paper points (bottom-left origin, like PDF).
 * ---------------------------------------------------------------- */

/** Geometry of the current result sheet, or null outside result mode / fit. */
function resultGeom() {
  const page = current();
  if (!canvas || !page || viewMode !== "layout" || !page.result) return null;
  if ((/** @type {HTMLSelectElement} */ (el("scan-page"))?.value || "a4") === "fit") return null;
  const sheet = paperSheetForPage(page.result.width, page.result.height);
  // Same reserved bottom strip as draw(): hit-testing must match the paint.
  const availH = Math.max(1, canvas.height - STAGE_ACTION_RESERVE * Math.min(2, window.devicePixelRatio || 1));
  const fit = Math.min(canvas.width / sheet.paperW, availH / sheet.paperH) * 0.96;
  const px = (canvas.width - sheet.paperW * fit) / 2;
  const py = (availH - sheet.paperH * fit) / 2;
  const rect = rectForPagePt(page, sheet.paperW, sheet.paperH, page.result.width, page.result.height);
  return { page, sheet, fit, px, py, rect };
}

/** Client event → paper points (bottom-left origin) + device px for hit tests. */
function paperPointFromEvent(event, geom) {
  const bounds = canvas.getBoundingClientRect();
  const dpr = canvas.width / Math.max(1, bounds.width);
  const cx = (event.clientX - bounds.left) * dpr;
  const cy = (event.clientY - bounds.top) * dpr;
  return {
    x: (cx - geom.px) / geom.fit,
    y: geom.sheet.paperH - (cy - geom.py) / geom.fit,
    cx,
    cy
  };
}

/** "move" inside the image, a corner id on a handle, or null outside. */
function layoutHitMode(point, geom) {
  const tol = 14 * (window.devicePixelRatio || 1);
  const ix = geom.px + geom.rect.x * geom.fit;
  const iy = geom.py + (geom.sheet.paperH - geom.rect.y - geom.rect.h) * geom.fit;
  const iw = geom.rect.w * geom.fit;
  const ih = geom.rect.h * geom.fit;
  const corners = { nw: [ix, iy], ne: [ix + iw, iy], se: [ix + iw, iy + ih], sw: [ix, iy + ih] };
  for (const [mode, [hx, hy]] of Object.entries(corners)) {
    if (Math.hypot(point.cx - hx, point.cy - hy) <= tol) return mode;
  }
  if (point.cx >= ix && point.cx <= ix + iw && point.cy >= iy && point.cy <= iy + ih) return "move";
  return null;
}

/** Apply a layout drag (move / corner resize) and persist it on the page. */
function moveLayoutDrag(event) {
  const drag = layoutDrag;
  if (!drag) return;
  const geom = resultGeom();
  if (!geom || geom.page !== current()) return;
  const page = geom.page;
  const { paperW, paperH } = geom.sheet;
  const point = paperPointFromEvent(event, geom);
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  const orig = drag.orig;
  const MIN_PT = 8;
  let next;
  if (drag.mode === "move") {
    // Soft center snap (escapable by design: dragging past the threshold
    // releases it — a magnet that never traps).
    const snapT = (8 * (window.devicePixelRatio || 1)) / geom.fit;
    lastSnap = { x: false, y: false };
    let nx = orig.x + dx;
    let ny = orig.y + dy;
    if (Math.abs(nx + orig.w / 2 - paperW / 2) <= snapT) {
      nx = paperW / 2 - orig.w / 2;
      lastSnap.x = true;
    }
    if (Math.abs(ny + orig.h / 2 - paperH / 2) <= snapT) {
      ny = paperH / 2 - orig.h / 2;
      lastSnap.y = true;
    }
    next = {
      x: Math.max(0, Math.min(paperW - orig.w, nx)),
      y: Math.max(0, Math.min(paperH - orig.h, ny)),
      w: orig.w,
      h: orig.h
    };
  } else {
    const x0 = orig.x;
    const y0 = orig.y;
    const x1 = orig.x + orig.w;
    const y1 = orig.y + orig.h;
    let left;
    let bottom;
    let w;
    let h;
    if (drag.mode === "nw") { left = x0 + dx; bottom = y0; w = x1 - left; h = (y1 + dy) - y0; }
    else if (drag.mode === "ne") { left = x0; bottom = y0; w = (x1 + dx) - x0; h = (y1 + dy) - y0; }
    else if (drag.mode === "se") { left = x0; bottom = y0 + dy; w = (x1 + dx) - x0; h = y1 - bottom; }
    else { left = x0 + dx; bottom = y0 + dy; w = x1 - left; h = y1 - bottom; }
    if (event.shiftKey) {
      // Free stretch: each axis independent.
      w = Math.max(MIN_PT, Math.min(paperW, w));
      h = Math.max(MIN_PT, Math.min(paperH, h));
    } else {
      // Corners preserve the aspect ratio by default.
      const aspect = orig.w / Math.max(1, orig.h);
      const s = Math.max(w / orig.w, h / orig.h);
      const clamped = Math.max(MIN_PT / orig.w, MIN_PT / orig.h, s);
      w = Math.min(paperW, orig.w * clamped);
      h = Math.min(paperH, orig.h * clamped);
    }
    if (drag.mode === "nw") { left = x1 - w; bottom = y0; }
    else if (drag.mode === "ne") { left = x0; bottom = y0; }
    else if (drag.mode === "se") { left = x0; bottom = y1 - h; }
    else { left = x1 - w; bottom = y1 - h; }
    next = {
      x: Math.max(0, Math.min(paperW - w, left)),
      y: Math.max(0, Math.min(paperH - h, bottom)),
      w,
      h
    };
  }
  storeLayoutFromPt(page, paperW, paperH, next);
  if (isLayoutApplyAll()) applyLayoutToAll();
  scheduleDraw();
}

/**
 * Cursor contract (follows the hovered capability, like edit/board.js):
 * grab over the image, diagonal arrows over corner handles, default over
 * empty paper, crosshair in cut mode. Cheap hit-test — no throttle needed.
 */
function updateHoverCursor(event) {
  if (!canvas || !event) return;
  if (viewMode === "preview") {
    canvas.style.cursor = "default";
    return;
  }
  const page = current();
  if (viewMode === "layout" && page?.result) {
    const geom = resultGeom();
    if (geom) {
      const mode = layoutHitMode(paperPointFromEvent(event, geom), geom);
      if (mode === "move") canvas.style.cursor = "grab";
      else if (mode === "nw" || mode === "se") canvas.style.cursor = "nwse-resize";
      else if (mode) canvas.style.cursor = "nesw-resize";
      else canvas.style.cursor = "default";
      return;
    }
  }
  canvas.style.cursor = "crosshair";
}

function wireCanvas() {
  if (!canvas) return;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", (event) => {
    const page = current();
    const box = layout();
    if (!page || !box) return;
    if (viewMode === "preview") {
      canvas.focus({ preventScroll: true });
      return;
    }
    // Free layout: the result sheet is directly draggable (Photoshop-like)
    // — a press on the image moves/resizes it and never leaves the preview.
    // Empty paper: intentional no-op — exiting needs the mode switch or Esc.
    if (viewMode === "layout" && page.result) {
      const geom = resultGeom();
      if (geom) {
        const point = paperPointFromEvent(event, geom);
        const mode = layoutHitMode(point, geom);
        if (mode) {
          layoutDrag = {
            mode,
            pointerId: event.pointerId,
            orig: { ...geom.rect },
            start: { x: point.x, y: point.y },
            savedLayout: page.layout ? { ...page.layout } : null
          };
          canvas.style.cursor = mode === "move" ? "grabbing" : mode === "nw" || mode === "se" ? "nwse-resize" : "nesw-resize";
          canvas.setPointerCapture(event.pointerId);
          canvas.focus({ preventScroll: true });
          return;
        }
      }
      canvas.focus({ preventScroll: true });
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
      dragOrigCorners = page.corners.map((corner) => ({ ...corner }));
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
    dragOrigCorners = page.corners.map((corner) => ({ ...corner }));
    lastPointer = { x: spot.x, y: spot.y };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    scheduleDraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (layoutDrag && event.pointerId === layoutDrag.pointerId) {
      moveLayoutDrag(event);
      return;
    }
    if (dragging < 0 && draggingEdge < 0) {
      updateHoverCursor(event);
      return;
    }
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

  const release = (event) => {
    if (layoutDrag && (!event || event.pointerId === layoutDrag.pointerId)) {
      layoutDrag = null;
      lastPointer = null;
      lastSnap = { x: false, y: false };
      updateMeta("تخطيط محفوظ — يُصدَّر كما تراه.");
      updateHoverCursor(event);
      scheduleDraw();
      return;
    }
    if (dragging < 0 && draggingEdge < 0) return;
    dragging = -1;
    draggingEdge = -1;
    lastPointer = null;
    dragOrigCorners = null;
    const page = current();
    if (page) markDirty(page, "حدود يدوية.");
    updateHoverCursor(event);
    scheduleDraw();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("keydown", (event) => {
    // Esc unwinds one level: ongoing drag, then staged review, then the sheet.
    if (event.key === "Escape") {
      event.preventDefault();
      if (layoutDrag) {
        const live = current();
        if (live && layoutDrag.savedLayout !== undefined) live.layout = layoutDrag.savedLayout;
        layoutDrag = null;
        lastSnap = { x: false, y: false };
        updateMeta("أُلغي السحب — رجع التخطيط.");
        scheduleDraw();
        return;
      }
      if (dragging >= 0 || draggingEdge >= 0) {
        const live = current();
        if (live && dragOrigCorners) live.corners = dragOrigCorners.map((corner) => ({ ...corner }));
        dragging = -1;
        draggingEdge = -1;
        lastPointer = null;
        dragOrigCorners = null;
        scheduleDraw();
        return;
      }
      const cur = current();
      if (cur?.review) {
        cancelDetection();
        return;
      }
      if (viewMode !== "crop") {
        void setViewMode("crop");
        return;
      }
      closeExportPop();
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      stepPage(event.key === "PageDown" ? 1 : -1);
      return;
    }
    const page = current();
    if (!page) return;
    // Free layout: arrows nudge the image on the sheet (Shift = big step).
    if (!cropOpen && page.result) {
      const geom = resultGeom();
      if (geom) {
        const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (!arrow) return;
        event.preventDefault();
        const nudge = event.shiftKey ? 12 : 2;
        const rect = {
          ...geom.rect,
          x: geom.rect.x + arrow[0] * nudge,
          y: geom.rect.y + arrow[1] * nudge
        };
        storeLayoutFromPt(page, geom.sheet.paperW, geom.sheet.paperH, rect);
        updateMeta("تخطيط محفوظ — يُصدَّر كما تراه.");
        scheduleDraw();
        return;
      }
    }
    if (selected < 0) return;
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

function syncModeButtons() {
  el("scan-mode-crop")?.classList.toggle("btn--act", viewMode === "crop");
  el("scan-mode-crop")?.setAttribute("aria-pressed", String(viewMode === "crop"));
  el("scan-mode-layout")?.classList.toggle("btn--act", viewMode === "layout");
  el("scan-mode-layout")?.setAttribute("aria-pressed", String(viewMode === "layout"));
  el("scan-mode-preview")?.classList.toggle("btn--act", viewMode === "preview");
  el("scan-mode-preview")?.setAttribute("aria-pressed", String(viewMode === "preview"));
}

async function setViewMode(mode) {
  if (mode !== "crop" && mode !== "layout" && mode !== "preview") return;
  viewMode = mode;
  showingResult = mode !== "crop";
  cropOpen = mode === "crop";
  syncModeButtons();
  const page = current();
  if (mode === "crop") {
    renderStrip();
    scheduleDraw();
    return;
  }
  if (page && (!page.result || page.resultKey !== stampOf(page))) {
    startProgress({ title: "معاينة الناتج", desc: "نحسّن الجودة الآن." });
    let ok = false;
    try {
      await renderResult(page);
      ok = true;
    } catch (error) {
      reportFailure(error, "تعذّرت معاينة الناتج.");
      viewMode = "crop";
      cropOpen = true;
      showingResult = false;
      syncModeButtons();
    } finally {
      endProgress();
    }
  }
  renderStrip();
  scheduleDraw();
}

function openCrop() {
  void setViewMode("crop");
}

function closeCrop() {
  void setViewMode("preview");
}

function closeSheet() {
  void setViewMode("crop");
}

function closeExportPop() {
  const pop = el("scan-export-pop");
  if (pop) pop.hidden = true;
  el("scan-save-menu")?.setAttribute("aria-expanded", "false");
}

function toggleExportPop() {
  const pop = el("scan-export-pop");
  if (!pop) return;
  pop.hidden = !pop.hidden;
  el("scan-save-menu")?.setAttribute("aria-expanded", String(!pop.hidden));
}

function updateMeta(_text) {
  // Policy: no instructional hints or meta badges on screen
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

  setSource({ label: page.name, pages: String(pages.length), size: `${page.size.width}×${page.size.height}` });
  setRunEnabled(true);
  setState("idle");
  if (!/\S/.test(el("tb-name").value)) setName("مستند-ممسوح.pdf");
  const scanName = el("scan-name");
  if (scanName instanceof HTMLInputElement && !/\S/.test(scanName.value)) {
    scanName.value = el("tb-name").value || "مستند-ممسوح.pdf";
  }
  syncOutputLabel();
  syncModeButtons();
  renderStrip();
  syncStripSortable();
  syncHint();
  scheduleDraw();
  // Result mode is global while bitmaps are per-page: a navigated-to page
  // must show its own result, never the corners under a pressed button.
  if (showingResult) void ensureResultView();
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
        layout: null,
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
let stripFlags = "";
let stripSortable = null;

function thumbCover(ctx, bitmap, width, height, turns = 0, mode = "color") {
  const swap = turns === 1 || turns === 3;
  const bw = swap ? bitmap.height : bitmap.width;
  const bh = swap ? bitmap.width : bitmap.height;
  const pad = 8;
  const fitW = width - pad * 2;
  const fitH = height - pad * 2;
  const scale = Math.min(fitW / bw, fitH / bh);
  const sheetW = Math.max(1, Math.round(bw * scale));
  const sheetH = Math.max(1, Math.round(bh * scale));
  const sheetX = Math.round((width - sheetW) / 2);
  const sheetY = Math.round((height - sheetH) / 2);

  // 1. Draw subtle drop shadow for realistic paper
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.16)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(sheetX, sheetY, sheetW, sheetH);
  ctx.restore();

  // 2. Crisp page outline
  ctx.strokeStyle = "rgba(15, 23, 42, 0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(sheetX + 0.5, sheetY + 0.5, sheetW - 1, sheetH - 1);

  // 3. Draw image content clipped to the paper sheet
  ctx.save();
  ctx.beginPath();
  ctx.rect(sheetX, sheetY, sheetW, sheetH);
  ctx.clip();
  ctx.translate(sheetX + sheetW / 2, sheetY + sheetH / 2);
  ctx.rotate((turns * Math.PI) / 2);
  if (MODE_FILTER[mode]) ctx.filter = MODE_FILTER[mode];
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function renderStrip() {
  const host = el("scan-strip");
  if (!host) return;
  // The rail mirrors the stage: in result mode a page with a fresh result
  // bitmap shows that bitmap (warp + tone already baked in — no rotate or
  // filter re-applied); otherwise it shows the original like the stage.
  const flags = pages.map((page) => `${page.id}:${page.rotate || 0}:${page.mode}:${page.resultKey || "-"}:${page.review ? "r" : page.accepted ? "a" : "n"}`).join(";");
  const key = `${flags}|${index}|${showingResult ? "r" : "o"}`;
  if (key === stripKey) return;
  // NB: flags embed the result stamp (which itself contains "|"), so the
  // thumbs comparison uses the stored flags verbatim — never split("|").
  const sameThumbs = stripFlags === flags && host.childElementCount === pages.length;
  stripKey = key;
  stripFlags = flags;
  if (sameThumbs) {
    let position = 0;
    for (const node of host.children) {
      const active = position === index;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
      position += 1;
    }
    return;
  }
  host.replaceChildren();
  pages.forEach((page, position) => {
    const isCur = position === index;
    const thumb = document.createElement("div");
    thumb.className = "scan-page" + (isCur ? " is-active" : "");
    thumb.dataset.id = page.id;
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "option");
    thumb.setAttribute("aria-selected", String(isCur));
    thumb.setAttribute("aria-label", `صفحة ${position + 1}: ${page.name}`);
    thumb.title = `صفحة ${position + 1} — اضغط للانتقال، اسحب لإعادة الترتيب، Delete للإزالة`;

    // 1. Compact page number badge (top corner overlay)
    const num = document.createElement("span");
    num.className = "scan-page__num";
    num.textContent = `${position + 1}`;

    // 2. Compact delete button (top corner overlay, hover revealed)
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "strip__remove";
    remove.dataset.remove = page.id;
    remove.setAttribute("aria-label", `إزالة صفحة ${position + 1}`);
    remove.title = "إزالة هذه الصفحة";
    remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-close"></use></svg>';

    // 3. Thumbnail canvas stage — mirrors the main preview: the final
    // result bitmap in result mode, the original otherwise.
    const shot = document.createElement("div");
    shot.className = "scan-page__img";
    const preview = document.createElement("canvas");
    preview.width = 160;
    preview.height = 213;
    const ctx = preview.getContext("2d");
    if (ctx) {
      const mirrored = showingResult && page.result;
      thumbCover(ctx, mirrored ? page.result : page.display, 160, 213, mirrored ? 0 : turnsOf(page), mirrored ? "original" : page.mode);
    }
    shot.append(preview);

    thumb.append(num, remove, shot);
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
  stripFlags = "";
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
  layoutDrag = null;
  dragOrigCorners = null;
  lastSnap = { x: false, y: false };
  badgeUntil = 0;
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
  startProgress({ title: "كشف الصفحة", desc: page.name, cancellable: false });
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
    invalidateResult(page);
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
  invalidateResult(page);
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
  invalidateResult(page);
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
  startProgress({ title: "كشف كل الصفحات", desc: `كشف دقيق لـ ${targets.length} صفحة.` });
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
        invalidateResult(page);
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
  invalidateResult(page);
  renderStrip();
  updateMeta(showingResult ? "الصورة كاملة — جارٍ تحديث المعاينة…" : "الصورة كاملة بدون قص.");
  scheduleDraw();
  // Instant original first, then the fresh result recomputes in the
  // background while we stay in result mode.
  if (showingResult) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void refreshResultPreview(), 600);
  }
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
 * @returns {Promise<ImageBitmap|null>} the fresh bitmap, or the current cache
 *          when this render was superseded by a newer edit mid-flight
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
  if (stampOf(page) !== stamp) {
    // Superseded by a newer edit while the worker was busy (instant edits
    // drop the cache up front): this output is stale — drop it instead of
    // painting old pixels over the fresh state.
    result.close();
    return page.result;
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
  syncHint();
}

/** Explicit mode entry: the canvas itself never switches modes. */
function setResultMode(on) {
  const page = current();
  if (!page) return;
  if (on && page.review) {
    // ثبّت الكشف أو ألغِه أولًا
    return;
  }
  if (on === showingResult) return;
  if (on) {
    void toggleResultPreview();
    return;
  }
  showingResult = false;
  syncPreviewButton();
  renderStrip();
  scheduleDraw();
}

/** Keep the dimension badge on screen a moment longer. */
function flashBadge(ms = 600) {
  badgeUntil = Date.now() + ms;
}

/** Zero instructional text on screen per product policy. */
function syncHint() {
  // Intentional no-op: hints removed for zero-clutter UI (موافق أو إلغاء)
}

function isLayoutApplyAll() {
  const check = el("scan-layout-all");
  return check instanceof HTMLInputElement && check.checked;
}


/** Copy the current page's size/position to every page as sheet fractions. */
function applyLayoutToAll() {
  const geom = resultGeom();
  if (!geom) return;
  const source = geom.page.layout ? { ...geom.page.layout } : null;
  for (const page of pages) {
    page.layout = source ? { ...source } : null;
  }
  flashBadge(600);
  scheduleDraw();
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
  renderStrip();
  scheduleDraw();
}

/* ---------------------------------------------------------------- *
 * Export
 * ---------------------------------------------------------------- */

async function run() {
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
          // The sheet fits the image exactly — no free layout on fit.
          pageWidth = embedded.width * 0.75;
          pageHeight = embedded.height * 0.75;
        } else {
          const base = PAGE_SIZES[preset] ?? PAGE_SIZES.a4;
          const landscape =
            orientation === "landscape" || (orientation === "auto" && embedded.width > embedded.height);
          pageWidth = landscape ? base.height : base.width;
          pageHeight = landscape ? base.width : base.height;
        }
        const created = doc.addPage([pageWidth, pageHeight]);
        // Free layout: the stored rect, or the automatic centered fill /
        // fixed-size ID card — exactly what the result preview shows.
        const rect = preset === "fit"
          ? { x: 0, y: 0, w: pageWidth, h: pageHeight }
          : rectForPagePt(page, pageWidth, pageHeight, embedded.width, embedded.height);
        created.drawImage(embedded, {
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h
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
      preset: currentPreset(),
      inputs: readInputValues(["scan-output", "scan-page", "scan-orient", "scan-upscale"])
    };
  },
  restoreState(state) {
    // الصور (bitmaps) ومقابض المحرك مشاركة بالمراجع — بلا close/release هنا.
    pages = state ? state.pages.slice() : [];
    // Review state is transient; old states predate the accepted flag.
    for (const page of pages) {
      if (page.accepted === undefined) page.accepted = true;
      if (page.layout === undefined) page.layout = null;
      page.review = null;
    }
    index = state ? state.index : 0;
    selected = state ? state.selected : 0;
    showingResult = state ? state.showingResult : false;
    acceptedKey = state ? state.acceptedKey : "";
    dragging = -1;
    draggingEdge = -1;
    layoutDrag = null;
    dragOrigCorners = null;
    lastSnap = { x: false, y: false };
    badgeUntil = 0;
    lastPointer = null;
    writeInputValues(state?.inputs ?? defaultInputs);
    const wantPreset = state && state.preset ? state.preset : defaultPreset;
    for (const input of qsa('input[name="scan-preset"]')) {
      /** @type {HTMLInputElement} */ (input).checked = input.value === wantPreset;
    }
    for (const input of qsa('input[name="scan-mode"]')) {
      /** @type {HTMLInputElement} */ (input).checked =
        input.value === (state && current() ? current().mode : defaultMode);
    }
    syncPreviewButton();
    refresh();
  },

  setup() {
    defaultInputs = readInputValues(["scan-output", "scan-page", "scan-orient", "scan-upscale"]);
    defaultMode = document.querySelector('input[name="scan-mode"]:checked')?.value ?? "color";
    defaultPreset = document.querySelector('input[name="scan-preset"]:checked')?.value ?? "fill";
    canvas = /** @type {HTMLCanvasElement} */ (el("scan-canvas"));
    wireCanvas();
    wireIntake({ dropId: "scan-drop", inputId: "scan-input", browseId: "scan-browse", accept: "image", onFiles: add });

    el("scan-add")?.addEventListener("click", () => el("scan-input").click());
    el("scan-clear")?.addEventListener("click", clearAll);
    el("scan-save")?.addEventListener("click", () => void run());
    el("scan-save-menu")?.addEventListener("click", toggleExportPop);
    el("scan-export-confirm")?.addEventListener("click", () => {
      closeExportPop();
      void run();
    });
    el("scan-remove")?.addEventListener("click", removeCurrent);
    el("scan-mode-crop")?.addEventListener("click", () => void setViewMode("crop"));
    el("scan-mode-layout")?.addEventListener("click", () => void setViewMode("layout"));
    el("scan-mode-preview")?.addEventListener("click", () => void setViewMode("preview"));
    el("scan-layout-all")?.addEventListener("change", (e) => {
      if (/** @type {HTMLInputElement} */ (e.target).checked) {
        applyLayoutToAll();
      }
    });

    document.addEventListener("click", (e) => {
      const pop = el("scan-export-pop");
      if (!pop || pop.hidden) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target?.closest(".scan__save-split")) {
        closeExportPop();
      }
    });

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
      invalidateResult(page);
      renderStrip();
      scheduleDraw();
      if (showingResult) {
        updateMeta("جارٍ تحديث المعاينة…");
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => void refreshResultPreview(), 600);
      }
    });

    for (const input of qsa('input[name="scan-mode"]')) {
      input.addEventListener("change", () => {
        const page = current();
        if (!page) return;
        page.mode = /** @type {HTMLInputElement} */ (input).value;
        invalidateResult(page);
        renderStrip();
        scheduleDraw();
        if (showingResult) {
          updateMeta("جارٍ تحديث المعاينة…");
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => void refreshResultPreview(), 600);
        }
      });
    }

    let lastPresetApplied = 0;
    for (const input of qsa('input[name="scan-preset"]')) {
      const applyPreset = () => {
        const now = Date.now();
        if (now - lastPresetApplied < 50) return;
        lastPresetApplied = now;
        const page = current();
        if (page) {
          page.layout = null;
        }
        if (isLayoutApplyAll()) {
          for (const p of pages) {
            p.layout = null;
          }
        }
        if (pages.length) {
          void setViewMode("layout");
        } else {
          scheduleDraw();
        }
      };
      input.addEventListener("change", applyPreset);
      input.addEventListener("click", applyPreset);
    }

    for (const id of ["scan-page", "scan-orient"]) {
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
