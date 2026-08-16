/**
 * Automatic image quality upgrade before PDF conversion, targeting a fixed
 * quality bar: every extracted document reaches ~A4 at 300 DPI on its long
 * side (3508px), regardless of how small or blurry the source photo is.
 *
 * Flow (images tool):
 *   1. enhance ("color") in a worker — illumination, contrast, unsharp
 *   2. scale-chain upscale to the target (4x → 3x → 2x as needed)
 *   3. final light sharpen in a worker (the model softens ink edges)
 *
 * Flow (scan tool): processDocument already enhances; steps 2-3 apply.
 *
 * The chain is greedy: the largest model that keeps the output at or above
 * the target wins, and a 3x pass fixes small overshoots without ever
 * downscaling. One extra factor of ~1.4 (target × 1.2 cap) is tolerated to
 * avoid an extra inference pass.
 */

import { EnhanceEngine } from "./client.js";
import { upscaleBitmap } from "./upscaler.js";
import { bitmapToImageData, imageDataToBitmap } from "../lib/bitmap.js";

/** A4 long side at 300 DPI. */
export const TARGET_LONG_SIDE = 3508;
/**
 * Above this input size the WASM heap overflows during inference
 * (measured: 1100x1700 2x crashed, 800x1248 3x succeeded). Larger
 * documents already print at 200+ DPI, so they stay native.
 */
const MAX_INPUT_PIXELS = 1000000;

const engine = new EnhanceEngine();

/**
 * One greedy pass: pick the largest model that lands at or above the
 * target. Chained passes are impossible anyway — the intermediate output
 * exceeds the WASM input limit.
 */
function scaleFor(side) {
  if (side >= TARGET_LONG_SIDE) return 0;
  const needed = TARGET_LONG_SIDE / side;
  if (needed >= 3.5) return 4;
  if (needed >= 2.5) return 3;
  return 2;
}

async function sharpenBitmap(bitmap) {
  const pixels = bitmapToImageData(bitmap);
  const output = await engine.sharpen(pixels);
  return imageDataToBitmap(new ImageData(output.image.data, output.image.width, output.image.height));
}

/**
 * Upscales toward TARGET_LONG_SIDE with one greedy pass. Returns the
 * original bitmap when it already reaches the target. Callers own the
 * input bitmap; only internally produced bitmaps are closed here.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
export async function upscaleToTarget(bitmap) {
  const scale = scaleFor(Math.max(bitmap.width, bitmap.height));
  if (!scale) return bitmap;

  if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) return bitmap;
  const upscaled = await upscaleBitmap(bitmap, scale);
  if (upscaled === bitmap) return bitmap; // engine unavailable — give up cleanly

  let result = upscaled;
  const sharpened = await sharpenBitmap(result);
  if (sharpened !== result) {
    result.close();
    result = sharpened;
  }
  return result;
}

/**
 * Full upgrade for the images flow: enhance → upscale to target → sharpen.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>} upgraded bitmap (may be a new object)
 */
export async function upgradeForPdf(bitmap) {
  const pixels = bitmapToImageData(bitmap);
  const output = await engine.enhance(pixels);
  let result = await imageDataToBitmap(
    new ImageData(output.image.data, output.image.width, output.image.height)
  );
  const upgraded = await upscaleToTarget(result);
  if (upgraded !== result) {
    result.close();
    result = upgraded;
  }
  return result;
}

/**
 * Upscale-only helper for flows that already ran their own enhancement
 * (the scan tool's processDocument).
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
export async function autoUpscaleIfSmall(bitmap) {
  return upscaleToTarget(bitmap);
}
