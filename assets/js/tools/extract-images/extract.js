import { encodePng } from "./png.js";
import { collectPdfJsImages } from "./from-pdfjs.js";
import { lib, loadWritable } from "../../pdf/core.js";
import { tick } from "../shared.js";

const IMAGE_CODECS = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);

function asName(obj) {
  if (!obj) return "";
  const raw =
    typeof obj.decodeText === "function"
      ? obj.decodeText()
      : typeof obj.asString === "function"
        ? obj.asString()
        : "";
  return String(raw).replace(/^\//, "");
}

function asNumber(obj) {
  if (!obj) return undefined;
  if (typeof obj.asNumber === "function") return obj.asNumber();
  return undefined;
}

function looksLikeJpeg(bytes) {
  return Boolean(bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8);
}

function refKey(ref) {
  if (!ref) return "";
  if (typeof ref.objectNumber === "number") return `${ref.objectNumber}.${ref.generationNumber || 0}`;
  return "";
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} columns
 * @param {number} colors
 * @param {number} bpc
 * @param {number} predictor
 */
function undoPredictor(bytes, columns, colors, bpc, predictor) {
  if (!predictor || predictor <= 1) return bytes;
  const rowSize = Math.ceil((columns * colors * bpc) / 8);
  if (rowSize <= 0) return bytes;

  if (predictor === 2) {
    if (bpc !== 8) throw new Error("tiff-predictor");
    const out = bytes.slice();
    const height = Math.floor(bytes.length / rowSize);
    for (let y = 0; y < height; y += 1) {
      const row = y * rowSize;
      for (let i = colors; i < rowSize; i += 1) {
        out[row + i] = (out[row + i] + out[row + i - colors]) & 0xff;
      }
    }
    return out;
  }

  if (predictor < 10 || predictor > 15) throw new Error("predictor");

  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const stride = rowSize + 1;
  const height = Math.floor(bytes.length / stride);
  const out = new Uint8Array(rowSize * height);
  let prev = new Uint8Array(rowSize);

  for (let y = 0; y < height; y += 1) {
    const type = bytes[y * stride];
    const filt = bytes.subarray(y * stride + 1, y * stride + 1 + rowSize);
    const recon = out.subarray(y * rowSize, y * rowSize + rowSize);
    for (let i = 0; i < rowSize; i += 1) {
      const a = i >= bpp ? recon[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (type === 1) add = a;
      else if (type === 2) add = b;
      else if (type === 3) add = (a + b) >> 1;
      else if (type === 4) add = paeth(a, b, c);
      recon[i] = (filt[i] + add) & 0xff;
    }
    prev = recon;
  }
  return out;
}

/**
 * @param {Uint8Array} packed
 * @param {number} width
 * @param {number} height
 * @param {number} bpc
 * @param {number} channels
 */
function unpackSamples(packed, width, height, bpc, channels, scaleTo8 = true) {
  const samples = width * channels;
  const out = new Uint8Array(width * height * channels);
  const max = (1 << Math.min(bpc, 8)) - 1;
  const toByte = (v) => (scaleTo8 && bpc < 8 && max ? Math.round((v / max) * 255) : v);

  if (bpc === 8) {
    const rowBytes = samples;
    for (let y = 0; y < height; y += 1) {
      out.set(packed.subarray(y * rowBytes, y * rowBytes + samples), y * samples);
    }
    return out;
  }
  if (bpc === 16) {
    const rowBytes = samples * 2;
    let o = 0;
    for (let y = 0; y < height; y += 1) {
      const row = packed.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let i = 0; i < samples; i += 1) out[o++] = row[i * 2];
    }
    return out;
  }

  const rowBytes = Math.ceil((samples * bpc) / 8);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    const row = packed.subarray(y * rowBytes, (y + 1) * rowBytes);
    let bit = 0;
    for (let s = 0; s < samples; s += 1) {
      let v = 0;
      for (let b = 0; b < bpc; b += 1) {
        const byte = row[(bit / 8) | 0] || 0;
        v = (v << 1) | ((byte >> (7 - (bit % 8))) & 1);
        bit += 1;
      }
      out[o++] = toByte(v);
    }
  }
  return out;
}

function cmykToRgb(samples, pixels) {
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0, p = 0; i < pixels; i += 1, p += 3) {
    const c = samples[i * 4] / 255;
    const m = samples[i * 4 + 1] / 255;
    const y = samples[i * 4 + 2] / 255;
    const k = samples[i * 4 + 3] / 255;
    rgb[p] = Math.round(255 * (1 - c) * (1 - k));
    rgb[p + 1] = Math.round(255 * (1 - m) * (1 - k));
    rgb[p + 2] = Math.round(255 * (1 - y) * (1 - k));
  }
  return rgb;
}

function expandIndexed(indexes, table, comps, hival) {
  const pixels = indexes.length;
  const out = new Uint8Array(pixels * comps);
  const maxIndex = Math.min(hival, Math.max(0, Math.floor(table.length / comps) - 1));
  for (let i = 0; i < pixels; i += 1) {
    const index = Math.min(maxIndex, indexes[i] | 0);
    const src = index * comps;
    out.set(table.subarray(src, src + comps), i * comps);
  }
  return { samples: out, channels: comps };
}

function engines() {
  const pdfLib = lib();
  if (!pdfLib) throw new Error("PDF engines missing");
  return pdfLib;
}

function filterChain(dict, pdfLib) {
  const { PDFName, PDFArray } = pdfLib;
  const filter = dict.lookup(PDFName.of("Filter"));
  const parms = dict.lookup(PDFName.of("DecodeParms")) || dict.lookup(PDFName.of("DP"));
  /** @type {string[]} */
  const names = [];
  /** @type {any[]} */
  const parmList = [];

  if (!filter) return { names, parmList };
  if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i += 1) {
      names.push(asName(filter.lookup(i)));
      parmList.push(parms instanceof PDFArray ? parms.lookup(i) : i === 0 ? parms : undefined);
    }
  } else {
    names.push(asName(filter));
    parmList.push(parms);
  }
  return { names, parmList };
}

/** @param {any} stream @param {any} pdfLib @param {any} context */
function decodePrefix(stream, pdfLib, context, stopIndex) {
  const { PDFName, PDFRawStream, decodePDFRawStream } = pdfLib;
  let bytes = stream.getContents();
  const { names, parmList } = filterChain(stream.dict, pdfLib);
  const end = stopIndex < 0 ? names.length : stopIndex;
  for (let i = 0; i < end; i += 1) {
    const dict = context.obj({ Filter: names[i], Length: bytes.length });
    if (parmList[i]) dict.set(PDFName.of("DecodeParms"), parmList[i]);
    bytes = decodePDFRawStream(PDFRawStream.of(dict, bytes)).decode();
  }
  return bytes;
}

function lookupBytes(obj, context, pdfLib) {
  const resolved = context.lookup(obj);
  if (!resolved) return new Uint8Array(0);
  if (typeof resolved.getContents === "function") {
    try {
      return decodePrefix(resolved, pdfLib, context, -1);
    } catch {
      return resolved.getContents();
    }
  }
  if (typeof resolved.asBytes === "function") return resolved.asBytes();
  if (typeof resolved.decodeText === "function") {
    const text = resolved.decodeText();
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

function colorSpaceInfo(cs, context, pdfLib) {
  const resolved = context.lookup(cs);
  if (!resolved) return { kind: "rgb", channels: 3 };
  if (typeof resolved.size !== "function") {
    const n = asName(resolved);
    if (n === "DeviceGray" || n === "CalGray") return { kind: "gray", channels: 1 };
    if (n === "DeviceCMYK") return { kind: "cmyk", channels: 4 };
    return { kind: "rgb", channels: 3 };
  }
  const head = asName(resolved.get(0));
  if (head === "ICCBased") {
    const profile = context.lookup(resolved.get(1));
    const n = asNumber(profile?.dict?.lookup(pdfLib.PDFName.of("N"))) || 3;
    if (n === 1) return { kind: "gray", channels: 1 };
    if (n === 4) return { kind: "cmyk", channels: 4 };
    return { kind: "rgb", channels: 3 };
  }
  if (head === "Indexed") {
    const base = colorSpaceInfo(resolved.get(1), context, pdfLib);
    const hival = asNumber(resolved.get(2)) ?? 255;
    const table = lookupBytes(resolved.get(3), context, pdfLib);
    return { kind: "indexed", channels: 1, base, hival, table };
  }
  if (head === "CalRGB" || head === "Lab") return { kind: "rgb", channels: 3 };
  if (head === "DeviceN" || head === "Separation" || head === "Pattern") {
    return { kind: "unsupported", channels: 0 };
  }
  return { kind: "rgb", channels: 3 };
}

function lastImageCodec(names) {
  for (let i = names.length - 1; i >= 0; i -= 1) {
    if (IMAGE_CODECS.has(names[i])) return { codec: names[i], index: i };
  }
  return null;
}

/** @param {any} stream @param {any} smaskGray @param {number} width @param {number} height */
async function samplesToPng(samples, channels, width, height, smaskGray) {
  let pixels = samples;
  let ch = channels;
  if (ch === 4 && !smaskGray) {
    pixels = cmykToRgb(samples, width * height);
    ch = 3;
  }
  if (smaskGray && smaskGray.length >= width * height) {
    const rgba = new Uint8Array(width * height * 4);
    if (ch === 1) {
      for (let i = 0; i < width * height; i += 1) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = pixels[i];
        rgba[i * 4 + 3] = smaskGray[i];
      }
    } else {
      for (let i = 0; i < width * height; i += 1) {
        rgba[i * 4] = pixels[i * 3];
        rgba[i * 4 + 1] = pixels[i * 3 + 1];
        rgba[i * 4 + 2] = pixels[i * 3 + 2];
        rgba[i * 4 + 3] = smaskGray[i];
      }
    }
    return encodePng(rgba, width, height, 4);
  }
  return encodePng(pixels, width, height, /** @type {1|3} */ (ch === 1 ? 1 : 3));
}

async function decodeSMask(stream, context, pdfLib, width, height) {
  const { PDFName } = pdfLib;
  const smask = stream.dict.lookup(PDFName.of("SMask"));
  if (!smask || asName(smask) === "None") return null;
  const mask = context.lookup(smask);
  if (!mask?.dict) return null;
  try {
    const packed = decodePixelStream(mask, context, pdfLib);
    return unpackSamples(packed.bytes, width, height, packed.bpc, 1);
  } catch {
    return null;
  }
}

function decodePixelStream(stream, context, pdfLib) {
  const { PDFName } = pdfLib;
  const width = asNumber(stream.dict.lookup(PDFName.of("Width"))) || 0;
  const height = asNumber(stream.dict.lookup(PDFName.of("Height"))) || 0;
  const bpc = asNumber(stream.dict.lookup(PDFName.of("BitsPerComponent"))) || 8;
  const { names, parmList } = filterChain(stream.dict, pdfLib);
  const codec = lastImageCodec(names);
  if (codec) throw new Error(codec.codec);
  let bytes = decodePrefix(stream, pdfLib, context, -1);
  const lastParm = parmList[parmList.length - 1];
  const predictor = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Predictor"))) || 1;
  const columns = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Columns"))) || width;
  const colors = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Colors"))) || 1;
  const parmBpc = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("BitsPerComponent"))) || bpc;
  if (predictor > 1) bytes = undoPredictor(bytes, columns, colors, parmBpc, predictor);
  return { bytes, width, height, bpc };
}

/**
 * @param {any} stream
 * @param {any} context
 * @param {any} pdfLib
 * @param {number} pageNumber
 */
async function extractXObject(stream, context, pdfLib, pageNumber) {
  const { PDFName } = pdfLib;
  const width = asNumber(stream.dict.lookup(PDFName.of("Width"))) || 0;
  const height = asNumber(stream.dict.lookup(PDFName.of("Height"))) || 0;
  if (width < 2 || height < 2) return { skip: true };
    const imageMask = stream.dict.lookup(PDFName.of("ImageMask"));
    if (imageMask && typeof imageMask.asBoolean === "function" && imageMask.asBoolean()) return { skip: true };

  const { names } = filterChain(stream.dict, pdfLib);
  const codec = lastImageCodec(names);

  if (codec?.codec === "DCTDecode") {
    const bytes = decodePrefix(stream, pdfLib, context, codec.index);
    if (!looksLikeJpeg(bytes)) return { pending: { width, height, page: pageNumber } };
    return {
      image: {
        width,
        height,
        bytes,
        ext: "jpg",
        saveKind: "jpeg",
        mime: "image/jpeg",
        formatLabel: "JPEG",
        provenance: "original",
        pages: [pageNumber]
      }
    };
  }

  if (codec?.codec === "JPXDecode") {
    const bytes = decodePrefix(stream, pdfLib, context, codec.index);
    return {
      image: {
        width,
        height,
        bytes,
        ext: "jp2",
        saveKind: "jp2",
        mime: "image/jp2",
        formatLabel: "JP2",
        provenance: "original",
        pages: [pageNumber]
      }
    };
  }

  if (codec) return { pending: { width, height, page: pageNumber } };

  try {
    const space = colorSpaceInfo(stream.dict.lookup(PDFName.of("ColorSpace")), context, pdfLib);
    if (space.kind === "unsupported") return { pending: { width, height, page: pageNumber } };
    const packed = decodePixelStream(stream, context, pdfLib);
    const rowBytes = Math.ceil((width * (space.kind === "indexed" ? 1 : space.channels) * packed.bpc) / 8);
    if (packed.bytes.length < rowBytes * height) throw new Error("short-stream");
    let channels = space.kind === "indexed" ? 1 : space.channels;
    let samples = unpackSamples(packed.bytes, width, height, packed.bpc, channels, space.kind !== "indexed");
    if (space.kind === "indexed") {
      const expanded = expandIndexed(samples, space.table, space.base.channels, space.hival);
      samples = expanded.samples;
      channels = expanded.channels;
      if (space.base.kind === "cmyk") {
        samples = cmykToRgb(samples, width * height);
        channels = 3;
      }
    } else if (space.kind === "cmyk") {
      samples = cmykToRgb(samples, width * height);
      channels = 3;
    }
    const smask = await decodeSMask(stream, context, pdfLib, width, height);
    const bytes = await samplesToPng(samples, channels, width, height, smask);
    return {
      image: {
        width,
        height,
        bytes,
        ext: "png",
        saveKind: "png",
        mime: "image/png",
        formatLabel: "PNG",
        provenance: "reconstructed",
        pages: [pageNumber]
      }
    };
  } catch {
    return { pending: { width, height, page: pageNumber } };
  }
}

async function walkAppearance(ap, context, pageNumber, visit) {
  const resolved = context.lookup(ap);
  if (!resolved) return;
  if (typeof resolved.getContents === "function") {
    await visit(resolved, pageNumber);
    return;
  }
  if (typeof resolved.entries !== "function") return;
  for (const [, value] of resolved.entries()) {
    const inner = context.lookup(value);
    if (typeof inner?.getContents === "function") await visit(inner, pageNumber);
    else if (inner && typeof inner.entries === "function") {
      for (const [, nested] of inner.entries()) await visit(context.lookup(nested), pageNumber);
    }
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {string} [options.password]
 * @param {(info: { stage: string; page: number; pages: number; percent: number }) => void} [options.onProgress]
 */
export async function extractEmbeddedImages(bytes, options = {}) {
  const pdfLib = engines();
  const { PDFName, PDFDict, PDFArray } = pdfLib;
  const password = options.password || "";
  const onProgress = options.onProgress;

  /** @type {Map<string, any>} */
  const images = new Map();
  /** @type {Array<{ width: number; height: number; page: number }>} */
  const pending = [];
  const seenForms = new Set();
  const seenImages = new Set();
  let pagesTotal = 1;

  const visit = async (obj, pageNumber) => {
    if (!obj?.dict) return;
    const subtype = asName(obj.dict.lookup(PDFName.of("Subtype")));
    if (subtype === "Form") {
      const key = refKey(context.getObjectRef(obj)) || `form-${pageNumber}-${seenForms.size}`;
      if (seenForms.has(key)) return;
      seenForms.add(key);
      await walkResources(obj.dict.lookup(PDFName.of("Resources")), pageNumber);
      return;
    }
    if (subtype !== "Image") return;
    const key = refKey(context.getObjectRef(obj));
    if (key && images.has(key)) {
      const hit = images.get(key);
      if (!hit.pages.includes(pageNumber)) hit.pages.push(pageNumber);
      return;
    }
    if (key && seenImages.has(key)) return;
    if (key) seenImages.add(key);
    const result = await extractXObject(obj, context, pdfLib, pageNumber);
    if (result.skip) return;
    if (result.pending) {
      pending.push(result.pending);
      return;
    }
    images.set(key || `img-${images.size}`, result.image);
  };

  /** @type {any} */
  let context;

  async function walkResources(resources, pageNumber) {
    if (!resources || !(resources instanceof PDFDict)) return;
    const xobjects = resources.lookup(PDFName.of("XObject"));
    if (xobjects instanceof PDFDict) {
      for (const [, value] of xobjects.entries()) {
        await visit(context.lookup(value), pageNumber);
      }
    }
  }

  try {
    const pdf = await loadWritable(bytes);
    context = pdf.context;
    const pages = pdf.getPages();
    pagesTotal = pages.length || 1;

    for (let i = 0; i < pages.length; i += 1) {
      const pageNumber = i + 1;
      onProgress?.({
        stage: "xobjects",
        page: pageNumber,
        pages: pagesTotal,
        percent: (pageNumber / pagesTotal) * 55
      });
      await tick(i, 1);
      await walkResources(pages[i].node.Resources(), pageNumber);

      const annots = pages[i].node.Annots?.();
      if (annots instanceof PDFArray) {
        for (let a = 0; a < annots.size(); a += 1) {
          const annot = context.lookup(annots.get(a));
          if (!annot || typeof annot.lookup !== "function") continue;
          await walkAppearance(annot.lookup(PDFName.of("AP")), context, pageNumber, visit);
        }
      }
    }
  } catch {
    // Encrypted or unreadable structure — pdf.js still sees decoded images.
  }

  onProgress?.({ stage: "operators", page: 0, pages: pagesTotal, percent: 58 });
  const jsImages = await collectPdfJsImages(bytes, password, ({ page, pages }) => {
    onProgress?.({
      stage: "operators",
      page,
      pages,
      percent: 58 + (page / Math.max(1, pages)) * 40
    });
  });

  const usedJs = new Set();
  const takeJs = (match) => {
    usedJs.add(match.key);
    images.set(match.key, {
      width: match.width,
      height: match.height,
      bytes: match.bytes,
      ext: "png",
      saveKind: "png",
      mime: "image/png",
      formatLabel: "PNG",
      provenance: match.inline ? "inline" : "reconstructed",
      pages: match.pages
    });
  };

  for (const miss of pending) {
    const match =
      jsImages.find(
        (item) =>
          !usedJs.has(item.key) &&
          item.width === miss.width &&
          item.height === miss.height &&
          item.pages.includes(miss.page)
      ) ||
      jsImages.find(
        (item) => !usedJs.has(item.key) && item.width === miss.width && item.height === miss.height
      );
    if (match) takeJs(match);
  }

  if (images.size === 0) {
    for (const item of jsImages) {
      images.set(item.key, {
        width: item.width,
        height: item.height,
        bytes: item.bytes,
        ext: "png",
        saveKind: "png",
        mime: "image/png",
        formatLabel: "PNG",
        provenance: item.inline ? "inline" : "reconstructed",
        pages: item.pages
      });
    }
  } else {
    for (const item of jsImages) {
      if (!item.inline || usedJs.has(item.key)) continue;
      images.set(item.key, {
        width: item.width,
        height: item.height,
        bytes: item.bytes,
        ext: "png",
        saveKind: "png",
        mime: "image/png",
        formatLabel: "PNG",
        provenance: "inline",
        pages: item.pages
      });
    }
  }

  onProgress?.({ stage: "done", page: pagesTotal, pages: pagesTotal, percent: 100 });

  return [...images.values()].sort((a, b) => {
    const page = (a.pages[0] || 0) - (b.pages[0] || 0);
    if (page) return page;
    return b.width * b.height - a.width * a.height;
  });
}
