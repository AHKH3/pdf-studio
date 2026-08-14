/**
 * Module Web Worker around the scanning pipeline.
 * Instantiate with: new Worker(url, { type: "module" }).
 *
 * Request:  { id, op: "load" | "detect" | "process" | "release", payload }
 * Response: { id, ok: true, result } | { id, ok: false, error }
 *
 * Source pixels are uploaded once under a key and kept here, so adjusting
 * corners or switching enhancement modes never re-sends a full-size image.
 */
import { detectDocument, processDocument, suggestOutputSize } from "./pipeline.js";

/** @type {Map<string, { width: number, height: number, data: Uint8ClampedArray }>} */
const store = new Map();

function readImage(value) {
  if (!value) throw new Error("missing image");
  const width = Math.floor(Number(value.width) || 0);
  const height = Math.floor(Number(value.height) || 0);
  if (width < 1 || height < 1) throw new Error("invalid image dimensions");
  let data = value.data;
  if (data instanceof ArrayBuffer) data = new Uint8ClampedArray(data);
  else if (data && data.buffer instanceof ArrayBuffer && !(data instanceof Uint8ClampedArray)) {
    data = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!(data instanceof Uint8ClampedArray)) throw new Error("invalid image data");
  if (data.length < width * height * 4) throw new Error("image data too short");
  return { width, height, data };
}

function respond(id, result, transfer) {
  self.postMessage({ id, ok: true, result }, transfer || []);
}

function resolveImage(payload) {
  if (payload.key && store.has(payload.key)) return store.get(payload.key);
  return readImage(payload.image);
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const { id, op } = message;
  try {
    const payload = message.payload || {};
    if (op === "load") {
      const image = readImage(payload.image);
      store.set(String(payload.key), image);
      respond(id, { width: image.width, height: image.height });
      return;
    }
    if (op === "release") {
      store.delete(String(payload.key));
      respond(id, { released: true });
      return;
    }
    if (op === "detect") {
      const detection = detectDocument(resolveImage(payload), payload.options);
      respond(id, {
        corners: detection.corners,
        confidence: detection.confidence,
        method: detection.method,
        size: suggestOutputSize(detection.corners, payload.options)
      });
      return;
    }
    if (op === "process") {
      const { image, size } = processDocument(resolveImage(payload), {
        corners: payload.corners,
        size: payload.size,
        mode: payload.mode,
        rotate: payload.rotate
      });
      respond(id, { image, size }, [image.data.buffer]);
      return;
    }
    throw new Error(`unknown op: ${String(op)}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error && error.message ? error.message : String(error) });
  }
});
