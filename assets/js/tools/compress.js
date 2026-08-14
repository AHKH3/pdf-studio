import { COMPRESS_LEVELS } from "../config.js";
import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, saveFile, withExtension } from "../lib/files.js";
import { lib, openDocument, renderPageAtDpi } from "../pdf/core.js";
import { confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { confirmLarge, readPdfFile, reportFailure, reportSave } from "./shared.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
let saved = true;

function renderReadout(resultSize) {
  const host = el("compress-readout");
  if (!host || !doc) return;
  host.replaceChildren();

  const rows = [
    ["الحجم الحالي", humanSize(doc.size)],
    ["الصفحات", String(doc.pages)],
    ["الدقة الناتجة", `${COMPRESS_LEVELS[/** @type {HTMLSelectElement} */ (el("compress-level")).value].dpi} DPI`]
  ];
  if (resultSize) {
    const ratio = Math.max(0, Math.round((1 - resultSize / doc.size) * 100));
    rows.push(["الحجم بعد الضغط", humanSize(resultSize)], ["التوفير", `${ratio}%`]);
  }

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
  if (doc && !(await confirmReplace(doc.name))) return;
  const loaded = await readPdfFile(file);
  if (!loaded) return;
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    doc = loaded;
    saved = false;
    el("compress-panel").hidden = false;
    el("compress-drop").hidden = true;
    setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
    setName(`${baseName(doc.name)}-مضغوط.pdf`);
    setRunEnabled(true);
    setState("idle");
    renderReadout(0);
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  saved = true;
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

async function run() {
  if (!doc) return;
  if (!(await confirmLarge(doc.pages, "ضغط المستند"))) return;
  const { PDFDocument } = lib();
  const level = COMPRESS_LEVELS[/** @type {HTMLSelectElement} */ (el("compress-level")).value] ?? COMPRESS_LEVELS.balanced;
  const grayscale = /** @type {HTMLSelectElement} */ (el("compress-gray")).value === "gray";

  setState("busy");
  startProgress({ title: "ضغط المستند", desc: "نعيد رسم كل صفحة بدقة أقل." });
  try {
    const source = await openDocument(doc.bytes, doc.password);
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
    throwIfCancelled();
    updateProgress({ percent: 97, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();

    renderReadout(bytes.length);
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(
      written,
      bytes.length < doc.size
        ? `انخفض الحجم من ${humanSize(doc.size)} إلى ${humanSize(bytes.length)}.`
        : `الناتج ${humanSize(bytes.length)} — هذا المستند مضغوط أصلاً، جرّب مستوى أقوى.`
    );
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
      renderReadout(0);
    });
    el("compress-clear")?.addEventListener("click", requestClear);
  },

  enter() {
    if (doc) {
      setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
      setName(`${baseName(doc.name)}-مضغوط.pdf`);
      setRunEnabled(true);
      renderReadout(0);
    } else {
      clear();
    }
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
