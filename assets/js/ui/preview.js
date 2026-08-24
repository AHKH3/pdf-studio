import { el } from "../dom.js";
import { isImageFile } from "../lib/files.js";
import { openDocument } from "../pdf/core.js";
import { captureFiles } from "./capture.js";

/**
 * نافذة معاينة الملف العائمة:
 * - صورة: تُعرض مباشرة مع تكبير/تصغير.
 * - PDF: عارض صفحات مع مصغّرات جانبية سريعة وتقليب.
 * - شريط جانبي بكل الملفات المرفوعة للتنقل بينها دون إغلاق النافذة.
 */

const urls = new Map();
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

function urlFor(file) {
  let url = urls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urls.set(file, url);
  }
  return url;
}

let current = null;
/** @type {{ bytes: Uint8Array; pages: number; doc: any } | null} */
let pdf = null;
let pageNumber = 1;
let rendering = false;
let renderToken = 0;
let zoom = 1;
/** @type {{ w: number; h: number } | null} */
let fitSize = null;
/** @type {Array<{ page: number; url: string }>} */
let pageThumbs = [];
let pageThumbToken = 0;

function modal() {
  return el("file-preview");
}

function stage() {
  return el("fp-stage");
}

function mediaEl() {
  const img = /** @type {HTMLImageElement} */ (el("file-preview-img"));
  if (img && !img.hidden) return img;
  return /** @type {HTMLCanvasElement} */ (el("file-preview-canvas"));
}

function setLoading(on) {
  const node = stage();
  const loading = el("file-preview-loading");
  if (node) node.classList.toggle("is-ready", !on);
  if (loading) loading.hidden = !on;
}

/* ---------------- تكبير / تصغير ---------------- */

function applyZoom() {
  const media = mediaEl();
  if (!media || !fitSize) return;
  media.style.width = `${Math.round(fitSize.w * zoom)}px`;
  media.style.height = `${Math.round(fitSize.h * zoom)}px`;
  const pct = /** @type {HTMLElement} */ (el("file-preview-zoom-fit"));
  if (pct) pct.textContent = `${Math.round(zoom * 100)}%`;
}

function setZoom(next) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  applyZoom();
}

function computeFit(naturalW, naturalH) {
  const node = stage();
  if (!node) return { w: naturalW, h: naturalH };
  const availW = Math.max(160, node.clientWidth - 48);
  const availH = Math.max(160, node.clientHeight - 48);
  const scale = Math.min(availW / naturalW, availH / naturalH, 1);
  return { w: naturalW * scale, h: naturalH * scale };
}

function resetZoom() {
  zoom = 1;
  applyZoom();
}

/* ---------------- PDF: عرض الصفحة ---------------- */

async function renderPdfPage() {
  if (!pdf?.doc) return;
  const token = ++renderToken;
  rendering = true;
  const canvas = /** @type {HTMLCanvasElement} */ (el("file-preview-canvas"));
  const img = /** @type {HTMLImageElement} */ (el("file-preview-img"));
  if (!canvas) return;
  try {
    setLoading(true);
    const page = await pdf.doc.getPage(pageNumber);
    if (token !== renderToken) return;
    const viewport = page.getViewport({ scale: 1 });
    fitSize = computeFit(viewport.width, viewport.height);
    const renderScale = Math.min((fitSize.w * 2) / viewport.width, 2);
    const scaled = page.getViewport({ scale: renderScale });
    canvas.width = Math.max(1, Math.round(scaled.width));
    canvas.height = Math.max(1, Math.round(scaled.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    if (token !== renderToken) return;
    canvas.hidden = false;
    if (img) img.hidden = true;
    setLoading(false);
    resetZoom();
    const count = el("file-preview-count");
    if (count) count.textContent = `${pageNumber} / ${pdf.pages}`;
    markActiveThumb();
  } catch {
    setLoading(false);
  } finally {
    rendering = false;
  }
}

function markActiveThumb() {
  const host = el("fp-pages");
  if (!host) return;
  for (const node of host.children) {
    if (node instanceof HTMLElement) {
      node.classList.toggle("is-active", Number(node.dataset.page) === pageNumber);
    }
  }
}

/* ---------------- PDF: مصغّرات الصفحات ---------------- */

function buildPageSkeleton(total) {
  const host = el("fp-pages");
  if (!host) return;
  host.replaceChildren();
  for (let n = 1; n <= total; n += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preview-modal__thumb is-empty";
    btn.dataset.page = String(n);
    btn.setAttribute("role", "listitem");
    btn.setAttribute("aria-label", `الصفحة ${n}`);
    const holder = document.createElement("span");
    holder.className = "preview-modal__thumb-img";
    holder.textContent = "…";
    const label = document.createElement("span");
    label.className = "preview-modal__thumb-label num";
    label.textContent = String(n);
    btn.append(holder, label);
    btn.addEventListener("click", () => {
      if (n === pageNumber) return;
      pageNumber = n;
      void renderPdfPage();
    });
    host.append(btn);
  }
}

async function renderPageThumbs() {
  if (!pdf?.doc) return;
  const token = ++pageThumbToken;
  const host = el("fp-pages");
  if (!host) return;
  for (let n = 1; n <= pdf.pages; n += 1) {
    if (token !== pageThumbToken) return;
    try {
      const page = await pdf.doc.getPage(n);
      if (token !== pageThumbToken) return;
      const base = page.getViewport({ scale: 1 });
      const scale = 96 / Math.max(base.width, base.height);
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(scaled.width));
      canvas.height = Math.max(1, Math.round(scaled.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      page.cleanup();
      if (token !== pageThumbToken) return;
      const btn = host.querySelector(`[data-page="${n}"]`);
      const holder = btn?.querySelector(".preview-modal__thumb-img");
      if (holder) {
        holder.replaceChildren(canvas);
        btn?.classList.remove("is-empty");
      }
    } catch {
      /* صفحة فاشلة — نتركها فارغة */
    }
  }
}

/* ---------------- شريط الملفات للتنقل ---------------- */

function svgIcon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function buildFilesList() {
  const section = el("fp-files-section");
  const host = el("fp-files");
  if (!section || !host) return;
  const files = captureFiles();
  section.hidden = files.length < 2;
  if (files.length < 2) {
    host.replaceChildren();
    return;
  }
  host.replaceChildren();
  for (const file of files) {
    const isImg = isImageFile(file);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "preview-modal__file";
    row.dataset.active = file === current ? "true" : "false";
    row.setAttribute("role", "listitem");
    const thumb = document.createElement("span");
    thumb.className = "preview-modal__file-thumb";
    if (isImg) {
      const img = document.createElement("img");
      img.src = urlFor(file);
      img.alt = "";
      thumb.append(img);
    } else {
      thumb.append(svgIcon("icon-file"));
    }
    const name = document.createElement("span");
    name.className = "preview-modal__file-name";
    name.textContent = file.name;
    name.title = file.name;
    row.append(thumb, name);
    row.addEventListener("click", () => {
      if (file === current) return;
      void switchFile(file);
    });
    host.append(row);
  }
}

function markActiveFile() {
  const host = el("fp-files");
  if (!host) return;
  for (const node of host.children) {
    if (node instanceof HTMLElement) {
      node.dataset.active = node.querySelector(".preview-modal__file-name")?.textContent === current?.name ? "true" : "false";
    }
  }
}

/* ---------------- فتح / تبديل / إغلاق ---------------- */

function showImage(file) {
  const img = /** @type {HTMLImageElement} */ (el("file-preview-img"));
  const canvas = /** @type {HTMLCanvasElement} */ (el("file-preview-canvas"));
  if (!img) return;
  const apply = () => {
    fitSize = computeFit(img.naturalWidth || 1, img.naturalHeight || 1);
    resetZoom();
    setLoading(false);
  };
  img.onload = apply;
  img.src = urlFor(file);
  img.hidden = false;
  if (canvas) canvas.hidden = true;
  const pager = el("file-preview-pager");
  if (pager) pager.hidden = true;
  const pagesSection = el("fp-pages-section");
  if (pagesSection) pagesSection.hidden = true;
  const zoombar = el("file-preview-zoombar");
  if (zoombar) zoombar.hidden = false;
  buildFilesList();
  markActiveFile();
}

async function showPdf(file) {
  const pager = el("file-preview-pager");
  if (pager) pager.hidden = false;
  const zoombar = el("file-preview-zoombar");
  if (zoombar) zoombar.hidden = false;
  const pagesSection = el("fp-pages-section");
  if (pagesSection) pagesSection.hidden = false;
  const count = el("file-preview-count");
  if (count) count.textContent = "…";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openDocument(bytes, "");
    pdf = { bytes, pages: doc.numPages, doc };
    pageNumber = 1;
    buildPageSkeleton(pdf.pages);
    buildFilesList();
    markActiveFile();
    await renderPdfPage();
    void renderPageThumbs();
  } catch {
    setLoading(false);
    if (count) count.textContent = "—";
  }
}

async function switchFile(file) {
  current = file;
  pdf = null;
  pageNumber = 1;
  pageThumbToken += 1;
  renderToken += 1;
  const title = el("file-preview-title");
  if (title) title.textContent = file.name;
  const img = /** @type {HTMLImageElement} */ (el("file-preview-img"));
  const canvas = /** @type {HTMLCanvasElement} */ (el("file-preview-canvas"));
  if (img) img.hidden = true;
  if (canvas) canvas.hidden = true;
  setLoading(true);
  if (isImageFile(file)) showImage(file);
  else await showPdf(file);
}

export async function openPreview(file) {
  if (!file) return;
  const node = modal();
  if (!node) return;
  node.hidden = false;
  await switchFile(file);
}

export function closePreview() {
  const node = modal();
  if (node) node.hidden = true;
  current = null;
  pageThumbToken += 1;
  renderToken += 1;
  if (pdf?.doc?.destroy) pdf.doc.destroy().catch(() => {});
  pdf = null;
}

export function initFilePreview() {
  const node = modal();
  if (!node) return;

  node.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest("[data-preview-close]") || target.closest("#file-preview-close")) {
      closePreview();
    }
  });

  el("file-preview-prev")?.addEventListener("click", () => {
    if (!pdf || rendering) return;
    if (pageNumber > 1) {
      pageNumber -= 1;
      void renderPdfPage();
    }
  });

  el("file-preview-next")?.addEventListener("click", () => {
    if (!pdf || rendering) return;
    if (pageNumber < pdf.pages) {
      pageNumber += 1;
      void renderPdfPage();
    }
  });

  el("file-preview-zoom-in")?.addEventListener("click", () => setZoom(zoom * ZOOM_STEP));
  el("file-preview-zoom-out")?.addEventListener("click", () => setZoom(zoom / ZOOM_STEP));
  el("file-preview-zoom-fit")?.addEventListener("click", () => {
    if (fitSize) {
      zoom = 1;
      applyZoom();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!node || node.hidden) return;
    if (event.key === "Escape") closePreview();
    if (event.key === "+" || event.key === "=") setZoom(zoom * ZOOM_STEP);
    if (event.key === "-" || event.key === "_") setZoom(zoom / ZOOM_STEP);
    if (event.key === "0") {
      zoom = 1;
      applyZoom();
    }
    if (!pdf || rendering) return;
    if (event.key === "ArrowLeft" && pageNumber < pdf.pages) {
      // RTL: يسار = الصفحة التالية
      pageNumber += 1;
      void renderPdfPage();
    }
    if (event.key === "ArrowRight" && pageNumber > 1) {
      pageNumber -= 1;
      void renderPdfPage();
    }
  });
}
