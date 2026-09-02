import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, saveFile, saveFolder, withExtension } from "../lib/files.js";
import { uniqueIndexes } from "../lib/ranges.js";
import { lib, loadWritable } from "../pdf/core.js";
import { confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { confirmLarge, pad, parseRanges, rangesToIndexes, readPdfFile, reportFailure, reportSave } from "./shared.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
let saved = true;

const mode = () => /** @type {HTMLSelectElement} */ (el("split-mode")).value;

/** @returns {Array<{ label: string; indexes: number[] }>} */
function buildPlan() {
  if (!doc) return [];
  const stem = baseName(doc.name);
  const current = mode();

  if (current === "single") {
    return Array.from({ length: doc.pages }, (_, index) => ({
      label: `${stem}-${pad(index + 1, String(doc.pages).length)}.pdf`,
      indexes: [index]
    }));
  }

  if (current === "every") {
    const step = Math.max(1, Number(/** @type {HTMLInputElement} */ (el("split-every")).value) || 1);
    const out = [];
    for (let start = 0; start < doc.pages; start += step) {
      const indexes = [];
      for (let index = start; index < Math.min(start + step, doc.pages); index += 1) indexes.push(index);
      out.push({ label: `${stem}-${pad(out.length + 1, 2)}.pdf`, indexes });
    }
    return out;
  }

  const ranges = parseRanges(/** @type {HTMLInputElement} */ (el("split-ranges")).value, doc.pages);
  if (current === "extract") {
    const indexes = uniqueIndexes(rangesToIndexes(ranges), doc.pages);
    return indexes.length ? [{ label: `${stem}-مستخرج.pdf`, indexes }] : [];
  }
  return ranges.map((range, index) => ({
    label: `${stem}-${pad(index + 1, 2)}.pdf`,
    indexes: rangesToIndexes([range])
  }));
}

function renderPlan() {
  const host = el("split-plan");
  if (!host) return;
  host.replaceChildren();
  const plan = buildPlan();

  if (!plan.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "لا نطاقات صالحة بعد. اكتب نطاقاً داخل عدد صفحات المستند.";
    host.append(empty);
    setRunEnabled(false);
    return;
  }

  for (const entry of plan) {
    const row = document.createElement("div");
    row.className = "plan__row";
    const name = document.createElement("span");
    name.className = "plan__name";
    name.textContent = entry.label;
    const count = document.createElement("span");
    count.className = "plan__pages num";
    const first = entry.indexes[0] + 1;
    const last = entry.indexes[entry.indexes.length - 1] + 1;
    count.textContent = first === last ? `${first}` : `${first}–${last}`;
    const size = document.createElement("span");
    size.className = "plan__count num";
    size.textContent = `${entry.indexes.length}`;
    row.append(name, count, size);
    host.append(row);
  }

  setRunEnabled(true);
  setName(plan.length === 1 ? plan[0].label : `${baseName(doc.name)}-أجزاء`);
}

function syncFields() {
  const current = mode();
  el("split-ranges-field").hidden = current !== "ranges" && current !== "extract";
  el("split-every-field").hidden = current !== "every";
  const note = el("split-note");
  if (note) {
    note.textContent =
      current === "single"
        ? "كل صفحة ستُحفظ في ملف مستقل داخل مجلد أو ملف مضغوط."
        : current === "every"
          ? "يُقسَّم المستند إلى ملفات متتابعة بعدد الصفحات المحدد."
          : current === "extract"
            ? "تُجمع كل الصفحات المطلوبة في ملف واحد."
            : "اكتب النطاقات مفصولة بفواصل، مثل 1-3, 5, 8-12 — كل نطاق ملف مستقل.";
  }
  const label = mode() === "extract" || buildPlan().length === 1 ? "استخراج وحفظ" : "تقسيم وحفظ";
  el("tb-run-label").textContent = label;
  renderPlan();
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
    el("split-panel").hidden = false;
    el("split-drop").hidden = true;
    /** @type {HTMLInputElement} */ (el("split-ranges")).value = `1-${Math.min(doc.pages, Math.ceil(doc.pages / 2))}`;
    setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
    setState("idle");
    syncFields();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  saved = true;
  el("split-panel").hidden = true;
  el("split-drop").hidden = false;
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function requestClear() {
  if (!doc) return;
  if (!(await confirmDiscard(splitTool.name))) return;
  clear();
}

async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) {
    if (doc) clear();
    return;
  }
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clear();
  await load([file]);
}

async function run() {
  if (!doc) return;
  const plan = buildPlan();
  if (!plan.length) return;
  if (!(await confirmLarge(doc.pages, "تقسيم المستند"))) return;

  setState("busy");
  startProgress({ title: "تقسيم المستند", desc: `${plan.length} ملف ناتج.` });
  try {
    const source = await loadWritable(doc.bytes);
    /** @type {Array<{ name: string; data: Uint8Array }>} */
    const outputs = [];

    for (const [index, entry] of plan.entries()) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: (index / plan.length) * 100, detail: `${index + 1} / ${plan.length} — ${entry.label}` });
      const { PDFDocument } = lib();
      const target = await PDFDocument.create();
      const copied = await target.copyPages(source, entry.indexes);
      for (const page of copied) target.addPage(page);
      outputs.push({ name: entry.label, data: await target.save() });
    }

    throwIfCancelled();
    endProgress();

    if (outputs.length === 1) {
      const written = await saveFile(outputs[0].data, withExtension(el("tb-name").value, "pdf"), "pdf");
      if (written) saved = true;
      reportSave(written, `تم استخراج ${plan[0].indexes.length} صفحة.`);
      return;
    }
    const written = await saveFolder(outputs, el("tb-name").value || `${baseName(doc.name)}-أجزاء`);
    if (written) saved = true;
    reportSave(written, `تم إنشاء ${outputs.length} ملفات.`);
  } catch (error) {
    reportFailure(error, "تعذّر التقسيم.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const splitTool = {
  id: "split",
  name: "تقسيم",
  icon: "icon-split",
  input: "PDF",
  actionLabel: "تقسيم",

  setup() {
    wireIntake({ dropId: "split-drop", inputId: "split-input", browseId: "split-browse", accept: "pdf", onFiles: load });
    el("split-mode")?.addEventListener("change", syncFields);
    el("split-ranges")?.addEventListener("input", renderPlan);
    el("split-every")?.addEventListener("input", renderPlan);
    el("split-clear")?.addEventListener("click", requestClear);
  },

  enter() {
    if (doc) syncFields();
    else clear();
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
