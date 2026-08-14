import { el } from "../../dom.js";
import { baseName, humanSize, readBytes, saveFile, withExtension } from "../../lib/files.js";
import { lib, openDocument } from "../../pdf/core.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../../ui/feedback.js";
import { wireIntake } from "../../ui/intake.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { reportFailure, reportSave } from "../shared.js";
import { boxArea, clampBox, cropSizeMm, DEFAULT_BOX, formatMm, viewportBoxToPdf, visualNormToPdfBox } from "./geometry.js";
import { CropOverlay, injectCropStyles } from "./overlay.js";

const MAX_EDGE = 520;
const MIN_BOX_PT = 8;

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number } | null} */
let doc = null;
/** @type {any} */
let pdfjsDoc = null;
let pageNumber = 1;
/** @type {{ width: number; height: number; convertToPdfPoint?: Function } | null} */
let viewport = null;
/** @type {CropOverlay | null} */
let overlay = null;
let mounted = false;
let intakeWired = false;
/** @type {Array<() => void>} */
let subscriptions = [];

function rootEl() {
  return document.getElementById("view-crop") || document;
}

/** @param {string} id */
function node(id) {
  return document.getElementById(id);
}

function scope() {
  const current = /** @type {HTMLInputElement | null} */ (node("crop-scope-all"));
  return current?.checked ? "all" : "current";
}

function hasTitleBlock() {
  return Boolean(el("tb-run"));
}

function outputName() {
  return doc ? `${baseName(doc.name)}-مقصوص.pdf` : "";
}

function syncChrome() {
  const save = node("crop-save");
  if (save) save.hidden = hasTitleBlock();
  if (!hasTitleBlock()) return;

  if (!doc) {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
    return;
  }

  setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
  setName(outputName());
  setRunEnabled(true);
  setState("idle");
}

function renderReadout() {
  const host = node("crop-readout");
  if (!host || !overlay || !viewport) {
    if (host) host.replaceChildren();
    return;
  }

  const box = overlay.box;
  const size = cropSizeMm(box, viewport);
  const kept = Math.round(boxArea(box) * 100);
  const rows = [
    ["المقاس بعد القص", `${formatMm(size.width)} × ${formatMm(size.height)} مم`],
    ["المساحة المتبقية", `${kept}٪ من الصفحة`],
    ["النطاق", scope() === "all" ? `كل الصفحات (${doc?.pages ?? 0})` : `صفحة ${pageNumber}`]
  ];

  host.replaceChildren();
  for (const [label, value] of rows) {
    const cell = document.createElement("div");
    cell.className = "readout__cell";
    const key = document.createElement("span");
    key.className = "readout__label";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = "readout__value num";
    val.textContent = value;
    cell.append(key, val);
    host.append(cell);
  }
}

function syncPager() {
  const input = /** @type {HTMLInputElement | null} */ (node("crop-page"));
  const total = node("crop-page-total");
  const label = node("crop-page-label");
  const prev = /** @type {HTMLButtonElement | null} */ (node("crop-prev"));
  const next = /** @type {HTMLButtonElement | null} */ (node("crop-next"));
  if (input) {
    input.max = String(doc?.pages || 1);
    input.value = String(pageNumber);
    input.disabled = !doc;
  }
  if (total) total.textContent = String(doc?.pages || 0);
  if (label) {
    label.textContent = doc ? `الصفحة المعروضة (${pageNumber} من ${doc.pages})` : "الصفحة المعروضة";
  }
  if (prev) prev.disabled = !doc || pageNumber <= 1;
  if (next) next.disabled = !doc || pageNumber >= (doc?.pages || 1);
}

async function disposePdfjs() {
  if (!pdfjsDoc) return;
  try {
    await pdfjsDoc.destroy();
  } catch {
    /* already closed */
  }
  pdfjsDoc = null;
  viewport = null;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {any} page
 */
async function paintPage(canvas, page) {
  const base = page.getViewport({ scale: 1 });
  const scale = MAX_EDGE / Math.max(base.width, base.height);
  const view = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.ceil(view.width));
  canvas.height = Math.max(1, Math.ceil(view.height));
  canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  viewport = base;
}

async function showPage(nextPage) {
  if (!pdfjsDoc || !doc) return;
  pageNumber = Math.min(Math.max(1, nextPage), doc.pages);
  const canvas = /** @type {HTMLCanvasElement | null} */ (node("crop-canvas"));
  if (!canvas) return;

  const page = await pdfjsDoc.getPage(pageNumber);
  try {
    await paintPage(canvas, page);
  } finally {
    page.cleanup();
  }

  syncPager();
  renderReadout();
}

/** @param {File[]} files */
async function load(files) {
  const file = files[0];
  if (!file) return;
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    const bytes = await readBytes(file);
    await disposePdfjs();
    pdfjsDoc = await openDocument(bytes);
    doc = { name: file.name, bytes, pages: pdfjsDoc.numPages, size: file.size };
    pageNumber = 1;
    overlay?.setBox(DEFAULT_BOX);

    const drop = node("crop-drop");
    const panel = node("crop-panel");
    if (drop) drop.hidden = true;
    if (panel) panel.hidden = false;

    await showPage(1);
    syncChrome();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  pageNumber = 1;
  viewport = null;
  overlay?.setBox(DEFAULT_BOX);
  void disposePdfjs();

  const drop = node("crop-drop");
  const panel = node("crop-panel");
  if (drop) drop.hidden = false;
  if (panel) panel.hidden = true;

  const canvas = /** @type {HTMLCanvasElement | null} */ (node("crop-canvas"));
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  syncPager();
  renderReadout();
  syncChrome();
}

/**
 * @param {any} page pdf-lib page
 * @param {{ x: number; y: number; width: number; height: number }} box
 */
function setPageBoxes(page, box) {
  const width = Math.max(MIN_BOX_PT, box.width);
  const height = Math.max(MIN_BOX_PT, box.height);
  const x = box.x;
  const y = box.y;

  if (typeof page.setCropBox === "function") {
    page.setCropBox(x, y, width, height);
    page.setMediaBox(x, y, width, height);
    page.setBleedBox?.(x, y, width, height);
    page.setTrimBox?.(x, y, width, height);
    page.setArtBox?.(x, y, width, height);
    return;
  }

  const { PDFName } = lib();
  const context = page.doc?.context || page.node.context;
  for (const name of ["MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox"]) {
    page.node.set(PDFName.of(name), context.obj([x, y, x + width, y + height]));
  }
}

/**
 * @param {any} pdfLibPage
 * @param {number} index zero-based
 * @param {import("./geometry.js").NormBox} box
 */
async function cropOnePage(pdfLibPage, index, box) {
  if (pdfjsDoc) {
    const jsPage = await pdfjsDoc.getPage(index + 1);
    try {
      const view = jsPage.getViewport({ scale: 1 });
      if (typeof view.convertToPdfPoint === "function") {
        setPageBoxes(pdfLibPage, viewportBoxToPdf(box, view));
        return;
      }
    } finally {
      jsPage.cleanup?.();
    }
  }

  const visible = pdfLibPage.getCropBox?.() ?? pdfLibPage.getMediaBox();
  const rotation = pdfLibPage.getRotation?.()?.angle ?? 0;
  setPageBoxes(pdfLibPage, visualNormToPdfBox(box, visible, rotation));
}

export async function run() {
  if (!doc || !overlay) return;
  const box = clampBox(overlay.box);
  const applyAll = scope() === "all";
  const { PDFDocument } = lib();

  if (hasTitleBlock()) setState("busy");
  startProgress({
    title: "اقتصاص الصفحات",
    desc: applyAll ? "نقصّ كل الصفحات بنفس المربع." : `نقصّ الصفحة ${pageNumber}.`
  });

  try {
    if (!pdfjsDoc) pdfjsDoc = await openDocument(doc.bytes);
    const target = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
    const pages = target.getPages();
    const indexes = applyAll ? pages.map((_, index) => index) : [pageNumber - 1];

    for (let step = 0; step < indexes.length; step += 1) {
      throwIfCancelled();
      const index = indexes[step];
      if (step % 4 === 0) {
        updateProgress({
          percent: (step / indexes.length) * 100,
          detail: `صفحة ${index + 1} من ${doc.pages}`
        });
      }
      await cropOnePage(pages[index], index, box);
    }

    throwIfCancelled();
    updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();

    const typed = el("tb-name") ? getName() : "";
    const suggested = withExtension(typed || outputName(), "pdf");
    const saved = await saveFile(bytes, suggested, "pdf");
    reportSave(
      saved,
      applyAll ? `تم اقتصاص ${indexes.length} صفحة.` : `تم اقتصاص الصفحة ${pageNumber}.`
    );
  } catch (error) {
    reportFailure(error, "تعذّر اقتصاص الملف.");
  } finally {
    endProgress();
  }
}

function on(id, event, handler) {
  const target = node(id);
  if (!target) return;
  target.addEventListener(event, handler);
  subscriptions.push(() => target.removeEventListener(event, handler));
}

/** @param {ParentNode | null} [root] */
export function mount(root) {
  if (mounted) return;
  injectCropStyles();

  const host = root instanceof Element ? root : rootEl();
  if (!host || !node("crop-drop")) {
    console.warn("[crop] hub-fragment.html is not in the document. Paste it into index.html first.");
    return;
  }

  const stage = node("crop-stage");
  if (stage) {
    overlay = new CropOverlay(stage, { onChange: renderReadout });
  }

  if (!intakeWired) {
    wireIntake({
      dropId: "crop-drop",
      inputId: "crop-input",
      browseId: "crop-browse",
      accept: "pdf",
      onFiles: load
    });
    intakeWired = true;
  }

  on("crop-clear", "click", clear);
  on("crop-reset", "click", () => overlay?.reset("default"));
  on("crop-fill", "click", () => overlay?.reset("full"));
  on("crop-save", "click", () => void run());
  on("crop-prev", "click", () => void showPage(pageNumber - 1));
  on("crop-next", "click", () => void showPage(pageNumber + 1));
  on("crop-page", "change", () => {
    const input = /** @type {HTMLInputElement} */ (node("crop-page"));
    void showPage(Number.parseInt(input.value, 10) || 1);
  });
  on("crop-scope-current", "change", renderReadout);
  on("crop-scope-all", "change", renderReadout);

  mounted = true;
  syncChrome();
}

export function unmount() {
  for (const off of subscriptions) off();
  subscriptions = [];
  overlay?.dispose();
  overlay = null;
  clear();
  mounted = false;
}

export function enter() {
  if (doc) {
    syncChrome();
    renderReadout();
    if (pdfjsDoc) void showPage(pageNumber);
  } else {
    const drop = node("crop-drop");
    const panel = node("crop-panel");
    if (drop) drop.hidden = false;
    if (panel) panel.hidden = true;
    syncChrome();
  }
}

export function leave() {
  /* Keep the open file, same as the other tools. Call unmount() only to tear down. */
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clear();
  await load([file]);
}

export { outputName };
