import { LARGE_DOCUMENT_PAGES } from "../config.js";
import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, isDesktop, saveFile, saveFolder, withExtension } from "../lib/files.js";
import { PageThumbnails, openDocument, renderPageToBlob } from "../pdf/core.js";
import { ACTIONS, DocList } from "../ui/doclist.js";
import { confirmAction, confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { confirmLarge, pad, readPdfFile, reportFailure, reportSave } from "./shared.js";
import { createZipWriter } from "../lib/zip.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
/** @type {PageThumbnails | null} */
let thumbs = null;
/** @type {DocList | null} */
let list = null;
let saved = true;

const format = () => /** @type {HTMLSelectElement} */ (el("rasterize-format")).value;
const scaleFactor = () => Number(/** @type {HTMLSelectElement} */ (el("rasterize-scale")).value) || 2;
const target = () => /** @type {HTMLSelectElement} */ (el("rasterize-target")).value;

function refresh() {
  if (!doc || !thumbs) {
    list?.render([]);
    return;
  }
  list.render(
    Array.from({ length: doc.pages }, (_, index) => ({
      id: String(index + 1),
      name: `صفحة ${index + 1}`,
      meta: [`${format().toUpperCase()} ×${scaleFactor()}`],
      thumb: { kind: "lazy", load: () => thumbs.get(index + 1) },
      actions: [ACTIONS.download]
    }))
  );
  setName(`${baseName(doc.name)}-صور`);
}

function showDoc() {
  el("rasterize-panel").hidden = false;
  el("rasterize-drop").hidden = true;
  setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
  setRunEnabled(true);
  setState("idle");
}

function warnFolderFallback() {
  if (target() === "folder" && !isDesktop) {
    toast("المتصفح لا يسمح باختيار مجلد، لذلك سيُحفظ ملف ZIP.", "info");
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
    await thumbs?.dispose();
    doc = loaded;
    thumbs = new PageThumbnails(loaded.bytes, loaded.password);
    saved = false;
    showDoc();
    refresh();
    if (loaded.pages >= LARGE_DOCUMENT_PAGES) {
      toast("مستند كبير: المصغّرات تظهر أثناء التمرير. التصدير قابل للإيقاف.", "info");
    }
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

async function clear() {
  await thumbs?.dispose();
  thumbs = null;
  doc = null;
  saved = true;
  list?.render([]);
  el("rasterize-panel").hidden = true;
  el("rasterize-drop").hidden = false;
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function requestClear() {
  if (!doc) return;
  if (!(await confirmDiscard(rasterizeTool.name))) return;
  await clear();
}

async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) {
    if (doc) await clear();
    return;
  }
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) await clear();
  await load([file]);
}

/** @param {number} pageNumber */
async function exportOne(pageNumber) {
  if (!doc) return;
  const kind = format();
  startProgress({ title: "تصدير الصفحة", desc: `صفحة ${pageNumber}`, cancellable: false });
  try {
    const source = await openDocument(doc.bytes, doc.password);
    const page = await source.getPage(pageNumber);
    const blob = await renderPageToBlob(page, scaleFactor(), `image/${kind}`, kind === "jpeg" ? 0.92 : undefined);
    page.cleanup();
    await source.destroy();
    endProgress();
    const name = `${baseName(doc.name)}-${pad(pageNumber, String(doc.pages).length)}.${kind === "jpeg" ? "jpg" : "png"}`;
    const written = await saveFile(new Uint8Array(await blob.arrayBuffer()), name, kind);
    reportSave(written, `تم حفظ صفحة ${pageNumber}.`);
  } catch (error) {
    reportFailure(error, "تعذّر تصدير الصفحة.");
  } finally {
    endProgress();
  }
}

async function confirmHeavyExport() {
  if (!doc) return false;
  if (!(await confirmLarge(doc.pages, "تحويل الصفحات إلى صور"))) return false;
  const cost = doc.pages * scaleFactor() * scaleFactor();
  if (cost < 500) return true;
  return confirmAction({
    title: "دقة عالية",
    desc: `${doc.pages} صفحة بدقة ×${scaleFactor()} تستهلك ذاكرة كثيرة. خفّض الدقة إن تجمّدت الواجهة.`,
    confirmLabel: "متابعة",
    cancelLabel: "رجوع"
  });
}

async function run() {
  if (!doc) return;
  if (!(await confirmHeavyExport())) return;
  warnFolderFallback();

  const kind = format();
  const extension = kind === "jpeg" ? "jpg" : "png";
  const digits = String(doc.pages).length;
  // Decided before the loop: the folder path must collect every file for one
  // IPC call; the ZIP path streams page-by-page so only one rendered image
  // is alive at a time.
  const useFolder = target() === "folder" && isDesktop;
  const zip = useFolder ? null : createZipWriter();
  /** @type {Array<{ name: string; data: Uint8Array }>} */
  const files = [];
  let count = 0;

  setState("busy");
  startProgress({ title: "تحويل الصفحات إلى صور", desc: `${doc.pages} صفحة بدقة ×${scaleFactor()}.` });
  /** @type {any} */
  let source = null;
  try {
    source = await openDocument(doc.bytes, doc.password);

    for (let number = 1; number <= source.numPages; number += 1) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: ((number - 1) / source.numPages) * 100, detail: `صفحة ${number} من ${source.numPages}` });
      const page = await source.getPage(number);
      const blob = await renderPageToBlob(page, scaleFactor(), `image/${kind}`, kind === "jpeg" ? 0.92 : undefined);
      page.cleanup();
      const data = new Uint8Array(await blob.arrayBuffer());
      count = number;
      if (zip) zip.add(`${baseName(doc.name)}-${pad(number, digits)}.${extension}`, data);
      else files.push({ name: `${baseName(doc.name)}-${pad(number, digits)}.${extension}`, data });
    }

    await source.destroy();
    source = null;
    throwIfCancelled();

    const folderName = el("tb-name").value || `${baseName(doc.name)}-صور`;
    let written;
    if (useFolder) {
      updateProgress({ percent: 97, desc: "نحفظ الصور في المجلد.", detail: `${count} صورة` });
      await yieldToUi();
      endProgress();
      written = await saveFolder(files, folderName);
    } else {
      updateProgress({ percent: 97, desc: "نجهّز ملف ZIP.", detail: `${count} صورة` });
      await yieldToUi();
      endProgress();
      written = await saveFile(zip.finish(), withExtension(folderName, "zip"), "zip");
    }
    if (written) saved = true;
    reportSave(
      written,
      useFolder ? `تم تصدير ${count} صورة إلى مجلد.` : `تم تصدير ${count} صورة في ملف ZIP.`
    );
  } catch (error) {
    reportFailure(error, "تعذّر التحويل.");
  } finally {
    // Cancel throws mid-loop; the document must close on every exit path.
    await source?.destroy?.().catch(() => {});
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const rasterizeTool = {
  id: "rasterize",
  name: "PDF ← صور",
  icon: "icon-pdf-to-images",
  input: "PDF",
  actionLabel: "تصدير",

  setup() {
    list = new DocList("rasterize-list", {
      emptyText: "لا صفحات.",
      onAction(action, id) {
        if (action === "download") exportOne(Number(id));
      }
    });
    wireIntake({
      dropId: "rasterize-drop",
      inputId: "rasterize-input",
      browseId: "rasterize-browse",
      accept: "pdf",
      onFiles: load
    });
    el("rasterize-format")?.addEventListener("change", () => {
      saved = false;
      refresh();
    });
    el("rasterize-scale")?.addEventListener("change", () => {
      saved = false;
      refresh();
    });
    el("rasterize-target")?.addEventListener("change", warnFolderFallback);
    el("rasterize-clear")?.addEventListener("click", requestClear);
  },

  enter() {
    if (doc) {
      showDoc();
      refresh();
    } else {
      clear();
    }
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
