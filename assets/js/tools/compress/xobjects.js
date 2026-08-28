/**
 * Recompress Image XObjects in place and leave text / vectors untouched.
 * No DOM — the caller injects JPEG encode (canvas in the app, a stub in tests).
 */

const IMAGE_CODECS = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);

export function targetPixelSize(pageWidthPt, pageHeightPt, dpi) {
  const scale = Number(dpi) / 72;
  return {
    width: Math.max(1, Math.round(Number(pageWidthPt) * scale)),
    height: Math.max(1, Math.round(Number(pageHeightPt) * scale))
  };
}

export function fitImageSize(imgW, imgH, maxW, maxH) {
  const width = Math.max(1, Number(imgW) || 1);
  const height = Math.max(1, Number(imgH) || 1);
  const capW = Math.max(1, Number(maxW) || 1);
  const capH = Math.max(1, Number(maxH) || 1);
  const scale = Math.min(1, capW / width, capH / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}

export function savingsPercent(before, after) {
  if (!Number(before)) return 0;
  return Math.round((1 - Number(after) / Number(before)) * 100);
}

export function toGrayscaleRgba(rgba) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = Math.round((rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000);
    out[i] = out[i + 1] = out[i + 2] = luma;
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

export function scaleRgba(rgba, srcW, srcH, dstW, dstH) {
  const width = Math.max(1, dstW);
  const height = Math.max(1, dstH);
  if (srcW === width && srcH === height) return rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(srcH - 1, Math.floor((y * srcH) / height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(srcW - 1, Math.floor((x * srcW) / width));
      const si = (srcY * srcW + srcX) * 4;
      const di = (y * width + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

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

function asBoolean(obj) {
  return Boolean(obj && typeof obj.asBoolean === "function" && obj.asBoolean());
}

function refKey(ref) {
  if (!ref) return "";
  if (typeof ref.objectNumber === "number") return `${ref.objectNumber}.${ref.generationNumber || 0}`;
  return "";
}

function looksLikeJpeg(bytes) {
  return Boolean(bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8);
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

function unpackSamples(packed, width, height, bpc, channels) {
  const samples = width * channels;
  const out = new Uint8Array(width * height * channels);
  if (bpc === 8) {
    for (let y = 0; y < height; y += 1) out.set(packed.subarray(y * samples, y * samples + samples), y * samples);
    return out;
  }
  if (bpc === 16) {
    let o = 0;
    for (let y = 0; y < height; y += 1) {
      const row = packed.subarray(y * samples * 2, (y + 1) * samples * 2);
      for (let i = 0; i < samples; i += 1) out[o++] = row[i * 2];
    }
    return out;
  }
  const rowBytes = Math.ceil((samples * bpc) / 8);
  const max = (1 << Math.min(bpc, 8)) - 1;
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
      out[o++] = max ? Math.round((v / max) * 255) : v;
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
    out.set(table.subarray(index * comps, index * comps + comps), i * comps);
  }
  return { samples: out, channels: comps };
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
  if (head === "DeviceN" || head === "Separation" || head === "Pattern") {
    return { kind: "unsupported", channels: 0 };
  }
  return { kind: "rgb", channels: 3 };
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

function lastImageCodec(names) {
  for (let i = names.length - 1; i >= 0; i -= 1) {
    if (IMAGE_CODECS.has(names[i])) return { codec: names[i], index: i };
  }
  return null;
}

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

function rgbToRgba(samples, channels, width, height) {
  const count = width * height;
  const rgba = new Uint8ClampedArray(count * 4);
  if (channels === 1) {
    for (let i = 0; i < count; i += 1) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = samples[i];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  for (let i = 0, p = 0; i < count; i += 1, p += 3) {
    rgba[i * 4] = samples[p];
    rgba[i * 4 + 1] = samples[p + 1];
    rgba[i * 4 + 2] = samples[p + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function decodePixelStream(stream, context, pdfLib, width, height, space) {
  const packed = (() => {
    const { PDFName } = pdfLib;
    const bpc = asNumber(stream.dict.lookup(PDFName.of("BitsPerComponent"))) || 8;
    const { parmList } = filterChain(stream.dict, pdfLib);
    let bytes = decodePrefix(stream, pdfLib, context, -1);
    const lastParm = parmList[parmList.length - 1];
    const predictor = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Predictor"))) || 1;
    const columns = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Columns"))) || width;
    const colors = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("Colors"))) || 1;
    const parmBpc = asNumber(lastParm?.lookup?.(pdfLib.PDFName.of("BitsPerComponent"))) || bpc;
    if (predictor > 1) bytes = undoPredictor(bytes, columns, colors, parmBpc, predictor);
    return { bytes, bpc };
  })();

  let channels = space.kind === "indexed" ? 1 : space.channels;
  let samples = unpackSamples(packed.bytes, width, height, packed.bpc, channels);
  if (space.kind === "indexed") {
    const expanded = expandIndexed(samples, space.table, space.base.channels, space.hival);
    samples = expanded.samples;
    channels = expanded.channels;
    if (space.base.kind === "cmyk") {
      samples = cmykToRgb(samples, width * height);
      channels = 3;
    } else if (space.base.kind === "gray") channels = 1;
  } else if (space.kind === "cmyk") {
    samples = cmykToRgb(samples, width * height);
    channels = 3;
  }
  return rgbToRgba(samples, channels === 1 ? 1 : 3, width, height);
}

/**
 * @param {any} stream
 * @param {any} context
 * @param {any} pdfLib
 * @param {(bytes: Uint8Array, mime: string) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>} [decodeImage]
 */
async function decodeImageStream(stream, context, pdfLib, decodeImage) {
  const { PDFName } = pdfLib;
  const width = asNumber(stream.dict.lookup(PDFName.of("Width"))) || 0;
  const height = asNumber(stream.dict.lookup(PDFName.of("Height"))) || 0;
  if (width < 8 || height < 8) return null;
  if (asBoolean(stream.dict.lookup(PDFName.of("ImageMask")))) return null;

  const { names } = filterChain(stream.dict, pdfLib);
  const codec = lastImageCodec(names);

  if (codec?.codec === "DCTDecode") {
    const bytes = decodePrefix(stream, pdfLib, context, codec.index);
    if (!looksLikeJpeg(bytes) || !decodeImage) return null;
    const decoded = await decodeImage(bytes, "image/jpeg");
    if (!decoded?.data) return null;
    return { data: decoded.data, width: decoded.width || width, height: decoded.height || height };
  }

  if (codec) return null;

  const space = colorSpaceInfo(stream.dict.lookup(PDFName.of("ColorSpace")), context, pdfLib);
  if (space.kind === "unsupported") return null;
  try {
    const data = decodePixelStream(stream, context, pdfLib, width, height, space);
    return { data, width, height };
  } catch {
    return null;
  }
}

function replaceWithJpeg(stream, jpeg, width, height, pdfLib, context) {
  const { PDFName, PDFNumber, PDFRawStream } = pdfLib;
  const dict = stream.dict;
  dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
  dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
  dict.set(PDFName.of("Width"), PDFNumber.of(width));
  dict.set(PDFName.of("Height"), PDFNumber.of(height));
  dict.delete(PDFName.of("DecodeParms"));
  dict.delete(PDFName.of("Decode"));
  dict.delete(PDFName.of("ColorTransform"));
  dict.delete(PDFName.of("Name"));
  dict.delete(PDFName.of("Intent"));
  const ref = context.getObjectRef(stream);
  const next = PDFRawStream.of(dict, jpeg);
  if (ref) context.assign(ref, next);
  else stream.contents = jpeg;
}

function walkResources(resources, context, pdfLib, pageSize, images, seenForms, smasks) {
  const { PDFName, PDFDict } = pdfLib;
  if (!resources || !(resources instanceof PDFDict)) return;
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return;

  for (const [, value] of xobjects.entries()) {
    const stream = context.lookup(value);
    if (!stream?.dict) continue;
    const subtype = asName(stream.dict.lookup(PDFName.of("Subtype")));
    const key = refKey(context.getObjectRef(stream)) || "";
    if (subtype === "Form") {
      if (key && seenForms.has(key)) continue;
      if (key) seenForms.add(key);
      walkResources(stream.dict.lookup(PDFName.of("Resources")), context, pdfLib, pageSize, images, seenForms, smasks);
      continue;
    }
    if (subtype !== "Image") continue;
    const smask = stream.dict.lookup(PDFName.of("SMask"));
    const smaskObj = smask ? context.lookup(smask) : null;
    const smaskKey = refKey(context.getObjectRef(smaskObj));
    if (smaskKey) smasks.add(smaskKey);
    if (!key) continue;
    const hit = images.get(key);
    if (hit) {
      hit.pages.push(pageSize);
      continue;
    }
    images.set(key, { stream, pages: [pageSize] });
  }
}

/**
 * @param {import("pdf-lib").PDFDocument} pdf
 * @param {object} options
 * @param {typeof import("pdf-lib")} options.pdfLib
 * @param {number} [options.dpi]
 * @param {number} [options.quality]
 * @param {boolean} [options.grayscale]
 * @param {(image: { data: Uint8ClampedArray; width: number; height: number }, opts: { quality: number; grayscale: boolean }) => Promise<Uint8Array>} options.encodeJpeg
 * @param {(bytes: Uint8Array, mime: string) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>} [options.decodeImage]
 * @param {(rgba: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number) => Promise<Uint8ClampedArray> | Uint8ClampedArray} [options.resize]
 * @param {(info: { done: number; total: number }) => void} [options.onProgress]
 */
export async function recompressImageXObjects(pdf, options) {
  const pdfLib = options.pdfLib;
  if (!pdfLib) throw new Error("PDF engines missing");
  const encodeJpeg = options.encodeJpeg;
  if (typeof encodeJpeg !== "function") throw new Error("encodeJpeg");

  const dpi = Number(options.dpi) || 120;
  const quality = Number(options.quality);
  const grayscale = Boolean(options.grayscale);
  const context = pdf.context;
  /** @type {Map<string, { stream: any; pages: Array<{ width: number; height: number }> }>} */
  const images = new Map();
  const seenForms = new Set();
  const smasks = new Set();

  for (const page of pdf.getPages()) {
    const size = page.getSize();
    walkResources(page.node.Resources(), context, pdfLib, size, images, seenForms, smasks);
  }

  let seen = 0;
  let replaced = 0;
  let skipped = 0;
  const entries = [...images.entries()].filter(([key]) => !smasks.has(key));
  const total = entries.length;

  for (const [, item] of entries) {
    seen += 1;
    await options.onProgress?.({ done: seen - 1, total });
    const decoded = await decodeImageStream(item.stream, context, pdfLib, options.decodeImage);
    if (!decoded) {
      skipped += 1;
      continue;
    }

    let maxW = 1;
    let maxH = 1;
    for (const page of item.pages) {
      const cap = targetPixelSize(page.width, page.height, dpi);
      if (cap.width > maxW) maxW = cap.width;
      if (cap.height > maxH) maxH = cap.height;
    }
    const hasSMask = Boolean(item.stream.dict.lookup(pdfLib.PDFName.of("SMask")));
    const fitted = hasSMask
      ? { width: decoded.width, height: decoded.height, scale: 1 }
      : fitImageSize(decoded.width, decoded.height, maxW, maxH);
    let pixels = decoded.data;
    let width = decoded.width;
    let height = decoded.height;
    if (fitted.width !== width || fitted.height !== height) {
      const resized = options.resize
        ? await options.resize(pixels, width, height, fitted.width, fitted.height)
        : scaleRgba(pixels, width, height, fitted.width, fitted.height);
      pixels = resized;
      width = fitted.width;
      height = fitted.height;
    }
    if (grayscale) pixels = toGrayscaleRgba(pixels);

    const jpeg = await encodeJpeg(
      { data: pixels, width, height },
      { quality: Number.isFinite(quality) ? quality : 0.72, grayscale }
    );
    const original = item.stream.getContents();
    if (!jpeg || jpeg.length >= original.length) {
      skipped += 1;
      continue;
    }
    replaceWithJpeg(item.stream, jpeg, width, height, pdfLib, context);
    replaced += 1;
  }

  await options.onProgress?.({ done: total, total });
  return { seen, replaced, skipped, total };
}
