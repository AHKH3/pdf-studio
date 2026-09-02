import { LARGE_DOCUMENT_PAGES } from "../config.js";
import { el, yieldToUi } from "../dom.js";
import { baseName, filesKey, humanSize, isImageFile, isPdfFile, saveFile, withExtension } from "../lib/files.js";
import { toEmbeddable } from "../lib/image-embed.js";
import { PageThumbnails, lib, loadWritable } from "../pdf/core.js";
import { ACTIONS, DocList } from "../ui/doclist.js";
import { confirmDiscard } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { wireIntake, wirePicker } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { confirmLarge, readPdfFile, reportFailure, reportSave, uid } from "./shared.js";

/** @typedef {{ id: string; kind: "pdf"; docId: string; pageIndex: number; rotation: number }} PdfPage */
/** @typedef {{ id: string; kind: "image"; file: File; url: string; rotation: number }} ImagePage */

/** @type {Map<string, { name: string; bytes: Uint8Array; thumbs: PageThumbnails; password: string }>} */
const sources = new Map();
/** @type {Array<PdfPage | ImagePage>} */
let pages = [];
/** @type {DocList | null} */
let list = null;
let anchorId = "";
let primaryName = "مستند";
let saved = true;
let acceptedKey = "";

function reset() {
  for (const source of sources.values()) source.thumbs.dispose();
  sources.clear();
  for (const page of pages) if (page.kind === "image") URL.revokeObjectURL(page.url);
  pages = [];
  anchorId = "";
  primaryName = "مستند";
  saved = true;
  acceptedKey = "";
  refresh();
}

async function requestReset() {
  if (!pages.length) return;
  if (!(await confirmDiscard(organizeTool.name))) return;
  reset();
}

function insertAt() {
  if (!anchorId) return pages.length;
  const index = pages.findIndex((page) => page.id === anchorId);
  return index < 0 ? pages.length : index + 1;
}

function refresh() {
  list?.render(
    pages.map((page) => {
      if (page.kind === "image") {
        return {
          id: page.id,
          name: page.file.name,
          meta: ["صورة مُدرجة", humanSize(page.file.size)],
          thumb: { kind: "lazy", load: async () => page.url },
          actions: [ACTIONS.grab, ACTIONS.up, ACTIONS.down, ACTIONS.rotate, ACTIONS.remove],
          rotation: page.rotation,
          selected: page.id === anchorId
        };
      }
      const source = sources.get(page.docId);
      return {
        id: page.id,
        name: `صفحة ${page.pageIndex + 1}`,
        meta: [source?.name ?? "", page.rotation ? `مُدارة ${page.rotation}°` : null],
        thumb: { kind: "lazy", load: () => source.thumbs.get(page.pageIndex + 1) },
        actions: [ACTIONS.grab, ACTIONS.up, ACTIONS.down, ACTIONS.rotate, ACTIONS.remove],
        rotation: page.rotation,
        selected: page.id === anchorId
      };
    })
  );

  const has = pages.length > 0;
  el("organize-panel").hidden = !has;
  el("organize-drop").hidden = has;

  const anchor = el("organize-anchor");
  if (anchor) {
    const index = pages.findIndex((page) => page.id === anchorId);
    anchor.textContent =
      index >= 0
        ? `الإدراج التالي سيكون بعد العنصر رقم ${index + 1}. اضغط عليه مرة أخرى لإلغاء التحديد.`
        : "الإدراج التالي سيكون في نهاية المستند. اختر صفحة ليُدرج بعدها مباشرة.";
  }

  const totalBytes = Array.from(sources.values()).reduce((sum, source) => sum + source.bytes.length, 0);
  setSource(has ? { label: primaryName, pages: String(pages.length), size: humanSize(totalBytes) } : {});
  setRunEnabled(has);
  setState(has ? "idle" : "waiting");
  if (has && !/\S/.test(el("tb-name").value)) setName(`${baseName(primaryName)}-مرتب.pdf`);
}

/** @param {File[]} files @param {boolean} isPrimary */
async function addPdfs(files, isPrimary) {
  startProgress({ title: "قراءة الصفحات", desc: "نفتح المستند ونحضّر المعاينات." });
  try {
    let at = isPrimary ? 0 : insertAt();
    for (const file of files) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ detail: file.name });
      const loaded = await readPdfFile(file);
      if (!loaded) continue;
      if (!(await confirmLarge(loaded.pages, "عرض كل الصفحات"))) continue;

      const thumbs = new PageThumbnails(loaded.bytes, loaded.password);
      const docId = uid("doc");
      sources.set(docId, { name: file.name, bytes: loaded.bytes, thumbs, password: loaded.password });
      if (isPrimary) primaryName = file.name;

      /** @type {PdfPage[]} */
      const fresh = [];
      for (let index = 0; index < loaded.pages; index += 1) {
        fresh.push({ id: uid("pg"), kind: "pdf", docId, pageIndex: index, rotation: 0 });
      }
      pages.splice(at, 0, ...fresh);
      at += fresh.length;
      saved = false;
      if (loaded.pages >= LARGE_DOCUMENT_PAGES) {
        toast("مستند كبير: المصغّرات تظهر أثناء التمرير حتى تبقى الواجهة سريعة.", "info");
      }
    }
    anchorId = "";
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
    refresh();
  }
}

/** @param {File[]} files */
function addImages(files) {
  const at = insertAt();
  /** @type {ImagePage[]} */
  const fresh = files.map((file) => ({
    id: uid("im"),
    kind: "image",
    file,
    url: URL.createObjectURL(file),
    rotation: 0
  }));
  pages.splice(at, 0, ...fresh);
  anchorId = "";
  saved = false;
  refresh();
}

async function acceptFiles(files) {
  if (!files?.length) {
    if (pages.length) reset();
    return;
  }
  const key = filesKey(files);
  if (key === acceptedKey && pages.length) return;
  reset();
  acceptedKey = key;
  const pdfs = files.filter(isPdfFile);
  const images = files.filter(isImageFile);
  if (pdfs.length) await addPdfs(pdfs, true);
  if (images.length) addImages(images);
}

async function run() {
  if (!pages.length) return;
  if (!(await confirmLarge(pages.length, "حفظ الترتيب"))) return;
  const { degrees } = lib();

  setState("busy");
  startProgress({ title: "بناء المستند", desc: "نرتّب الصفحات كما تظهر في القائمة." });
  try {
    const { PDFDocument } = lib();
    const target = await PDFDocument.create();
    /** @type {Map<string, any>} */
    const loaded = new Map();

    for (const [index, page] of pages.entries()) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: (index / pages.length) * 100, detail: `${index + 1} / ${pages.length}` });

      if (page.kind === "image") {
        const asset = await toEmbeddable(page.file);
        const embedded = asset.kind === "png" ? await target.embedPng(asset.bytes) : await target.embedJpg(asset.bytes);
        const created = target.addPage([embedded.width * 0.75, embedded.height * 0.75]);
        created.drawImage(embedded, { x: 0, y: 0, width: created.getWidth(), height: created.getHeight() });
        if (page.rotation) created.setRotation(degrees(page.rotation % 360));
        continue;
      }

      let source = loaded.get(page.docId);
      if (!source) {
        source = await loadWritable(sources.get(page.docId).bytes);
        loaded.set(page.docId, source);
      }
      const [copied] = await target.copyPages(source, [page.pageIndex]);
      const existing = copied.getRotation().angle || 0;
      copied.setRotation(degrees((existing + page.rotation) % 360));
      target.addPage(copied);
    }

    throwIfCancelled();
    updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, `تم حفظ المستند بـ ${pages.length} صفحة.`);
  } catch (error) {
    reportFailure(error, "تعذّر بناء المستند.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const organizeTool = {
  id: "organize",
  name: "ترتيب",
  icon: "icon-organize",
  input: "PDF",
  actionLabel: "حفظ",

  setup() {
    list = new DocList("organize-list", {
      selectable: true,
      emptyText: "لا صفحات.",
      onAction(action, id) {
        const index = pages.findIndex((page) => page.id === id);
        if (index < 0) return;
        if (action === "select") {
          anchorId = anchorId === id ? "" : id;
        } else if (action === "remove") {
          if (pages.length === 1) {
            toast("لا يمكن حذف آخر صفحة.", "info");
            return;
          }
          const [removed] = pages.splice(index, 1);
          if (removed.kind === "image") URL.revokeObjectURL(removed.url);
          if (anchorId === id) anchorId = "";
        } else if (action === "rotate") {
          pages[index].rotation = (pages[index].rotation + 90) % 360;
        } else if (action === "up" && index > 0) {
          pages.splice(index - 1, 0, pages.splice(index, 1)[0]);
        } else if (action === "down" && index < pages.length - 1) {
          pages.splice(index + 1, 0, pages.splice(index, 1)[0]);
        }
        saved = false;
        refresh();
      },
      onReorder(ids) {
        pages = ids.map((id) => pages.find((page) => page.id === id)).filter(Boolean);
        saved = false;
        refresh();
      }
    });

    wireIntake({
      dropId: "organize-drop",
      inputId: "organize-input",
      browseId: "organize-browse",
      accept: "pdf",
      onFiles: (files) => addPdfs(files.slice(0, 1), true)
    });
    wirePicker("organize-add-pdf-input", "organize-add-pdf", (files) => addPdfs(files, false));
    wirePicker("organize-add-img-input", "organize-add-img", addImages);
    el("organize-clear")?.addEventListener("click", requestReset);
  },

  enter: refresh,
  isDirty: () => pages.length > 0 && !saved,
  acceptFiles,
  run
};
