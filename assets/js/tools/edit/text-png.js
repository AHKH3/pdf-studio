/**
 * Raster helpers for the edit overlay. Arabic is painted on high-res canvas because
 * pdf-lib's standard fonts have no Arabic RTL ligature shaping coverage.
 */

export const ARABIC_FONTS = {
  naskh: `"Noto Naskh Arabic", "Amiri", "Playfair Display", serif`,
  amiri: `"Amiri", "Noto Naskh Arabic", serif`,
  cairo: `"Cairo", "Noto Naskh Arabic", sans-serif`,
  sans: `"Segoe UI", "Tahoma", "Arial", sans-serif`,
  mono: `"Courier New", monospace`
};

export const FONT = ARABIC_FONTS.naskh;

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
 * Paint wrapped Arabic (or Latin) text into a box, then return PNG bytes.
 *
 * @param {string} text
 * @param {{
 *   width: number;
 *   height: number;
 *   fontSize: number;
 *   fontFamily?: string;
 *   color: string;
 *   bold?: boolean;
 *   italic?: boolean;
 *   underline?: boolean;
 *   strike?: boolean;
 *   align?: "right" | "center" | "left";
 *   bgColor?: string;
 *   bgOn?: boolean;
 *   borderColor?: string;
 *   borderWidth?: number;
 *   opacity?: number;
 * }} style
 * @param {number} [renderScale=2.5]
 */
export async function renderTextBoxPng(text, style, renderScale = 2.5) {
  await waitForFonts();
  const scale = Math.max(1, renderScale);
  const width = Math.max(1, Math.round(style.width * scale));
  const height = Math.max(1, Math.round(style.height * scale));
  const fontSize = Math.max(8, (style.fontSize || 18) * scale);
  const weight = style.bold ? "bold" : "normal";
  const fontFam = ARABIC_FONTS[style.fontFamily] || style.fontFamily || FONT;
  const font = `${style.italic ? "italic " : ""}${weight} ${fontSize}px ${fontFam}`;
  const pad = Math.max(4, fontSize * 0.22);
  const align = style.align || "right";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر إنشاء سياق الرسم.");

  if (style.opacity != null && style.opacity < 1) {
    ctx.globalAlpha = Math.max(0.05, style.opacity);
  }

  // Draw background if enabled
  if (style.bgOn && style.bgColor) {
    ctx.fillStyle = style.bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  // Draw border if enabled
  if (style.borderWidth && style.borderColor) {
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = style.borderWidth * scale;
    ctx.strokeRect(0, 0, width, height);
  }

  ctx.font = font;
  ctx.direction = "rtl";
  ctx.fillStyle = style.color || "#1E3A8A";
  ctx.textBaseline = "top";
  ctx.textAlign = align === "center" ? "center" : align === "left" ? "left" : "right";

  const maxWidth = width - pad * 2;
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.42;
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

    const w = ctx.measureText(lines[i]).width;
    const ux = align === "center" ? x - w / 2 : align === "left" ? x : x - w;

    if (style.underline && lines[i].trim()) {
      const uy = y + fontSize * 1.14;
      ctx.fillRect(ux, uy, w, Math.max(1.5, fontSize * 0.07));
    }
    if (style.strike && lines[i].trim()) {
      const sy = y + fontSize * 0.58;
      ctx.fillRect(ux, sy, w, Math.max(1.5, fontSize * 0.07));
    }
  }
  ctx.restore();

  const bytes = await canvasToPngBytes(canvas);
  return { bytes, width, height, canvas };
}

/**
 * Generate official Arabic Stamps (معتمد، سري، ملغى، مسودة، مدفوع، إلخ).
 * @param {{
 *   label: string;
 *   sub?: string;
 *   color?: string;
 *   shape?: "rect" | "ellipse";
 *   width?: number;
 *   height?: number;
 * }} options
 */
export async function renderStampPng(options) {
  await waitForFonts();
  const label = options.label || "معتمد";
  const sub = options.sub || new Date().toLocaleDateString("ar-EG");
  const color = options.color || "#DC2626";
  const shape = options.shape || "rect";
  const scale = 3;
  const width = (options.width || 180) * scale;
  const height = (options.height || 80) * scale;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر إنشاء الختم.");

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.direction = "rtl";

  const pad = 8 * scale;
  const cornerRadius = 6 * scale;

  if (shape === "ellipse") {
    ctx.lineWidth = 3.5 * scale;
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2 - pad, height / 2 - pad, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2 - pad * 1.6, height / 2 - pad * 1.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Double rectangle
    ctx.lineWidth = 3.5 * scale;
    ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);

    ctx.lineWidth = 1.2 * scale;
    ctx.strokeRect(pad * 1.6, pad * 1.6, width - pad * 3.2, height - pad * 3.2);
  }

  // Stamp text
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const mainFontSize = Math.round(24 * scale);
  ctx.font = `bold ${mainFontSize}px "Amiri", "Noto Naskh Arabic", serif`;
  ctx.fillText(label, width / 2, height / 2 - (sub ? 8 * scale : 0));

  if (sub) {
    const subFontSize = Math.round(11 * scale);
    ctx.font = `600 ${subFontSize}px "Noto Naskh Arabic", "Segoe UI", sans-serif`;
    ctx.fillText(sub, width / 2, height / 2 + 16 * scale);
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
  if (!ctx) throw new Error("تعذّر إنشاء سياق التدوير.");
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
    const maxEdge = 2400;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذّر تحميل الصورة.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذّر استعادة الرسم.");
    ctx.drawImage(bitmap, 0, 0);
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
    if (!ctx) throw new Error("تعذّر تدوير الصورة.");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-turns * Math.PI) / 2);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return canvasToPngBytes(canvas);
  } finally {
    bitmap.close();
  }
}
