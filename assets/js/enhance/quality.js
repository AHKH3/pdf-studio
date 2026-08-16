/**
 * Automatic image quality upgrade before PDF conversion:
 * 1. Every image gets the scan pipeline's "color" enhancement
 *    (illumination correction + contrast stretch + unsharp) in a worker.
 * 2. Small images (longest side below UPSCALE_MAX_SIDE) additionally get a
 *    2x ESRGAN Slim upscale. Large images keep their native resolution —
 *    the model is expensive and the gain is invisible on paper.
 */

import { EnhanceEngine } from "./client.js";
import { upscaleBitmap } from "./upscaler.js";
import { bitmapToImageData, imageDataToBitmap } from "../lib/bitmap.js";

/** Longest side below which a 2x AI upscale is worth the wait. */
export const UPSCALE_MAX_SIDE = 1600;

const engine = new EnhanceEngine();

/**
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>} upgraded bitmap (may be a new object)
 */
export async function upgradeForPdf(bitmap) {
  const pixels = bitmapToImageData(bitmap);
  const output = await engine.enhance(pixels);
  let result = await imageDataToBitmap(
    new ImageData(output.image.data, output.image.width, output.image.height)
  );
  if (Math.max(result.width, result.height) < UPSCALE_MAX_SIDE) {
    const upscaled = await upscaleBitmap(result);
    if (upscaled !== result) {
      result.close();
      result = upscaled;
    }
  }
  return result;
}

/**
 * Upscale-only helper for flows that already ran their own enhancement
 * (the scan tool's processDocument). Returns the same bitmap unchanged
 * when it is already large or the upscaler is unavailable.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
export async function autoUpscaleIfSmall(bitmap) {
  if (Math.max(bitmap.width, bitmap.height) >= UPSCALE_MAX_SIDE) return bitmap;
  return upscaleBitmap(bitmap);
}
