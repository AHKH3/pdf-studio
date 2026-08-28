import { COMPRESS_LEVELS } from "../config.js";
import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, saveFile, withExtension } from "../lib/files.js";
import { lib, loadWritable, openDocument, renderPageAtDpi } from "../pdf/core.js";
import { confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { confirmLarge, readPdfFile, reportFailure, reportSave } from "./shared.js";
import { decodeImageBytes, encodeJpegCanvas, resizeRgbaCanvas } from "./compress/jpegify.js";
import { recompressImageXObjects, savingsPercent } from "./compress/xobjects.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
let saved = true;
/** @type {{ bytes: number; replaced?: number } | null} */
let lastResult = null;

function selectedMode() {
  const raster = /** @type {HTMLInputElement | null} */ (el("compress-mode-raster"));
  return raster?.checked ? "raster" : "text";
}

function selectedLevel() {
  return COMPRESS_LEVELS[/** @type {HTMLSelectElement} */ (el("compress-level")).value] ?? COMPRESS_LEVELS.balanced;
}

function syncModeUi() {
  const raster = selectedMode() === "raster";
  const textNote = el("compress-note-text");
  const rasterNote = el("compress-note-raster");
  if (textNote) textNote.hidden = raster;
  if (rasterNote) rasterNote.hidden = !raster;
  renderReadout(lastResult);
}

function appendCell(host, label, value, kind) {
  const cell = document.createElement("div");
  cell.className = "readout__cell";
  if (kind) cell.classList.add(`readout__cell--${kind}`);
  const key = document.createElement("span");
  key.className = "readout__label";
  key.textContent = label;
  const val = document.createElement("span");
  val.className = kind === "mode" ? "readout__value" : "readout__value num";
  val.textContent = value;
  cell.append(key, val);
  host.append(cell);
}

function renderReadout(result) {
  lastResult = result || null;
  const host = el("compress-readout");
  if (!host || !doc) return;
  host.replaceChildren();

  const mode = selectedMode();
  const level = selectedLevel();
  appendCell(host, "الحجم قبل", humanSize(doc.size), "before");
  appendCell(host, "الصفحات", String(doc.pages));
  appendCell(host, "الطريقة", mode === "raster" ? "مسح ضوئي" : "يحافظ على النص", "mode");
  appendCell(host, "الدقة", `${level.dpi} DPI`);

  if (result?.bytes) {
    const ratio = savingsPercent(doc.size, result.bytes);
    const afterKind = result.bytes < doc.size ? "after" : result.bytes > doc.size ? "loss" : "";
    appendCell(host, "الحجم بعد", humanSize(result.bytes), afterKind);
    appendCell(
      host,
      "التوفير",
      ratio > 0 ? `${ratio}%` : ratio < 0 ? `زاد ${Math.abs(ratio)}%` : "بدون تغيير",
      ratio > 0 ? "gain" : ratio < 0 ? "loss" : ""
    );
    if (mode === "text" && typeof result.replaced === "number") {
      appendCell(host, "صور أُعيد ضغطها", String(result.replaced));
    }
  }
}

/** @param {File[]} files */
async function load(files) {
  const file = files[0];
  if (!file) return;
  if (doc && !(await confirmReplace(doc.name))) return;
  const loaded = await readPdfFile(file);
  if (!loaded) return;
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    doc = loaded;
    saved = false;
    lastResult = null;
    el("compress-panel").hidden = false;
    el("compress-drop").hidden = true;
    setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
    setName(`${baseName(doc.name)}-مضغوط.pdf`);
    setRunEnabled(true);
    setState("idle");
    syncModeUi();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  saved = true;
  lastResult = null;
  el("compress-panel").hidden = true;
  el("compress-drop").hidden = false;
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function requestClear() {
  if (!doc) return;
  if (!(await confirmDiscard(compressTool.name))) return;
  clear();
}

async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clear();
  await load([file]);
}

async function runRaster(level, grayscale) {
  const { PDFDocument } = lib();
  startProgress({ title: "ضغط المستند", desc: "نعيد رسم كل صفحة بدقة أقل." });
  /** @type {any} */
  let source = null;
  try {
    source = await openDocument(doc.bytes, doc.password);
    const target = await PDFDocument.create();

    for (let number = 1; number <= source.numPages; number += 1) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: ((number - 1) / source.numPages) * 100, detail: `صفحة ${number} من ${source.numPages}` });

      const page = await source.getPage(number);
      const raster = await renderPageAtDpi(page, level.dpi, grayscale, level.quality);
      page.cleanup();

      const embedded = await target.embedJpg(raster.bytes);
      const width = (raster.width * 72) / level.dpi;
      const height = (raster.height * 72) / level.dpi;
      const created = target.addPage([width, height]);
      created.drawImage(embedded, { x: 0, y: 0, width, height });
    }

    await source.destroy();
    source = null;
    throwIfCancelled();
    updateProgress({ percent: 97, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    return { bytes };
  } finally {
    await source?.destroy?.().catch(() => {});
  }
}

async function runPreserve(level, grayscale) {
  startProgress({ title: "ضغط المستند", desc: "نعيد ضغط الصور ونبقي النص." });
  const pdf = await loadWritable(doc.bytes);
  const stats = await recompressImageXObjects(pdf, {
    pdfLib: lib(),
    dpi: level.dpi,
    quality: level.quality,
    grayscale,
    encodeJpeg: encodeJpegCanvas,
    decodeImage: decodeImageBytes,
    resize: resizeRgbaCanvas,
    onProgress: async ({ done, total }) => {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({
        percent: total ? (done / total) * 95 : 40,
        detail: total ? `صورة ${Math.min(total, done + 1)} من ${total}` : "نبحث عن الصور"
      });
    }
  });
  throwIfCancelled();
  updateProgress({ percent: 97, desc: "نكتب الملف.", detail: "" });
  const bytes = await pdf.save();
  return { bytes, replaced: stats.replaced, seen: stats.seen };
}

function saveMessage(result, mode) {
  const before = humanSize(doc.size);
  const after = humanSize(result.bytes);
  if (result.bytes < doc.size) {
    const extra = mode === "text" ? " النص ما زال قابلاً للبحث والنسخ." : "";
    return `انخفض الحجم من ${before} إلى ${after}.${extra}`;
  }
  if (mode === "text" && (result.replaced || 0) === 0) {
    return `الناتج ${after} — لا صور كبيرة لإعادة ضغطها. النص بقي كما هو. للمستندات المصوّرة اختر «مثل المسح الضوئي».`;
  }
  return `الناتج ${after} — هذا المستند مضغوط أصلاً، جرّب مستوى أقوى.`;
}

async function run() {
  if (!doc) return;
  if (!(await confirmLarge(doc.pages, "ضغط المستند"))) return;
  const level = selectedLevel();
  const grayscale = /** @type {HTMLSelectElement} */ (el("compress-gray")).value === "gray";
  const mode = selectedMode();

  setState("busy");
  try {
    const result = mode === "raster" ? await runRaster(level, grayscale) : await runPreserve(level, grayscale);
    endProgress();
    renderReadout({ bytes: result.bytes, replaced: result.replaced });
    const written = await saveFile(result.bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, saveMessage(result, mode));
  } catch (error) {
    reportFailure(error, "تعذّر الضغط.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const compressTool = {
  id: "compress",
  name: "ضغط",
  icon: "icon-compress",
  input: "PDF",
  actionLabel: "ضغط",

  setup() {
    wireIntake({
      dropId: "compress-drop",
      inputId: "compress-input",
      browseId: "compress-browse",
      accept: "pdf",
      onFiles: load
    });
    el("compress-level")?.addEventListener("change", () => {
      saved = false;
      renderReadout(lastResult);
    });
    el("compress-gray")?.addEventListener("change", () => {
      saved = false;
    });
    for (const id of ["compress-mode-text", "compress-mode-raster"]) {
      el(id)?.addEventListener("change", () => {
        saved = false;
        lastResult = null;
        syncModeUi();
      });
    }
    el("compress-clear")?.addEventListener("click", requestClear);
  },

  enter() {
    if (doc) {
      setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
      setName(`${baseName(doc.name)}-مضغوط.pdf`);
      setRunEnabled(true);
      syncModeUi();
    } else {
      clear();
    }
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
