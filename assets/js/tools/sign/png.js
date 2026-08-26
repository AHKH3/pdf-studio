/**
 * Raster helpers for Fill & Sign. Arabic is painted as an image because
 * pdf-lib's standard fonts have no Arabic coverage (same approach as watermark).
 */

const FONT = `"Noto Naskh Arabic", "Amiri", "Playfair Display", serif`;

/** @param {HTMLCanvasElement} canvas */
export async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((file) => (file ? resolve(file) : reject(new Error("تعذّر ترميز الصورة."))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} [alphaMin]
 */
export function canvasHasInk(canvas, alphaMin = 16) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > alphaMin) return true;
  }
  return false;
}

/**
 * Crop to non-transparent pixels so a signature pad does not stamp a huge empty box.
 * @param {HTMLCanvasElement} canvas
 * @param {number} [padding]
 */
export function trimTransparent(canvas, padding = 10) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{ bytes: Uint8Array; width: number; height: number }>}
 */
export async function canvasToTrimmedPng(canvas) {
  const trimmed = trimTransparent(canvas);
  if (!canvasHasInk(trimmed)) {
    throw new Error("اللوحة فارغة.");
  }
  const bytes = await canvasToPngBytes(trimmed);
  return { bytes, width: trimmed.width, height: trimmed.height };
}

/** @param {string} [color] */
export async function waitForFonts() {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
}

/**
 * @param {string} text
 * @param {{ color?: string; fontSize?: number; framed?: boolean }} [style]
 */
export async function renderTextPng(text, style = {}) {
  const value = String(text || "").trim();
  if (!value) throw new Error("لا يوجد نص.");
  await waitForFonts();

  const color = style.color || "#141c17";
  const framed = Boolean(style.framed);
  const scale = 2;
  const fontSize = Math.max(14, (style.fontSize || 22) * scale);
  const font = `600 ${fontSize}px ${FONT}`;

  const gauge = document.createElement("canvas").getContext("2d");
  gauge.font = font;
  gauge.direction = "rtl";
  const textWidth = Math.ceil(gauge.measureText(value).width);

  const padX = framed ? fontSize * 0.55 : fontSize * 0.28;
  const padY = framed ? fontSize * 0.4 : fontSize * 0.22;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, textWidth + padX * 2);
  canvas.height = Math.max(1, Math.ceil(fontSize * 1.65) + padY * 2);

  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  if (framed) {
    const line = Math.max(2, fontSize * 0.07);
    ctx.lineWidth = line;
    const inset = line + 1;
    roundRect(ctx, inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, Math.min(10, fontSize * 0.18));
    ctx.stroke();
  }

  ctx.fillText(value, canvas.width / 2, canvas.height / 2 + fontSize * 0.04);
  const bytes = await canvasToPngBytes(canvas);
  return { bytes, width: canvas.width, height: canvas.height };
}

/**
 * Rasterise a user image to PNG so flatten has a single embed path.
 * @param {Blob | File} file
 */
export async function rasterizeImageFile(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  try {
    const maxEdge = 1800;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = await canvasToPngBytes(canvas);
    return { bytes, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Rotate PNG pixels counter-clockwise in 90° steps so a stamp drawn in
 * visual (upright) space lands correctly on a page with /Rotate.
 * @param {Uint8Array} png
 * @param {number} ccwQuarters 0–3
 */
export async function rotatePngQuarter(png, ccwQuarters) {
  const turns = ((ccwQuarters % 4) + 4) % 4;
  if (turns === 0) return png;

  const blob = new Blob([png], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    if (turns % 2) {
      canvas.width = bitmap.height;
      canvas.height = bitmap.width;
    } else {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-turns * Math.PI) / 2);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return canvasToPngBytes(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * Map a visual-space rectangle (origin bottom-left of the upright page the
 * user sees) into pdf-lib media-box space, plus how many CCW quarter-turns
 * the bitmap itself needs so the viewer’s /Rotate brings it upright again.
 *
 * @param {number} angle pdf-lib page rotation in degrees
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {{ x: number; y: number; width: number; height: number }} rect
 */
export function visualRectToMedia(angle, mediaW, mediaH, rect) {
  const a = ((angle % 360) + 360) % 360;
  const { x, y, width, height } = rect;
  if (a === 90) {
    return { x: mediaW - y - height, y: x, width: height, height: width, ccw: 1 };
  }
  if (a === 180) {
    return { x: mediaW - x - width, y: mediaH - y - height, width, height, ccw: 2 };
  }
  if (a === 270) {
    return { x: y, y: mediaH - x - width, width: height, height: width, ccw: 3 };
  }
  return { x, y, width, height, ccw: 0 };
}

/** Visual page size matching pdf.js’s rotated viewport. */
export function visualPageSize(mediaW, mediaH, angle) {
  const a = ((angle % 360) + 360) % 360;
  return a === 90 || a === 270 ? { width: mediaH, height: mediaW } : { width: mediaW, height: mediaH };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
