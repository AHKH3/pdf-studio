import { el } from "../../dom.js";
import { baseName, humanSize, saveFile, saveFolder, saveZip } from "../../lib/files.js";
import { ACTIONS, DocList } from "../../ui/doclist.js";
import { endProgress, startProgress, updateProgress } from "../../ui/feedback.js";
import { wireIntake } from "../../ui/intake.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { confirmDiscard, confirmLarge, confirmReplace, pad, readPdfFile, reportFailure, reportSave } from "../shared.js";
import { extractEmbeddedImages } from "./extract.js";

export const id = "extract-images";
export const title = "صور أصلية";

const DOWNLOAD = { ...ACTIONS.download, label: "حفظ هذه الصورة" };

function saveKind(image) {
  if (image.saveKind === "jpeg") return "jpeg";
  if (image.saveKind === "png") return "png";
  return "jp2";
}

/** @type {{ name: string; pages: number; size: number; password: string; images: Array<Record<string, any>> } | null} */
let session = null;
/** @type {DocList | null} */
let list = null;
let wired = false;

function target() {
  return /** @type {HTMLSelectElement | null} */ (el("extract-images-target"))?.value || "zip";
}

function outputStem() {
  if (!session) return "صور-مضمّنة";
  return getName() || `${baseName(session.name)}-صور-مضمّنة`;
}

function pageLabel(pages) {
  if (!pages?.length) return "—";
  if (pages.length === 1) return `صفحة ${pages[0]}`;
  if (pages.length === 2) return `صفحات ${pages[0]} و${pages[1]}`;
  return `صفحة ${pages[0]} +${pages.length - 1}`;
}

function provenanceLabel(provenance) {
  if (provenance === "original") return "أصلية";
  if (provenance === "inline") return "مضمّنة";
  return "بدون فقدان";
}

function toStored(image, index, total) {
  const digits = String(total).length;
  const filename = `${pad(index + 1, digits)}-${image.width}x${image.height}.${image.ext}`;
  const url = image.ext === "jp2" ? "" : URL.createObjectURL(new Blob([image.bytes], { type: image.mime }));
  return { ...image, id: `img-${index}`, filename, url };
}

function refresh() {
  if (!session) {
    list?.render([]);
    return;
  }
  list?.render(
    session.images.map((image) => ({
      id: image.id,
      name: image.filename,
      meta: [
        image.formatLabel,
        `${image.width}×${image.height}`,
        pageLabel(image.pages),
        humanSize(image.bytes.length),
        provenanceLabel(image.provenance)
      ],
      thumb: image.url ? { kind: "url", url: image.url } : { kind: "icon", icon: "icon-images" },
      actions: [DOWNLOAD]
    }))
  );
  setName(`${baseName(session.name)}-صور-مضمّنة`);
}

function showPanel(open) {
  const panel = el("extract-images-panel");
  const drop = el("extract-images-drop");
  if (panel) panel.hidden = !open;
  if (drop) drop.hidden = open;
}

function revokeAll() {
  if (!session) return;
  for (const image of session.images) {
    if (image.url) URL.revokeObjectURL(image.url);
  }
}

function clear() {
  revokeAll();
  session = null;
  list?.render([]);
  showPanel(false);
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function load(files) {
  const file = files[0];
  if (!file) return;
  if (session && !(await confirmReplace(session.name))) return;

  const loaded = await readPdfFile(file);
  if (!loaded) return;
  if (!(await confirmLarge(loaded.pages, "قراءة الصور المضمّنة"))) return;

  startProgress({ title: "استخراج الصور المضمّنة", desc: file.name });
  try {
    const extracted = await extractEmbeddedImages(loaded.bytes, {
      password: loaded.password,
      onProgress({ percent, page, pages, stage }) {
        const detail =
          stage === "operators" ? `مسح أوامر الصفحة ${page} من ${pages}` : `موارد الصفحة ${page} من ${pages}`;
        updateProgress({ percent, detail });
      }
    });
    revokeAll();
    session = {
      name: loaded.name,
      pages: loaded.pages,
      size: loaded.size,
      password: loaded.password,
      images: extracted.map((image, index) => toStored(image, index, extracted.length))
    };
    showPanel(true);
    setSource({
      label: session.name,
      pages: `${session.images.length} صورة`,
      size: humanSize(session.size)
    });
    setRunEnabled(session.images.length > 0);
    setState("idle", session.images.length ? undefined : "لا صور");
    refresh();
  } catch (error) {
    reportFailure(error, "تعذّر استخراج الصور.");
  } finally {
    endProgress();
  }
}

async function exportOne(id) {
  const image = session?.images.find((item) => item.id === id);
  if (!image) return;
  const saved = await saveFile(image.bytes, image.filename, saveKind(image));
  reportSave(saved, `تم حفظ ${image.filename}.`);
}

async function run() {
  if (!session?.images.length) return;
  const stem = outputStem();
  const files = session.images.map((image) => ({ name: image.filename, data: image.bytes }));

  setState("busy");
  try {
    if (files.length === 1) {
      const image = session.images[0];
      const saved = await saveFile(image.bytes, `${stem}.${image.ext}`, saveKind(image));
      reportSave(saved, "تم حفظ الصورة.");
      return;
    }
    const saved =
      target() === "folder" ? await saveFolder(files, stem) : await saveZip(files, stem);
    reportSave(saved, `تم حفظ ${files.length} صورة.`);
  } catch (error) {
    reportFailure(error, "تعذّر حفظ الصور.");
  }
}

async function onClear() {
  if (session && !(await confirmDiscard(title))) return;
  clear();
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (session && session.name === file.name && session.size === file.size) return;
  if (session) {
    revokeAll();
    session = null;
  }
  await load([file]);
}

/**
 * @param {HTMLElement} [host]
 */
export function mount(host) {
  const root = host || el("view-extract-images");
  if (!root) {
    console.error("extract-images: missing #view-extract-images — paste hub-fragment.html into index.html");
    return;
  }
  if (wired) return;
  wired = true;

  list = new DocList("extract-images-list", {
    emptyText: "لا توجد صور مضمّنة في هذا الملف. إذا أردت صورة لكل صفحة فاستخدم «PDF → صور».",
    onAction(action, imageId) {
      if (action === "download") exportOne(imageId);
    }
  });
  wireIntake({
    dropId: "extract-images-drop",
    inputId: "extract-images-input",
    browseId: "extract-images-browse",
    accept: "pdf",
    onFiles: load
  });
  el("extract-images-clear")?.addEventListener("click", () => {
    void onClear();
  });
}

export function unmount() {
  clear();
}

export function enter() {
  if (session) {
    setSource({
      label: session.name,
      pages: `${session.images.length} صورة`,
      size: humanSize(session.size)
    });
    setRunEnabled(session.images.length > 0);
    setState("idle");
    refresh();
    return;
  }
  showPanel(false);
  setRunEnabled(false);
  setState("waiting");
}

export const extractImagesTool = {
  id,
  name: title,
  icon: "icon-images",
  input: "PDF",
  actionLabel: "حفظ",
  setup: () => mount(),
  enter,
  run,
  acceptFiles,
  outputName: outputStem
};

export const manifest = { id, title, mount, unmount };

export default extractImagesTool;
