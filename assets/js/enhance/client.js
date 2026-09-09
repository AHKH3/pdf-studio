/**
 * Main-thread handle on the enhancement worker. Keeps the UI responsive
 * while illumination correction and sharpening run on large images.
 */

const WORKER_URL = new URL("./enhance.worker.js", import.meta.url);

/**
 * Same no-hang guarantee as the scan engine: a lost worker reply must
 * reject instead of freezing the export progress overlay forever.
 */
const CALL_TIMEOUT_MS = 120000;

export class EnhanceEngine {
  constructor() {
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>} */
    this.pending = new Map();
    this.nextId = 0;
  }

  ensure() {
    if (this.worker) return this.worker;
    this.worker = new Worker(WORKER_URL, { type: "module" });
    this.worker.addEventListener("message", (event) => {
      const { id, ok, result, error } = event.data || {};
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || "فشل تحسين الصورة"));
    });
    this.worker.addEventListener("error", (event) => {
      const failure = new Error(event.message || "توقف محرك التحسين");
      for (const entry of this.pending.values()) entry.reject(failure);
      this.pending.clear();
      this.worker = null;
    });
    return this.worker;
  }

  /**
   * @param {string} op
   * @param {object} payload
   * @param {Transferable[]} [transfer]
   * @param {number} [timeoutMs] rejection timeout; a late reply is ignored
   */
  call(op, payload, transfer = [], timeoutMs = CALL_TIMEOUT_MS) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = this.ensure();
      } catch (error) {
        reject(new Error(`تعذر تشغيل محرك التحسين: ${error.message}`));
        return;
      }
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("انتهت مهلة تحسين الصورة — أعد المحاولة."));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      try {
        worker.postMessage({ id, op, payload }, transfer);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`تعذر تشغيل محرك التحسين: ${error.message}`));
      }
    });
  }

  /**
   * Runs the scan pipeline's `enhance(..., "color")` on the pixels.
   * @param {ImageData} image
   * @returns {Promise<{ image: { width: number; height: number; data: Uint8ClampedArray }, size: { width: number; height: number } }>}
   */
  enhance(image) {
    return this.call(
      "enhance",
      { image: { width: image.width, height: image.height, data: image.data } },
      [image.data.buffer]
    );
  }

  /**
   * Runs the scan pipeline's post-upscale `sharpen` on the pixels.
   * @param {ImageData} image
   * @returns {Promise<{ image: { width: number; height: number; data: Uint8ClampedArray }, size: { width: number; height: number } }>}
   */
  sharpen(image) {
    return this.call(
      "sharpen",
      { image: { width: image.width, height: image.height, data: image.data } },
      [image.data.buffer]
    );
  }

  /**
   * Runs the scan pipeline's `inkBoost` — deepens faded ink toward black.
   * @param {ImageData} image
   * @returns {Promise<{ image: { width: number; height: number; data: Uint8ClampedArray }, size: { width: number; height: number } }>}
   */
  inkBoost(image) {
    return this.call(
      "inkBoost",
      { image: { width: image.width, height: image.height, data: image.data } },
      [image.data.buffer]
    );
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
