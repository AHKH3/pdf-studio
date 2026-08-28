/**
 * Behaviour checks for text-preserving PDF compression: downsample math and
 * in-place Image XObject jpegify via pdf-lib. Run via npm test.
 */
import { deflateSync } from "node:zlib";
import * as pdfLib from "pdf-lib";
import { PDFBool, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import {
  fitImageSize,
  recompressImageXObjects,
  savingsPercent,
  scaleRgba,
  targetPixelSize,
  toGrayscaleRgba
} from "../assets/js/tools/compress/xobjects.js";

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    let c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crcSlice = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(crcSlice), 8 + data.length);
  return out;
}

/** Opaque RGB PNG so pdf-lib does not attach an SMask. */
function makePng(width, height, fill) {
  const row = width * 3;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (row + 1);
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = offset + 1 + x * 3;
      const v = fill ? fill(x, y) : [(x * 13 + y * 7) & 255, (x * 3) & 255, (y * 11) & 255];
      raw[i] = v[0];
      raw[i + 1] = v[1];
      raw[i + 2] = v[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function asName(obj) {
  if (!obj) return "";
  const raw = typeof obj.asString === "function" ? obj.asString() : "";
  return String(raw).replace(/^\//, "");
}

function firstImageStream(pdf) {
  for (const page of pdf.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!xobjects || typeof xobjects.entries !== "function") continue;
    for (const [, value] of xobjects.entries()) {
      const stream = pdf.context.lookup(value);
      if (asName(stream?.dict?.lookup(PDFName.of("Subtype"))) === "Image") return stream;
    }
  }
  return null;
}

function contentHasText(latin, needle) {
  if (latin.includes(needle)) return true;
  const hex = Buffer.from(needle, "latin1").toString("hex").toUpperCase();
  return latin.toUpperCase().includes(hex);
}

function pageContentLatin(pdf) {
  const page = pdf.getPages()[0];
  const contents = page.node.Contents();
  const streams = [];
  if (contents && typeof contents.size === "function") {
    for (let i = 0; i < contents.size(); i += 1) streams.push(pdf.context.lookup(contents.get(i)));
  } else if (contents) {
    streams.push(pdf.context.lookup(contents));
  }
  let out = "";
  for (const stream of streams) {
    if (!stream?.dict) continue;
    try {
      out += Buffer.from(pdfLib.decodePDFRawStream(stream).decode()).toString("latin1");
    } catch {
      out += Buffer.from(stream.getContents()).toString("latin1");
    }
  }
  return out;
}

function countImages(pdf) {
  const seen = new Set();
  const visit = (resources) => {
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!xobjects || typeof xobjects.entries !== "function") return;
    for (const [, value] of xobjects.entries()) {
      const stream = pdf.context.lookup(value);
      const subtype = asName(stream?.dict?.lookup(PDFName.of("Subtype")));
      const ref = pdf.context.getObjectRef(stream);
      const key = ref ? `${ref.objectNumber}.${ref.generationNumber || 0}` : "";
      if (subtype === "Form") {
        if (key && seen.has(`form:${key}`)) continue;
        if (key) seen.add(`form:${key}`);
        visit(stream.dict.lookup(PDFName.of("Resources")));
        continue;
      }
      if (subtype !== "Image") continue;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
    }
  };
  for (const page of pdf.getPages()) visit(page.node.Resources());
  return [...seen].filter((key) => !key.startsWith("form:")).length;
}

async function makeTextAndImagePdf(width = 160, height = 120, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(makePng(width, height));
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText("Hello searchable", { x: 72, y: 770, size: 18, font });
    page.drawImage(image, { x: 72, y: 400, width: 200, height: 150 });
  }
  return doc;
}

function stubJpeg(label = "stub") {
  const payload = Buffer.from(`JPEG-${label}-${"x".repeat(24)}`);
  const out = new Uint8Array(2 + payload.length + 2);
  out[0] = 0xff;
  out[1] = 0xd8;
  out.set(payload, 2);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

console.log("\ncompress math");
{
  check("A4 @ 72 DPI is page points", targetPixelSize(595.28, 841.89, 72).width === 595 && targetPixelSize(595.28, 841.89, 72).height === 842);
  check("A4 @ 144 DPI doubles", targetPixelSize(595.28, 841.89, 144).width === 1191);

  const fit = fitImageSize(2000, 1000, 500, 800);
  check("downsamples to the limiting edge", fit.width === 500 && fit.height === 250, JSON.stringify(fit));
  check("does not upscale small images", fitImageSize(40, 30, 500, 800).width === 40);

  check("savings 50%", savingsPercent(100, 50) === 50);
  check("growth is negative", savingsPercent(100, 150) === -50);
  check("zero before is 0", savingsPercent(0, 10) === 0);
}

console.log("\ncompress pixels");
{
  const src = new Uint8ClampedArray([10, 20, 30, 255, 200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 200, 255]);
  const scaled = scaleRgba(src, 2, 2, 1, 1);
  check("nearest scale keeps top-left", scaled[0] === 10 && scaled[1] === 20 && scaled[2] === 30 && scaled.length === 4);

  const gray = toGrayscaleRgba(new Uint8ClampedArray([255, 0, 0, 255]));
  check("grayscale uses luma", gray[0] === gray[1] && gray[1] === gray[2] && gray[0] > 70 && gray[0] < 90);
}

console.log("\nrecompress Image XObjects (keeps text)");
{
  const source = await makeTextAndImagePdf(180, 140);
  const before = await source.save();
  const pdf = await PDFDocument.load(before);
  const calls = [];
  const result = await recompressImageXObjects(pdf, {
    pdfLib,
    dpi: 120,
    quality: 0.5,
    grayscale: false,
    encodeJpeg: async (image, options) => {
      calls.push({ width: image.width, height: image.height, quality: options.quality, grayscale: options.grayscale });
      return stubJpeg(`${image.width}x${image.height}`);
    }
  });
  const after = await pdf.save();
  const latin = pageContentLatin(pdf);
  const image = firstImageStream(pdf);

  check("reports the image it replaced", result.replaced === 1 && result.seen >= 1, JSON.stringify(result));
  check("output is smaller than the PNG original", after.length < before.length, `${after.length} vs ${before.length}`);
  check("keeps the literal text in the content stream", contentHasText(latin, "Hello searchable"), latin.slice(0, 180));
  check("switches the XObject filter to DCTDecode", asName(image?.dict.lookup(PDFName.of("Filter"))) === "DCTDecode");
  check("encoder ran once", calls.length === 1);
  check("encoder received the original pixel size", calls[0].width === 180 && calls[0].height === 140, JSON.stringify(calls[0]));
}

console.log("\nrecompress skips a replacement that would grow");
{
  const source = await makeTextAndImagePdf(32, 24);
  const pdf = await PDFDocument.load(await source.save());
  const original = firstImageStream(pdf);
  const originalFilter = asName(original.dict.lookup(PDFName.of("Filter")));
  const originalLen = original.getContents().length;
  const huge = new Uint8Array(originalLen + 8000);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[huge.length - 2] = 0xff;
  huge[huge.length - 1] = 0xd9;
  const result = await recompressImageXObjects(pdf, {
    pdfLib,
    dpi: 150,
    quality: 0.9,
    encodeJpeg: async () => huge
  });
  const kept = firstImageStream(pdf);
  check("does not count a larger JPEG as replaced", result.replaced === 0);
  check("leaves the original filter in place", asName(kept.dict.lookup(PDFName.of("Filter"))) === originalFilter);
}

console.log("\nrecompress shared XObject once + downsample");
{
  const source = await makeTextAndImagePdf(800, 800, 2);
  const pdf = await PDFDocument.load(await source.save());
  check("two pages share one image object", countImages(pdf) === 1);
  const calls = [];
  await recompressImageXObjects(pdf, {
    pdfLib,
    dpi: 72,
    quality: 0.4,
    grayscale: true,
    encodeJpeg: async (image, options) => {
      calls.push({ width: image.width, height: image.height, grayscale: options.grayscale });
      return stubJpeg("shared");
    }
  });
  check("encodes a shared image once", calls.length === 1);
  check("passes the grayscale flag", calls[0].grayscale === true);
  check(
    "downsamples a page-filling photo to the DPI cap",
    calls[0].width <= 595 && calls[0].height <= 595,
    JSON.stringify(calls[0])
  );
}

console.log("\nrecompress skips ImageMask stencils");
{
  const source = await makeTextAndImagePdf(64, 64);
  const pdf = await PDFDocument.load(await source.save());
  const image = firstImageStream(pdf);
  image.dict.set(PDFName.of("ImageMask"), PDFBool.True);
  let encoded = 0;
  const result = await recompressImageXObjects(pdf, {
    pdfLib,
    dpi: 72,
    quality: 0.4,
    encodeJpeg: async () => {
      encoded += 1;
      return stubJpeg("mask");
    }
  });
  check("does not jpegify a stencil mask", encoded === 0 && result.replaced === 0);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
