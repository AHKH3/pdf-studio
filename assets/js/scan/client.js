/**
 * Main-thread handle on the scanning worker. Every heavy step runs off the UI
 * thread, so dragging a corner never blocks the window.
 */

const WORKER_URL = new URL("./pipeline.worker.js", import.meta.url);

/**
 * A worker call must never hang forever: without a timeout a lost reply
 * leaves the progress overlay stuck (and the cancel button ineffective).
 */
const CALL_TIMEOUT_MS = 120000;
const RELEASE_TIMEOUT_MS = 15000;

function timeoutFor(op) {
  return op === "release" ? RELEASE_TIMEOUT_MS : CALL_TIMEOUT_MS;
}

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
      // A broken worker never recovers: drop it so the next call spawns a
      // fresh one instead of hanging forever on a dead port (export stuck
      // at 0% with an unresponsive cancel button).
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
  call(op, payload, transfer = [], timeoutMs = timeoutFor(op)) {
    let worker;
    try {
      worker = this.ensure();
    } catch (error) {
      return Promise.reject(new Error(`تعذر تشغيل محرك المسح: ${error.message}`));
    }
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error("انتهت مهلة معالجة الصفحة — أعد المحاولة."));
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
        reject(new Error(`تعذر إرسال المهمة إلى محرك المسح: ${error.message}`));
      }
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
