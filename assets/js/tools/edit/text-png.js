/**
 * Raster helpers for the edit overlay. Arabic is painted as an image because
 * pdf-lib's standard fonts have no Arabic coverage.
 */

export const FONT = `"Noto Naskh Arabic", "Playfair Display", serif`;

/** @param {HTMLCanvasElement} canvas */
export async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((file) => (file ? resolve(file) : reject(new Error("تعذّر ترميز الصورة."))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function waitForFonts() {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 */
function wrapLines(ctx, text, maxWidth) {
  const width = Math.max(8, maxWidth);
  const paragraphs = String(text || "").split("\n");
  /** @type {string[]} */
  const lines = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width <= width) {
        line = trial;
        continue;
      }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= width) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (ctx.measureText(next).width <= width) chunk = next;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/**
 * Paint wrapped Arabic (or Latin) text into a box, then return PNG bytes
 * matching the unrotated visual rectangle.
 *
 * @param {string} text
 * @param {{
 *   width: number;
 *   height: number;
 *   fontSize: number;
 *   color: string;
 *   bold?: boolean;
 *   italic?: boolean;
 *   underline?: boolean;
 *   align?: "right" | "center" | "left";
 * }} style
 */
export async function renderTextBoxPng(text, style) {
  await waitForFonts();
  const scale = 2;
  const width = Math.max(1, Math.round(style.width * scale));
  const height = Math.max(1, Math.round(style.height * scale));
  const fontSize = Math.max(10, style.fontSize * scale);
  const weight = style.bold ? 700 : 400;
  const font = `${style.italic ? "italic " : ""}${weight} ${fontSize}px ${FONT}`;
  const pad = Math.max(4, fontSize * 0.18);
  const align = style.align || "right";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.direction = "rtl";
  ctx.fillStyle = style.color || "#1E3A8A";
  ctx.textBaseline = "top";
  ctx.textAlign = align === "center" ? "center" : align === "left" ? "left" : "right";

  const maxWidth = width - pad * 2;
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.45;
  let x = width - pad;
  if (align === "left") x = pad;
  if (align === "center") x = width / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (let i = 0; i < lines.length; i += 1) {
    const y = pad + i * lineHeight;
    if (y > height) break;
    ctx.fillText(lines[i], x, y);
    if (style.underline && lines[i].trim()) {
      const w = ctx.measureText(lines[i]).width;
      const ux = align === "center" ? x - w / 2 : align === "left" ? x : x - w;
      const uy = y + fontSize * 1.12;
      ctx.fillRect(ux, uy, w, Math.max(1.5, fontSize * 0.07));
    }
  }
  ctx.restore();

  const bytes = await canvasToPngBytes(canvas);
  return { bytes, width, height, canvas };
}

/**
 * Composite an unrotated source onto a canvas that includes CSS-clockwise
 * rotation, sized to the visual AABB.
 *
 * @param {HTMLCanvasElement} source
 * @param {{ x: number; y: number; width: number; height: number }} box
 * @param {number} rotation
 * @param {{ x: number; y: number; width: number; height: number }} aabb
 */
export async function bakeRotatedPng(source, box, rotation, aabb) {
  const scale = source.width / Math.max(1, box.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(aabb.width * scale));
  canvas.height = Math.max(1, Math.round(aabb.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(((rotation || 0) * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  const bytes = await canvasToPngBytes(canvas);
  return { bytes, width: canvas.width, height: canvas.height };
}

/** @param {Blob | File} file */
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
    return { bytes, width: canvas.width, height: canvas.height, canvas };
  } finally {
    bitmap.close();
  }
}

/** @param {Uint8Array} png */
export async function pngToCanvas(png) {
  const blob = new Blob([png], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * @param {Uint8Array} png
 * @param {number} ccwQuarters
 */
export async function rotatePngQuarter(png, ccwQuarters) {
  const turns = ((ccwQuarters % 4) + 4) % 4;
  if (!turns) return png;

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
