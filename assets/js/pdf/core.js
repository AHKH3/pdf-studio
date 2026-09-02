import { PDFJS_WORKER_SRC, THUMB_CACHE_LIMIT, THUMB_MAX_PX } from "../config.js";
import { encryptedError } from "../lib/errors.js";
import { yieldToUi } from "../dom.js";

/** @type {any} */
let pdfjs = null;
/** @type {any} */
let pdfLib = null;

export function initPdfEngines() {
  pdfLib = /** @type {any} */ (window).PDFLib;
  pdfjs = /** @type {any} */ (window)["pdfjs-dist/build/pdf"] || /** @type {any} */ (window).pdfjsLib;
  if (!pdfLib || !pdfjs) throw new Error("PDF engines missing");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
}

export function lib() {
  return pdfLib;
}

/**
 * pdf-lib cannot decrypt a user-password file. Owner-restricted files often
 * still load with ignoreEncryption; anything else is reported as EncryptedPdfError.
 * @param {Uint8Array} bytes
 */
export async function loadWritable(bytes) {
  try {
    return await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (error) {
    const message = String(error?.message || "");
    if (/encrypted/i.test(message)) throw encryptedError();
    throw error;
  }
}

/**
 * pdf.js detaches the buffer it is handed, so every reader gets its own copy
 * and the caller keeps the canonical bytes for pdf-lib.
 * @param {Uint8Array} bytes
 * @param {string} [password]
 */
export function openDocument(bytes, password = "") {
  return pdfjs.getDocument({
    data: bytes.slice(),
    password: password || "",
    isEvalSupported: false
  }).promise;
}

/**
 * 2D context for pdf.js page.render. The app is `dir="rtl"`; if a canvas
 * inherits that, fillText glyph advances collapse and Latin (and other)
 * text looks shredded while paths/images stay fine (AHK-41 / pdf.js#11457).
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2DSettings} [options]
 */
export function pdfRenderContext(canvas, options = { alpha: false }) {
  canvas.dir = "ltr";
  const ctx = canvas.getContext("2d", options);
  if (ctx) ctx.direction = "ltr";
  return ctx;
}

/** @param {Uint8Array} bytes @param {string} [password] */
export async function countPages(bytes, password = "") {
  const doc = await openDocument(bytes, password);
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}

/**
 * Page count plus a cover thumbnail in a single open/close, so a merge list of
 * twenty files does not keep twenty pdf.js documents alive.
 * @param {Uint8Array} bytes
 * @param {string} [password]
 */
export async function probeDocument(bytes, password = "") {
  const doc = await openDocument(bytes, password);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_MAX_PX / Math.max(base.width, base.height);
    const blob = await renderPageToBlob(page, scale, "image/jpeg", 0.72);
    page.cleanup();
    return { pages: doc.numPages, thumbUrl: URL.createObjectURL(blob) };
  } finally {
    await doc.destroy();
  }
}

/**
 * @param {any} page
 * @param {number} scale
 * @param {"image/png" | "image/jpeg"} [mime]
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
export async function renderPageToBlob(page, scale, mime = "image/png", quality) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = pdfRenderContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/**
 * Render a single page from PDF bytes to a canvas with scale and rotation.
 * @param {Uint8Array} bytes
 * @param {number} pageIndex 0-based
 * @param {{ scale?: number; rotation?: number }} [options]
 */
export async function renderPdfPage(bytes, pageIndex, options = {}) {
  const doc = await openDocument(bytes);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const scale = options.scale || 1;
    const rotation = options.rotation || 0;
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = pdfRenderContext(canvas);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return {
      canvas,
      width: viewport.width,
      height: viewport.height
    };
  } finally {
    await doc.destroy();
  }
}


/**
 * @param {any} page
 * @param {number} dpi
 * @param {boolean} grayscale
 * @param {number} quality
 */
export async function renderPageAtDpi(page, dpi, grayscale, quality) {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = pdfRenderContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  if (grayscale) {
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      data[i] = luma;
      data[i + 1] = luma;
      data[i + 2] = luma;
    }
    ctx.putImageData(frame, 0, 0);
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  const result = {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: viewport.width,
    height: viewport.height
  };
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

/**
 * Renders page previews on demand and keeps only the most recent ones alive.
 * A 600-page document therefore costs a few dozen small JPEGs, not 600.
 */
export class PageThumbnails {
  /** @param {Uint8Array} bytes @param {string} [password] */
  constructor(bytes, password = "") {
    this.bytes = bytes;
    this.password = password || "";
    /** @type {Map<number, string>} */
    this.cache = new Map();
    /** @type {Map<number, Promise<string>>} */
    this.pending = new Map();
    /** @type {Promise<any> | null} */
    this.docPromise = null;
    this.queue = Promise.resolve();
    this.disposed = false;
  }

  async document() {
    if (!this.docPromise) this.docPromise = openDocument(this.bytes, this.password);
    return this.docPromise;
  }

  /**
   * @param {number} pageNumber 1-based
   * @returns {Promise<string>} an object URL valid until it is evicted
   */
  get(pageNumber) {
    const hit = this.cache.get(pageNumber);
    if (hit) {
      this.cache.delete(pageNumber);
      this.cache.set(pageNumber, hit);
      return Promise.resolve(hit);
    }
    const inFlight = this.pending.get(pageNumber);
    if (inFlight) return inFlight;

    // One page at a time: parallel renders on the main thread cause the freeze
    // this replaces. A UI yield between renders keeps fast scrolling from
    // stacking a render backlog that blocks the main thread.
    const task = this.queue.then(async () => {
      if (this.disposed) return "";
      await yieldToUi();
      if (this.disposed) return "";
      const doc = await this.document();
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = THUMB_MAX_PX / Math.max(base.width, base.height);
      const blob = await renderPageToBlob(page, scale, "image/jpeg", 0.72);
      page.cleanup();
      if (this.disposed) return "";
      const url = URL.createObjectURL(blob);
      this.cache.set(pageNumber, url);
      this.evict();
      return url;
    });

    this.queue = task.catch(() => {});
    const guarded = task.finally(() => this.pending.delete(pageNumber));
    this.pending.set(pageNumber, guarded);
    return guarded;
  }

  evict() {
    while (this.cache.size > THUMB_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      const url = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (url) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }, 30000);
      }
    }
  }

  async dispose() {
    this.disposed = true;
    for (const url of this.cache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this.cache.clear();
    this.pending.clear();
    if (this.docPromise) {
      const doc = await this.docPromise.catch(() => null);
      await doc?.destroy?.().catch?.(() => {});
      this.docPromise = null;
    }
  }
}

/** @param {string} hex */
export function hexToRgb(hex) {
  const raw = String(hex || "#000000").replace("#", "");
  const value = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const channel = (start) => Number.parseInt(value.slice(start, start + 2), 16) / 255;
  return pdfLib.rgb(channel(0), channel(2), channel(4));
}

/**
 * pdf-lib's standard fonts have no Arabic coverage, so Arabic overlays are
 * drawn as an image of correctly shaped text instead.
 * @param {string} text
 * @param {{ size: number; color: string; angle: number; opacity: number }} style
 */
export async function textToPng(text, style) {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});

  const scale = 3;
  const fontSize = Math.max(16, style.size * scale);
  const font = `600 ${fontSize}px "Noto Naskh Arabic", "Amiri", "Playfair Display", serif`;

  const gauge = document.createElement("canvas").getContext("2d");
  gauge.font = font;
  const width = Math.ceil(gauge.measureText(text).width);

  const radians = (style.angle * Math.PI) / 180;
  const boxW = width + fontSize;
  const boxH = fontSize * 1.9;
  const rotatedW = Math.ceil(Math.abs(boxW * Math.cos(radians)) + Math.abs(boxH * Math.sin(radians)));
  const rotatedH = Math.ceil(Math.abs(boxW * Math.sin(radians)) + Math.abs(boxH * Math.cos(radians)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, rotatedW);
  canvas.height = Math.max(1, rotatedH);
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = style.color;
  ctx.globalAlpha = style.opacity;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(radians);
  ctx.fillText(text, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;
  return bytes;
}
