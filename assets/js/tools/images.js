import { MM_TO_PT, PAGE_SIZES } from "../config.js";
import { el, yieldToUi } from "../dom.js";
import { filesKey, humanSize, saveFile, withExtension } from "../lib/files.js";
import { suggestImageOrder } from "../lib/image-order.js";
import { toEmbeddable } from "../lib/image-embed.js";
import { lib } from "../pdf/core.js";
import { confirmDiscard } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { ACTIONS, DocList } from "../ui/doclist.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { reportFailure, reportSave, uid } from "./shared.js";

/** @type {Array<{ id: string; file: File; url: string }>} */
let items = [];
/** @type {DocList | null} */
let list = null;
let saved = true;

function totalBytes() {
  return items.reduce((sum, item) => sum + item.file.size, 0);
}

function refresh() {
  list?.render(
    items.map((item) => ({
      id: item.id,
      name: item.file.name,
      meta: [humanSize(item.file.size)],
      thumb: { kind: "lazy", load: async () => item.url },
      actions: [ACTIONS.grab, ACTIONS.up, ACTIONS.down, ACTIONS.remove]
    }))
  );

  const has = items.length > 0;
  el("images-panel").hidden = !has;
  el("images-drop").hidden = has;
  const sort = el("images-sort");
  if (sort) sort.hidden = items.length < 2;
  setSource(has ? { label: `${items.length} صورة`, pages: String(items.length), size: humanSize(totalBytes()) } : {});
  setRunEnabled(has);
  setState(has ? "idle" : "waiting");
  if (has && !/\S/.test(el("tb-name").value)) setName("مستند-الصور.pdf");
}

function add(files) {
  for (const file of files) {
    items.push({ id: uid("img"), file, url: URL.createObjectURL(file) });
  }
  saved = false;
  refresh();
  toast(files.length === 1 ? "أُضيفت صورة." : `أُضيفت ${files.length} صور.`, "info");
}

function clear() {
  for (const item of items) URL.revokeObjectURL(item.url);
  items = [];
  saved = true;
  refresh();
}

async function requestClear() {
  if (!items.length) return;
  if (!(await confirmDiscard(imagesTool.name))) return;
  clear();
}

async function acceptFiles(files) {
  if (!files?.length) return;
  if (filesKey(files) === filesKey(items.map((item) => item.file))) return;
  clear();
  add(files);
}

async function suggestOrder() {
  if (items.length < 2) return;
  const result = await suggestImageOrder(
    items.map((item) => item.file),
    { visual: true }
  );
  const byKey = new Map(items.map((item) => [filesKey([item.file]), item]));
  items = result.files.map((file) => byKey.get(filesKey([file]))).filter(Boolean);
  saved = false;
  refresh();
  toast(
    result.method === "name"
      ? "رُتّبت حسب أرقام الاسم."
      : result.method === "time"
        ? "رُتّبت حسب وقت التصوير."
        : result.method === "visual"
          ? "رُتّبت بتشابه خفيف بين الصور."
          : "لم يتغيّر الترتيب.",
    "info"
  );
}

async function run() {
  if (!items.length) return;
  const { PDFDocument } = lib();
  const preset = /** @type {HTMLSelectElement} */ (el("images-page")).value;
  const orientation = /** @type {HTMLSelectElement} */ (el("images-orient")).value;
  const margin = Math.max(0, Number(/** @type {HTMLInputElement} */ (el("images-margin")).value) || 0) * MM_TO_PT;

  setState("busy");
  startProgress({ title: "إنشاء ملف PDF", desc: "نعالج الصور واحدة تلو الأخرى." });
  try {
    const doc = await PDFDocument.create();

    for (const [index, item] of items.entries()) {
      throwIfCancelled();
      if (index % 1 === 0) await yieldToUi();
      updateProgress({
        percent: (index / items.length) * 100,
        detail: `${index + 1} / ${items.length} — ${item.file.name}`
      });

      const asset = await toEmbeddable(item.file);
      const image = asset.kind === "png" ? await doc.embedPng(asset.bytes) : await doc.embedJpg(asset.bytes);

      let pageWidth;
      let pageHeight;
      if (preset === "fit") {
        pageWidth = image.width * 0.75 + margin * 2;
        pageHeight = image.height * 0.75 + margin * 2;
      } else {
        const base = PAGE_SIZES[preset] ?? PAGE_SIZES.a4;
        const landscape =
          orientation === "landscape" || (orientation === "auto" && image.width > image.height);
        pageWidth = landscape ? base.height : base.width;
        pageHeight = landscape ? base.width : base.height;
      }

      const page = doc.addPage([pageWidth, pageHeight]);
      const boxWidth = Math.max(1, pageWidth - margin * 2);
      const boxHeight = Math.max(1, pageHeight - margin * 2);
      const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      page.drawImage(image, {
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
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, `تم إنشاء ملف من ${items.length} صورة.`);
  } catch (error) {
    reportFailure(error, "تعذّر إنشاء ملف PDF.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const imagesTool = {
  id: "images",
  name: "صور → PDF",
  icon: "icon-images",
  hidden: true,
  actionLabel: "إنشاء PDF",
  outputName: () => "مستند-الصور.pdf",

  setup() {
    list = new DocList("images-list", {
      emptyText: "لا صور بعد. أسقط صوراً أو الصقها من الحافظة.",
      onAction(action, id) {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return;
        if (action === "remove") {
          URL.revokeObjectURL(items[index].url);
          items.splice(index, 1);
        } else if (action === "up" && index > 0) {
          items.splice(index - 1, 0, items.splice(index, 1)[0]);
        } else if (action === "down" && index < items.length - 1) {
          items.splice(index + 1, 0, items.splice(index, 1)[0]);
        }
        saved = false;
        refresh();
      },
      onReorder(ids) {
        items = ids.map((id) => items.find((item) => item.id === id)).filter(Boolean);
        saved = false;
        refresh();
      }
    });

    wireIntake({ dropId: "images-drop", inputId: "images-input", browseId: "images-browse", accept: "image", onFiles: add });
    el("images-add")?.addEventListener("click", () => el("images-input").click());
    el("images-clear")?.addEventListener("click", requestClear);
    el("images-sort")?.addEventListener("click", () => void suggestOrder());
  },

  enter: refresh,
  isDirty: () => items.length > 0 && !saved,
  acceptFiles,
  run
};
