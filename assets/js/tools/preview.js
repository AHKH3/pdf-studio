import { el } from "../dom.js";
import { openDocument } from "../pdf/core.js";

/**
 * Renders page one once and keeps it as a bitmap, so dragging a slider only
 * repaints the overlay instead of re-rasterising the page.
 */
export class PagePreview {
  /** @param {string} canvasId */
  constructor(canvasId) {
    this.canvas = /** @type {HTMLCanvasElement} */ (el(canvasId));
    /** @type {HTMLCanvasElement | null} */
    this.page = null;
    this.pageWidth = 0;
    this.pageHeight = 0;
  }

  /** @param {Uint8Array} bytes @param {string} [password] @param {number} [pageNumber] */
  async load(bytes, password = "", pageNumber = 1) {
    const doc = await openDocument(bytes, password);
    try {
      const page = await doc.getPage(Math.max(1, pageNumber));
      const base = page.getViewport({ scale: 1 });
      this.pageWidth = base.width;
      this.pageHeight = base.height;

      const maxEdge = 520;
      const scale = maxEdge / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const buffer = document.createElement("canvas");
      buffer.width = Math.ceil(viewport.width);
      buffer.height = Math.ceil(viewport.height);
      const ctx = buffer.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, buffer.width, buffer.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      this.page = buffer;

      this.canvas.width = buffer.width;
      this.canvas.height = buffer.height;
      this.canvas.style.aspectRatio = `${buffer.width} / ${buffer.height}`;
    } finally {
      await doc.destroy();
    }
  }

  /**
   * @param {(ctx: CanvasRenderingContext2D, scale: number) => void} [overlay]
   *   scale converts PDF points to preview pixels.
   */
  draw(overlay) {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.page) return;
    ctx.drawImage(this.page, 0, 0);
    if (overlay) {
      const scale = this.canvas.width / this.pageWidth;
      ctx.save();
      overlay(ctx, scale);
      ctx.restore();
    }
  }

  reset() {
    this.page = null;
    this.pageWidth = 0;
    this.pageHeight = 0;
    if (this.canvas) {
      const ctx = this.canvas.getContext("2d");
      ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
