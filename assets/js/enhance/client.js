/**
 * Main-thread handle on the enhancement worker. Keeps the UI responsive
 * while illumination correction and sharpening run on large images.
 */

const WORKER_URL = new URL("./enhance.worker.js", import.meta.url);

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
    });
    return this.worker;
  }

  /**
   * @param {string} op
   * @param {object} payload
   * @param {Transferable[]} [transfer]
   */
  call(op, payload, transfer = []) {
    const worker = this.ensure();
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, payload }, transfer);
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

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
