/**
 * Module Web Worker around the scan pipeline's `enhance` and `sharpen`.
 * Instantiate with: new Worker(url, { type: "module" }).
 *
 * Request:  { id, op: "enhance" | "sharpen", payload: { image } }
 * Response: { id, ok: true, result: { image, size } } | { id, ok: false, error }
 */
import { enhance, sharpen } from "../scan/pipeline.js";

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

self.addEventListener("message", (event) => {
  const message = event.data || {};
  const { id, op } = message;
  try {
    const payload = message.payload || {};
    const image = readImage(payload.image);
    const out = op === "enhance" ? enhance(image, "color") : op === "sharpen" ? sharpen(image) : null;
    if (!out) throw new Error(`unknown op: ${String(op)}`);
    self.postMessage(
      { id, ok: true, result: { image: out, size: { width: out.width, height: out.height } } },
      [out.data.buffer]
    );
  } catch (error) {
    self.postMessage({ id, ok: false, error: error && error.message ? error.message : String(error) });
  }
});
