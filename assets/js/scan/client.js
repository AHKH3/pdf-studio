/**
 * Main-thread handle on the scanning worker. Every heavy step runs off the UI
 * thread, so dragging a corner never blocks the window.
 */

const WORKER_URL = new URL("./pipeline.worker.js", import.meta.url);

export class ScanEngine {
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
      else entry.reject(new Error(error || "فشل المعالجة"));
    });
    this.worker.addEventListener("error", (event) => {
      const failure = new Error(event.message || "توقف محرك المسح");
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
   * Hands the pixels to the worker permanently; the caller's buffer is detached.
   * @param {string} key
   * @param {ImageData} image
   */
  load(key, image) {
    return this.call(
      "load",
      { key, image: { width: image.width, height: image.height, data: image.data } },
      [image.data.buffer]
    );
  }

  /** @param {string} key */
  detect(key) {
    return this.call("detect", { key });
  }

  /**
   * @param {string} key
   * @param {{ corners: Array<{x:number,y:number}>; size?: { width: number; height: number }; mode: string; rotate: number }} params
   * @returns {Promise<{ image: { width: number; height: number; data: Uint8ClampedArray } }>}
   */
  process(key, params) {
    return this.call("process", { key, ...params });
  }

  /** @param {string} key */
  release(key) {
    return this.call("release", { key }).catch(() => {});
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
