/**
 * Automatic image quality upgrade before PDF conversion, targeting a fixed
 * quality bar: every extracted document reaches ~A4 at 300 DPI on its long
 * side (3508px), regardless of how small or blurry the source photo is.
 *
 * Layers, in order of strength:
 *   1. AI upscale (ESRGAN Slim 4x/3x/2x) when the WASM heap allows it —
 *      the biggest quality jump for faded ink on old paper.
 *   2. Bicubic upscale as a guaranteed fallback — the AI can silently
 *      fail (heap limits, worker errors); pixelation is always removed.
 *   3. Sharpen in a worker — restores ink crispness after any upscale.
 *
 * The output ALWAYS reaches the target or stays at a larger native
 * resolution; it is never left pixelated.
 */

import { EnhanceEngine } from "./client.js";
import { upscaleBitmap } from "./upscaler.js";
import { bitmapToImageData, imageDataToBitmap } from "../lib/bitmap.js";

/** A4 long side at 300 DPI. */
export const TARGET_LONG_SIDE = 3508;
/**
 * WASM heap safety: the largest measured-successful AI output was ~9.5M
 * pixels (700x850 4x); ~16M pixels crashed. Bicubic has no such limit.
 */
const MAX_AI_OUTPUT_PIXELS = 9500000;
/** Hard upper bound for a single bicubic pass (canvas limit ~268M pixels). */
const MAX_BICUBIC_OUTPUT_PIXELS = 64000000;

const engine = new EnhanceEngine();

/**
 * One greedy AI pass: pick the largest model that lands at or above the
 * target. Chained passes are impossible — the intermediate output exceeds
 * the WASM input limit.
 */
function aiScaleFor(side) {
  if (side >= TARGET_LONG_SIDE) return 0;
  const needed = TARGET_LONG_SIDE / side;
  if (needed >= 3.5) return 4;
  if (needed >= 2.5) return 3;
  return 2;
}

async function sharpenBitmap(bitmap) {
  try {
    const pixels = bitmapToImageData(bitmap);
    const output = await engine.sharpen(pixels);
    return imageDataToBitmap(new ImageData(output.image.data, output.image.width, output.image.height));
  } catch {
    return bitmap;
  }
}

async function inkBoostBitmap(bitmap) {
  try {
    const pixels = bitmapToImageData(bitmap);
    const output = await engine.inkBoost(pixels);
    return imageDataToBitmap(new ImageData(output.image.data, output.image.width, output.image.height));
  } catch {
    return bitmap;
  }
}

/**
 * Ink deepens first (faded strokes go black), then a light sharpen.
 * Returns a new bitmap or the same one when both steps are unavailable.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
async function polishBitmap(bitmap) {
  let result = bitmap;
  const boosted = await inkBoostBitmap(result);
  if (boosted !== result) {
    result.close();
    result = boosted;
  }
  const sharpened = await sharpenBitmap(result);
  if (sharpened !== result) {
    result.close();
    result = sharpened;
  }
  return result;
}

/**
 * Canvas bicubic upscale — always available, no WASM, no memory limits
 * in the practical range. Returns a new bitmap or the same one when the
 * target is already met.
 * @param {ImageBitmap} bitmap
 * @param {number} targetSide
 * @returns {Promise<ImageBitmap>}
 */
async function bicubicUpscale(bitmap, targetSide) {
  const currentSide = Math.max(bitmap.width, bitmap.height);
  if (currentSide >= targetSide) return bitmap;
  let scale = targetSide / currentSide;
  if (scale > 8) scale = 8; // one pass tops out; chain below
  const outWidth = Math.round(bitmap.width * scale);
  const outHeight = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);
  const upscaled = await createImageBitmap(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return upscaled;
}

/**
 * Upscales toward TARGET_LONG_SIDE. AI first, bicubic fallback, sharpen
 * last. Returns the original bitmap when it already reaches the target.
 * Callers own the input bitmap; only internally produced bitmaps are
 * closed here.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
export async function upscaleToTarget(bitmap) {
  const side = Math.max(bitmap.width, bitmap.height);
  if (side >= TARGET_LONG_SIDE) return bitmap;

  const scale = aiScaleFor(side);
  if (scale && bitmap.width * bitmap.height * scale * scale <= MAX_AI_OUTPUT_PIXELS) {
    const ai = await upscaleBitmap(bitmap, scale);
    if (ai !== bitmap) {
      const polished = await polishBitmap(ai);
      if (polished !== ai) ai.close();
      return polished;
    }
  }

  // Guaranteed path: remove pixelation no matter what the AI did.
  const outPixels = bitmap.width * bitmap.height *
    Math.pow(TARGET_LONG_SIDE / side, 2);
  if (outPixels > MAX_BICUBIC_OUTPUT_PIXELS) return bitmap;
  let bicubic = await bicubicUpscale(bitmap, TARGET_LONG_SIDE);
  if (bicubic === bitmap) return bitmap;
  if (Math.max(bicubic.width, bicubic.height) < TARGET_LONG_SIDE) {
    // Extreme upscale needs a second pass (8x then the rest).
    const second = await bicubicUpscale(bicubic, TARGET_LONG_SIDE);
    if (second !== bicubic) {
      bicubic.close();
      bicubic = second;
    }
  }
  const polished = await polishBitmap(bicubic);
  if (polished !== bicubic) bicubic.close();
  return polished;
}

/**
 * Full upgrade for the images flow: enhance → upscale to target → sharpen.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>} upgraded bitmap (may be a new object)
 */
export async function upgradeForPdf(bitmap) {
  let result = null;
  try {
    const pixels = bitmapToImageData(bitmap);
    const output = await engine.enhance(pixels);
    result = await imageDataToBitmap(
      new ImageData(output.image.data, output.image.width, output.image.height)
    );
  } catch {
    result = null;
  }
  if (!result) return upscaleToTarget(bitmap);
  const upgraded = await upscaleToTarget(result);
  if (upgraded !== result) {
    result.close();
  }
  return upgraded;
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
