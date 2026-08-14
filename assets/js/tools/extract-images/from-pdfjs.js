import { encodePng } from "./png.js";
import { openDocument } from "../../pdf/core.js";
import { tick } from "../shared.js";

function pdfjs() {
  return /** @type {any} */ (window)["pdfjs-dist/build/pdf"] || /** @type {any} */ (window).pdfjsLib;
}

function kindToRgba(data, width, height, kind, ImageKind) {
  const count = width * height;
  const rgba = new Uint8ClampedArray(count * 4);
  if (kind === ImageKind?.GRAYSCALE_1BPP || kind === 1) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const i = (y * width + x) * 4;
        const v = bit ? 0 : 255;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    return rgba;
  }
  if (kind === ImageKind?.RGB_24BPP || kind === 2) {
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 3) {
      rgba[i] = data[p];
      rgba[i + 1] = data[p + 1];
      rgba[i + 2] = data[p + 2];
      rgba[i + 3] = 255;
    }
    return rgba;
  }
  if (data.length >= count * 4) {
    rgba.set(data.subarray(0, count * 4));
    return rgba;
  }
  return null;
}

/** @param {any} img */
async function imgToPng(img) {
  const width = Number(img?.width) || 0;
  const height = Number(img?.height) || 0;
  if (width < 2 || height < 2) return null;

  if (img.bitmap) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img.bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    canvas.width = 0;
    canvas.height = 0;
    const bytes = await encodePng(rgba, width, height, 4);
    return { width, height, bytes };
  }

  if (!img.data) return null;
  const ImageKind = pdfjs()?.ImageKind;
  const rgba = kindToRgba(img.data, width, height, img.kind, ImageKind);
  if (!rgba) return null;
  const bytes = await encodePng(rgba, width, height, 4);
  return { width, height, bytes };
}

async function readNamed(page, name) {
  for (const bag of [page.objs, page.commonObjs]) {
    try {
      const value = bag.get(name);
      if (value) return value;
    } catch {
      /* missing */
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };
    for (const bag of [page.objs, page.commonObjs]) {
      try {
        const value = bag.get(name, finish);
        if (value) finish(value);
      } catch {
        /* missing */
      }
    }
    setTimeout(() => finish(null), 200);
  });
}

/**
 * Decoded paintImageXObject / inline images from pdf.js. Used for inline
 * images and for XObjects pdf-lib cannot decode (JBIG2, CCITT, predictors).
 * This path is PNG reconstruction, never a page screenshot.
 *
 * @param {Uint8Array} bytes
 * @param {string} [password]
 * @param {(info: { page: number; pages: number }) => void} [onProgress]
 */
export async function collectPdfJsImages(bytes, password = "", onProgress) {
  const lib = pdfjs();
  if (!lib) return [];
  const OPS = lib.OPS || {};
  const paint = new Set(
    [OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject].filter((n) => typeof n === "number")
  );
  const inlineOp = OPS.paintInlineImageXObject;

  const doc = await openDocument(bytes, password);
  /** @type {Map<string, { key: string; width: number; height: number; bytes: Uint8Array; pages: number[]; inline: boolean }>} */
  const found = new Map();

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      onProgress?.({ page: pageNumber, pages: doc.numPages });
      await tick(pageNumber, 1);
      const page = await doc.getPage(pageNumber);
      let ops;
      try {
        ops = await page.getOperatorList();
      } catch {
        page.cleanup();
        continue;
      }

      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];
        if (!paint.has(fn)) continue;
        const args = ops.argsArray[i] || [];
        const isInline = fn === inlineOp;
        const name = isInline ? "" : String(args[0] || "");
        const key = isInline ? `inline-${pageNumber}-${i}` : name;
        if (!key || found.has(key)) {
          const hit = found.get(key);
          if (hit && !hit.pages.includes(pageNumber)) hit.pages.push(pageNumber);
          continue;
        }

        const img = isInline ? args[0] : await readNamed(page, name);
        const png = await imgToPng(img);
        if (!png) continue;
        found.set(key, {
          key,
          width: png.width,
          height: png.height,
          bytes: png.bytes,
          pages: [pageNumber],
          inline: isInline
        });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return [...found.values()];
}
