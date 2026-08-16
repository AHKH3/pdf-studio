/**
 * Automatic image quality upgrade before PDF conversion:
 * 1. Every image gets the scan pipeline's "color" enhancement
 *    (illumination correction + contrast stretch + unsharp) in a worker.
 * 2. Small extracted documents additionally get an ESRGAN Slim upscale:
 *    - input <  550K pixels → 4x (tiny crops, old paper, faded ink)
 *    - input < 2.2M pixels  → 2x (zoomed crops still lose detail)
 *    Larger images keep their native resolution — the model is expensive
 *    and the gain is invisible on paper.
 *
 * Thresholds are measured against WASM memory limits on the reference
 * machine: 700x850 4x ran in ~7s, 800x1248 4x exhausted memory, and
 * 1100x1700 2x ran in ~18s (threaded WASM).
 */

import { EnhanceEngine } from "./client.js";
import { upscaleBitmap } from "./upscaler.js";
import { bitmapToImageData, imageDataToBitmap } from "../lib/bitmap.js";

/** Input pixel count below which a 4x upscale is safe and worth the wait. */
export const UPSCALE_4X_MAX_PIXELS = 550000;
/** Input pixel count below which a 2x upscale is worth the wait. */
export const UPSCALE_2X_MAX_PIXELS = 2200000;

function scaleFor(width, height) {
  const pixels = width * height;
  if (pixels < UPSCALE_4X_MAX_PIXELS) return 4;
  if (pixels < UPSCALE_2X_MAX_PIXELS) return 2;
  return 0;
}

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
  const scale = scaleFor(result.width, result.height);
  if (scale) {
    const upscaled = await upscaleBitmap(result, scale);
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
  const scale = scaleFor(bitmap.width, bitmap.height);
  if (!scale) return bitmap;
  return upscaleBitmap(bitmap, scale);
}
