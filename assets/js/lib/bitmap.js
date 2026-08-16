/**
 * Shared bitmap helpers: ImageData <-> ImageBitmap conversion and
 * encoding to JPEG/PNG bytes for pdf-lib embedding.
 */

/**
 * @param {ImageBitmap} bitmap
 * @returns {ImageData}
 */
export function bitmapToImageData(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  return pixels;
}

/**
 * @param {ImageData} pixels
 * @returns {Promise<ImageBitmap>}
 */
export function imageDataToBitmap(pixels) {
  return createImageBitmap(pixels);
}

/**
 * @param {ImageBitmap} bitmap
 * @param {"image/jpeg"|"image/png"} mime
 * @param {number} [quality]
 * @returns {Promise<Uint8Array>}
 */
export async function bitmapToBytes(bitmap, mime, quality) {
  const buffer = document.createElement("canvas");
  buffer.width = bitmap.width;
  buffer.height = bitmap.height;
  const ctx = buffer.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, buffer.width, buffer.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => buffer.toBlob(resolve, mime, quality));
  buffer.width = 0;
  buffer.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}
