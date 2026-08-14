import { el } from "../dom.js";
import { humanSize, isImageFile } from "../lib/files.js";
import { suggestImageOrder } from "../lib/image-order.js";
import { confirmDiscard } from "./dialog.js";
import { ACTIONS, DocList } from "./doclist.js";
import { toast } from "./feedback.js";
import { wireIntake } from "./intake.js";
import { setSource, setState } from "./titleblock.js";
import {
  addCapture,
  captureFiles,
  captureMix,
  clearCapture,
  mixLabel,
  onCaptureChange,
  removeCapture,
  reorderCapture,
  setCapture
} from "./capture.js";

/** @type {DocList | null} */
let list = null;
/** @type {Map<File, string>} */
const urls = new Map();

function previewUrl(file) {
  if (!isImageFile(file)) return "";
  let url = urls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urls.set(file, url);
  }
  return url;
}

function dropUnusedUrls(files) {
  const keep = new Set(files);
  for (const [file, url] of urls) {
    if (keep.has(file)) continue;
    URL.revokeObjectURL(url);
    urls.delete(file);
  }
}

function render() {
  const files = captureFiles();
  const { images } = captureMix();
  dropUnusedUrls(files);

  const has = files.length > 0;
  const drop = el("hub-drop");
  const panel = el("hub-panel");
  if (drop) drop.hidden = has;
  if (panel) panel.hidden = !has;

  const title = el("start-title");
  if (title) title.textContent = has ? mixLabel() : "أسقط الملفات";

  const mix = el("hub-mix");
  if (mix) mix.textContent = has ? mixLabel() : "الملفات";

  const sort = el("hub-sort");
  if (sort) sort.hidden = images.length < 2;

  list?.render(
    files.map((file, index) => ({
      id: String(index),
      name: file.name,
      meta: [isImageFile(file) ? "صورة" : "PDF", humanSize(file.size)],
      thumb: isImageFile(file)
        ? { kind: "url", url: previewUrl(file) }
        : { kind: "icon", icon: "icon-file" },
      actions: [ACTIONS.remove]
    }))
  );

  if (has) {
    setSource({
      label: mixLabel(),
      pages: String(files.length),
      size: humanSize(files.reduce((sum, file) => sum + file.size, 0))
    });
    setState("idle");
  } else {
    setSource({});
    setState("waiting");
  }
}

async function requestClear() {
  if (!captureFiles().length) return;
  if (!(await confirmDiscard("الملفات"))) return;
  clearCapture();
}

async function suggestOrder() {
  const files = captureFiles();
  const images = files.filter(isImageFile);
  if (images.length < 2) return;
  const result = await suggestImageOrder(images, { visual: true });
  let i = 0;
  const next = files.map((file) => (isImageFile(file) ? result.files[i++] : file));
  reorderCapture(next);
  const note =
    result.method === "name"
      ? "رُتّبت حسب أرقام الاسم."
      : result.method === "time"
        ? "رُتّبت حسب وقت التصوير."
        : result.method === "visual"
          ? "رُتّبت بتشابه خفيف بين الصور."
          : "لم يتغيّر الترتيب.";
  toast(note, "info");
}

export function initHub() {
  list = new DocList("hub-list", {
    emptyText: "لا ملفات بعد.",
    onAction(action, id) {
      if (action === "remove") removeCapture(Number(id));
    }
  });

  wireIntake({
    dropId: "hub-drop",
    inputId: "hub-input",
    browseId: "hub-browse",
    accept: "any",
    onFiles: addCapture
  });

  el("hub-add")?.addEventListener("click", () => el("hub-input")?.click());
  el("hub-clear")?.addEventListener("click", () => void requestClear());
  el("hub-sort")?.addEventListener("click", () => void suggestOrder());

  onCaptureChange(render);
  render();
}

export function enterHub() {
  render();
}

export { setCapture };
