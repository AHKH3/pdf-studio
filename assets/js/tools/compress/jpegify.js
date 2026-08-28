/** Canvas JPEG encode / decode used by the preserve-text compress path. */

function canvasContext(width, height, alpha = false) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d", { alpha });
  return { canvas, ctx };
}

function putRgba(ctx, data, width, height) {
  const frame = ctx.createImageData(width, height);
  if (data instanceof Uint8ClampedArray && data.length === frame.data.length) frame.data.set(data);
  else {
    const src = data;
    const dst = frame.data;
    for (let i = 0; i < dst.length; i += 1) dst[i] = src[i] ?? (i % 4 === 3 ? 255 : 0);
  }
  ctx.putImageData(frame, 0, 0);
}

/**
 * @param {Uint8ClampedArray | Uint8Array} data
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 */
export async function resizeRgbaCanvas(data, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) {
    return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  }
  const src = canvasContext(srcW, srcH, true);
  putRgba(src.ctx, data, srcW, srcH);
  const dst = canvasContext(dstW, dstH, false);
  dst.ctx.fillStyle = "#ffffff";
  dst.ctx.fillRect(0, 0, dstW, dstH);
  dst.ctx.imageSmoothingEnabled = true;
  dst.ctx.imageSmoothingQuality = "high";
  dst.ctx.drawImage(src.canvas, 0, 0, dstW, dstH);
  const out = dst.ctx.getImageData(0, 0, dstW, dstH).data;
  src.canvas.width = src.canvas.height = dst.canvas.width = dst.canvas.height = 0;
  return out;
}

/**
 * @param {{ data: Uint8ClampedArray | Uint8Array; width: number; height: number }} image
 * @param {{ quality?: number }} [options]
 */
export async function encodeJpegCanvas(image, options = {}) {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  const { canvas, ctx } = canvasContext(width, height, false);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  putRgba(ctx, image.data, width, height);
  const quality = Number.isFinite(options.quality) ? options.quality : 0.72;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("jpeg");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {Uint8Array} bytes
 * @param {string} [mime]
 */
export async function decodeImageBytes(bytes, mime = "image/jpeg") {
  const blob = new Blob([bytes], { type: mime || "image/jpeg" });
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const { canvas, ctx } = canvasContext(bitmap.width, bitmap.height, false);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  return { data: frame.data, width: frame.width, height: frame.height };
}
