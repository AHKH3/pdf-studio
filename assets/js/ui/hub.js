import { el, qsa } from "../dom.js";
import { humanSize, isImageFile } from "../lib/files.js";
import { suggestImageOrder } from "../lib/image-order.js";
import { probeDocument } from "../pdf/core.js";
import { confirmDiscard } from "./dialog.js";
import { toast } from "./feedback.js";
import { openPreview } from "./preview.js";
import { route } from "./router.js";
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

/** @type {Map<File, string>} */
const urls = new Map();
/** @type {Map<string, string>} */
const pdfCovers = new Map();
/** @type {Map<string, number>} */
const pdfPageCounts = new Map();
/** @type {any} */
let sortable = null;

function previewUrl(file) {
  if (!isImageFile(file)) return "";
  let url = urls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urls.set(file, url);
  }
  return url;
}

function coverKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function dropUnusedUrls(files) {
  const keep = new Set(files);
  for (const [file, url] of urls) {
    if (keep.has(file)) continue;
    URL.revokeObjectURL(url);
    urls.delete(file);
  }
}

function svgIcon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** بطاقة ملف: الصورة تغمر البطاقة + تدرج سفلي للاسم + أزرار عائمة عند التحويم. */
function buildCard(file, index) {
  const card = document.createElement("div");
  card.className = "hub-card";
  card.dataset.id = String(index);
  card.setAttribute("role", "listitem");

  const isImg = isImageFile(file);
  const cachedCover = isImg ? previewUrl(file) : pdfCovers.get(coverKey(file));

  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "hub-card__thumb" + (cachedCover ? "" : " is-loading");
  thumb.title = "اضغط لمعاينة الملف";
  thumb.setAttribute("aria-label", `معاينة ${file.name}`);

  if (cachedCover) {
    const img = document.createElement("img");
    img.src = cachedCover;
    img.alt = "";
    thumb.append(img);
  } else {
    thumb.append(svgIcon(isImg ? "icon-images" : "icon-file"));
  }

  const badge = document.createElement("span");
  badge.className = "hub-card__badge";
  badge.textContent = isImg ? "صورة" : "PDF";
  card.append(badge);

  const zoom = document.createElement("span");
  zoom.className = "hub-card__zoom";
  zoom.setAttribute("aria-hidden", "true");
  zoom.append(svgIcon("icon-expand"));
  card.append(zoom);

  const overlay = document.createElement("div");
  overlay.className = "hub-card__overlay";
  const name = document.createElement("div");
  name.className = "hub-card__name";
  name.textContent = file.name;
  name.title = file.name;
  const meta = document.createElement("div");
  meta.className = "hub-card__meta";
  const size = document.createElement("span");
  size.className = "num";
  size.textContent = humanSize(file.size);
  meta.append(size);
  const pages = pdfPageCounts.get(coverKey(file));
  if (!isImg && pages) {
    const pagesSpan = document.createElement("span");
    pagesSpan.className = "num";
    pagesSpan.textContent = `${pages} صفحة`;
    meta.append(pagesSpan);
  }
  overlay.append(name, meta);
  card.append(overlay);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "hub-card__remove";
  remove.setAttribute("aria-label", `حذف ${file.name}`);
  remove.dataset.action = "remove";
  remove.dataset.id = String(index);
  remove.append(svgIcon("icon-trash"));
  card.append(remove);

  card.append(thumb);

  const open = () => void openPreview(file);
  thumb.addEventListener("click", open);
  thumb.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  // غلاف PDF: نولّده مرة واحدة لكل ملف
  if (!isImg && !cachedCover) {
    const key = coverKey(file);
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const probe = await probeDocument(bytes);
        pdfCovers.set(key, probe.thumbUrl);
        pdfPageCounts.set(key, probe.pages);
        if (card.isConnected) {
          const img = document.createElement("img");
          img.src = probe.thumbUrl;
          img.alt = "";
          thumb.querySelector("img")?.remove();
          thumb.querySelector(".icon")?.remove();
          thumb.prepend(img);
          thumb.classList.remove("is-loading");
          if (!meta.querySelector("[data-pages]")) {
            const p = document.createElement("span");
            p.className = "num";
            p.dataset.pages = "1";
            p.textContent = `${probe.pages} صفحة`;
            meta.append(p);
          }
        }
      } catch {
        thumb.classList.remove("is-loading");
      }
    })();
  }

  return card;
}

function syncSortable() {
  const host = el("hub-list");
  if (!host) return;
  const Sortable = /** @type {any} */ (window).Sortable;
  if (!Sortable) return;
  const files = captureFiles();
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!sortable) {
    sortable = new Sortable(host, {
      animation: reduce ? 0 : 150,
      draggable: ".hub-card",
      direction: "horizontal",
      ghostClass: "is-ghost",
      chosenClass: "is-chosen",
      forceFallback: true,
      fallbackOnBody: true,
      scroll: true,
      onEnd: () => {
        const ids = Array.from(host.querySelectorAll(".hub-card")).map(
          (card) => /** @type {HTMLElement} */ (card).dataset.id
        );
        const filesNow = captureFiles();
        const ordered = ids.map((id) => filesNow[Number(id)]).filter(Boolean);
        if (ordered.length === filesNow.length && ordered.length) reorderCapture(ordered);
      }
    });
  }
  sortable.option("disabled", files.length < 2);
}

function render() {
  const files = captureFiles();
  const { images } = captureMix();
  dropUnusedUrls(files);

  const has = files.length > 0;
  const dashboard = el("hub-drop");
  const panel = el("hub-panel");
  if (dashboard) dashboard.hidden = has;
  if (panel) panel.hidden = !has;

  const title = el("start-title");
  if (title) title.textContent = has ? mixLabel() : "أسقط الملفات";

  const mix = el("hub-mix");
  if (mix) mix.textContent = has ? mixLabel() : "الملفات";

  const count = el("hub-count");
  if (count) {
    if (has) {
      count.textContent = `${files.length} ملف`;
    } else {
      count.textContent = "";
    }
  }

  const sort = el("hub-sort");
  if (sort) sort.hidden = images.length < 2;

  const host = el("hub-list");
  if (host) {
    const keep = new Map();
    for (const node of Array.from(host.children)) {
      if (node instanceof HTMLElement && node.dataset.id !== undefined) {
        keep.set(node.dataset.id, node);
      }
    }
    host.replaceChildren();
    files.forEach((file, index) => {
      const id = String(index);
      const existing = keep.get(id);
      // نعيد بناء البطاقة دائماً — الفهارس تتغير مع كل تعديل
      host.append(buildCard(file, index));
    });
  }
  syncSortable();

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

const DEFAULT_RECENTS = [
  { name: "عقد_إيجار_2026.pdf", size: "1.8 MB", time: "منذ 15 دقيقة", tone: "rose" },
  { name: "تقرير_الربع_الأول.docx", size: "4.2 MB", time: "اليوم، 10:30 ص", tone: "blue" },
  { name: "ميزانية_المشروع.xlsx", size: "3.1 MB", time: "أمس، 04:15 م", tone: "emerald" }
];

function getStoredRecents() {
  try {
    const raw = localStorage.getItem("pdf_studio_recents");
    if (!raw) return DEFAULT_RECENTS;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : DEFAULT_RECENTS;
  } catch {
    return DEFAULT_RECENTS;
  }
}

function saveRecents(list) {
  try {
    localStorage.setItem("pdf_studio_recents", JSON.stringify(list));
  } catch {}
}

export function recordRecentFile(file) {
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isDoc = /\.(doc|docx|txt|rtf)$/i.test(file.name);
  const tone = isPdf ? "rose" : isDoc ? "blue" : "emerald";
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const item = {
    name: file.name,
    size: humanSize(file.size),
    time: `اليوم، ${timeStr}`,
    tone
  };
  const current = getStoredRecents().filter((r) => r.name !== file.name);
  current.unshift(item);
  saveRecents(current.slice(0, 6));
  renderRecentFiles();
}

function renderRecentFiles() {
  const grid = el("recents-grid");
  const badge = el("recents-count-badge");
  if (!grid) return;
  const list = getStoredRecents();
  if (badge) badge.textContent = `${list.length} ملفات`;

  grid.replaceChildren();
  for (const item of list.slice(0, 3)) {
    const card = document.createElement("div");
    card.className = "recent-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.file = item.name;

    const iconWrap = document.createElement("div");
    iconWrap.className = `recent-card__icon recent-card__icon--${item.tone || "rose"}`;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-file");
    icon.append(use);
    iconWrap.append(icon);

    const info = document.createElement("div");
    info.className = "recent-card__info";
    const nameSpan = document.createElement("span");
    nameSpan.className = "recent-card__name";
    nameSpan.textContent = item.name;
    nameSpan.title = item.name;

    const metaDiv = document.createElement("div");
    metaDiv.className = "recent-card__meta";
    const sizeSpan = document.createElement("span");
    sizeSpan.className = "num";
    sizeSpan.textContent = item.size || "";
    const sepSpan = document.createElement("span");
    sepSpan.className = "sep";
    sepSpan.textContent = "•";
    const timeSpan = document.createElement("span");
    timeSpan.textContent = item.time || "";
    metaDiv.append(sizeSpan, sepSpan, timeSpan);
    info.append(nameSpan, metaDiv);

    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("class", "icon recent-card__arrow");
    arrow.setAttribute("aria-hidden", "true");
    const arrowUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    arrowUse.setAttribute("href", "#icon-arrow");
    arrow.append(arrowUse);

    card.append(iconWrap, info, arrow);

    card.addEventListener("click", () => {
      if (item.name.toLowerCase().endsWith(".pdf")) {
        void route("organize");
      } else {
        void route("images");
      }
      toast(`تم الانتقال لمساحة العمل: ${item.name}`, "info");
    });

    grid.append(card);
  }
}

let dashboardInitialized = false;
function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  // 1. ربط بطاقات الأدوات وبطاقات الأكثر استخداماً بالموجّه
  const cards = qsa(".tool-card-h, .featured-card");
  for (const card of cards) {
    card.addEventListener("click", () => {
      const toolId = card.getAttribute("data-tool") || card.getAttribute("data-route");
      if (toolId) void route(toolId);
    });
  }

  // 2. ربط رف الملفات الأخيرة
  renderRecentFiles();
  el("recents-clear-btn")?.addEventListener("click", () => {
    saveRecents([]);
    renderRecentFiles();
    toast("تم تفريغ سجل الملفات الأخيرة.", "info");
  });

  // 3. السحب والإفلات
  const dashboard = el("hub-drop");
  const input = /** @type {HTMLInputElement | null} */ (el("hub-input"));

  if (dashboard && input) {
    let depth = 0;
    dashboard.addEventListener("dragenter", (e) => {
      e.preventDefault();
      depth++;
      dashboard.classList.add("is-dragover");
    });
    dashboard.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    dashboard.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) dashboard.classList.remove("is-dragover");
    });
    dashboard.addEventListener("drop", async (e) => {
      e.preventDefault();
      depth = 0;
      dashboard.classList.remove("is-dragover");
      const dropped = Array.from(e.dataTransfer?.files || []);
      if (dropped.length) {
        for (const file of dropped) recordRecentFile(file);
        addCapture(dropped);
      }
    });

    input.addEventListener("change", () => {
      const selected = Array.from(input.files || []);
      if (selected.length) {
        for (const file of selected) recordRecentFile(file);
        addCapture(selected);
      }
      input.value = "";
    });
  }
}

export function initHub() {
  const host = el("hub-list");
  host?.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-action='remove']");
    if (!(button instanceof HTMLElement)) return;
    removeCapture(Number(button.dataset.id));
  });

  initDashboard();

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
