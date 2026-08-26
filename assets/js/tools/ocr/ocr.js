import { el, yieldToUi } from "../../dom.js";
import { baseName, humanSize, saveFile, withExtension } from "../../lib/files.js";
import { uniqueIndexes } from "../../lib/ranges.js";
import { loadWritable, openDocument, pdfRenderContext } from "../../pdf/core.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../../ui/feedback.js";
import { wireIntake } from "../../ui/intake.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { confirmLarge, parseRanges, rangesToIndexes, readPdfFile, reportFailure, reportSave } from "../shared.js";
import { ensureWorker, setWorkerLogger, terminateWorker } from "./engine.js";
import { collectWords, drawInvisibleWords } from "./overlay.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
let mounted = false;
/** @type {Array<() => void>} */
let subscriptions = [];

function node(id) {
  return document.getElementById(id);
}

function hasTitleBlock() {
  return Boolean(el("tb-run"));
}

function outputName() {
  return doc ? `${baseName(doc.name)}-قابل-للبحث.pdf` : "";
}

function dpi() {
  return Number(/** @type {HTMLSelectElement | null} */ (node("ocr-dpi"))?.value) || 200;
}

function psm() {
  return String(/** @type {HTMLSelectElement | null} */ (node("ocr-psm"))?.value || "3");
}

function skipDigital() {
  return Boolean(/** @type {HTMLInputElement | null} */ (node("ocr-skip-text"))?.checked);
}

function selectedIndexes() {
  if (!doc) return [];
  const text = /** @type {HTMLInputElement | null} */ (node("ocr-ranges"))?.value || "";
  const ranges = parseRanges(text, doc.pages);
  if (!ranges.length) return Array.from({ length: doc.pages }, (_, i) => i);
  return uniqueIndexes(rangesToIndexes(ranges), doc.pages);
}

function syncChrome() {
  const save = node("ocr-save");
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
  const host = node("ocr-readout");
  if (!host) return;
  host.replaceChildren();
  if (!doc) return;

  const indexes = selectedIndexes();
  const rows = [
    ["الصفحات", String(doc.pages)],
    ["سيُتعرَّف عليها", String(indexes.length || doc.pages)],
    ["اللغات", "عربي + إنجليزي"],
    ["الدقة", `${dpi()} نقطة/بوصة`]
  ];

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

/** @param {File[]} files */
async function load(files) {
  const file = files[0];
  if (!file) return;
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    const loaded = await readPdfFile(file);
    if (!loaded) {
      setState("idle");
      return;
    }
    doc = loaded;
    const drop = node("ocr-drop");
    const panel = node("ocr-panel");
    if (drop) drop.hidden = true;
    if (panel) panel.hidden = false;
    syncChrome();
    renderReadout();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  const drop = node("ocr-drop");
  const panel = node("ocr-panel");
  if (drop) drop.hidden = false;
  if (panel) panel.hidden = true;
  const ranges = /** @type {HTMLInputElement | null} */ (node("ocr-ranges"));
  if (ranges) ranges.value = "";
  renderReadout();
  syncChrome();
}

async function pageHasDigitalText(page) {
  const content = await page.getTextContent();
  let letters = 0;
  for (const item of content.items || []) {
    letters += String(item.str || "").replace(/\s+/g, "").length;
    if (letters >= 24) return true;
  }
  return false;
}

/**
 * @param {any} page
 * @param {number} renderDpi
 */
async function renderForOcr(page, renderDpi) {
  const scale = renderDpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = pdfRenderContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

export async function run() {
  if (!doc) return;
  const indexes = selectedIndexes();
  if (!indexes.length) {
    reportFailure(new Error("لا توجد صفحات في النطاق المكتوب."), "لا توجد صفحات في النطاق المكتوب.");
    return;
  }
  if (!(await confirmLarge(indexes.length, "التعرف الضوئي"))) return;

  const renderDpi = dpi();
  const pageSeg = psm();
  const skip = skipDigital();

  setState("busy");
  startProgress({ title: "تعرف ضوئي", desc: "نقرأ الصفحات محلياً بالعربية والإنجليزية." });
  /** @type {any} */
  let source = null;
  try {
    let recognized = 0;
    let skipped = 0;
    let wordsDrawn = 0;
    setWorkerLogger((msg) => {
      if (msg?.status === "loading language traineddata") {
        updateProgress({ detail: "تحميل نماذج ara+eng" });
      } else if (msg?.status === "recognizing text" && typeof msg.progress === "number") {
        updateProgress({
          percent: Math.min(96, ((recognized + msg.progress) / indexes.length) * 100)
        });
      }
    });
    const worker = await ensureWorker();
    throwIfCancelled();
    await worker.setParameters({
      tessedit_pageseg_mode: pageSeg,
      user_defined_dpi: String(renderDpi),
      preserve_interword_spaces: "1"
    });

    source = await openDocument(doc.bytes, doc.password);
    const target = await loadWritable(doc.bytes);
    const pages = target.getPages();

    for (let i = 0; i < indexes.length; i += 1) {
      throwIfCancelled();
      await yieldToUi();
      const index = indexes[i];
      updateProgress({
        percent: (i / indexes.length) * 100,
        detail: `صفحة ${index + 1} من ${doc.pages}`
      });

      const pdfjsPage = await source.getPage(index + 1);
      if (skip && (await pageHasDigitalText(pdfjsPage))) {
        skipped += 1;
        pdfjsPage.cleanup();
        continue;
      }

      const { canvas, viewport } = await renderForOcr(pdfjsPage, renderDpi);
      pdfjsPage.cleanup();
      throwIfCancelled();

      const result = await worker.recognize(
        canvas,
        {},
        { text: false, blocks: true }
      );
      canvas.width = 0;
      canvas.height = 0;

      const words = collectWords(result?.data);
      wordsDrawn += drawInvisibleWords(target, pages[index], viewport, words);
      recognized += 1;
    }

    await source.destroy();
    source = null;
    throwIfCancelled();
    updateProgress({ percent: 97, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();

    const suggested = withExtension(hasTitleBlock() ? getName() || outputName() : outputName(), "pdf");
    const saved = await saveFile(bytes, suggested, "pdf");
    const skipNote = skipped ? ` وتُركت ${skipped} صفحة رقمية.` : "";
    reportSave(
      saved,
      recognized
        ? `أُضيفت طبقة بحث على ${recognized} صفحة (${wordsDrawn} كلمة).${skipNote}`
        : `لم يُتعرَّف على صفحات.${skipNote}`
    );
  } catch (error) {
    const detail = String(error?.message || "");
    const fallback =
      /copy-runtime|tesseract|tessdata|traineddata/i.test(detail) ? detail : "تعذّر التعرف الضوئي.";
    reportFailure(error, fallback);
  } finally {
    // Cancel throws mid-loop; the document must close on every exit path.
    await source?.destroy?.().catch(() => {});
    setWorkerLogger(() => {});
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
  const host = root instanceof Element ? root : document.getElementById("view-ocr") || document;
  if (!host || !node("ocr-drop")) {
    console.warn("[ocr] hub-fragment.html is not in the document. Paste it into index.html first.");
    return;
  }

  wireIntake({
    dropId: "ocr-drop",
    inputId: "ocr-input",
    browseId: "ocr-browse",
    accept: "pdf",
    onFiles: load
  });

  on("ocr-clear", "click", clear);
  on("ocr-save", "click", () => void run());
  on("ocr-dpi", "change", renderReadout);
  on("ocr-psm", "change", renderReadout);
  on("ocr-ranges", "input", renderReadout);
  on("ocr-skip-text", "change", renderReadout);

  mounted = true;
  syncChrome();
}

export async function unmount() {
  for (const off of subscriptions) off();
  subscriptions = [];
  clear();
  mounted = false;
  await terminateWorker();
}

export function enter() {
  if (doc) {
    syncChrome();
    renderReadout();
  } else {
    const drop = node("ocr-drop");
    const panel = node("ocr-panel");
    if (drop) drop.hidden = false;
    if (panel) panel.hidden = true;
    syncChrome();
  }
}

export function leave() {
  /* Keep the open file. Call unmount() only to tear down. */
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clear();
  await load([file]);
}

export { outputName };
