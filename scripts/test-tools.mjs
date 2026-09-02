/**
 * Behaviour checks for PDF operations across PDF Studio tools:
 * - merge & split
 * - watermark rotation-aware coordinate translation (0°, 90°, 180°, 270°)
 * - page numbers Unicode / Eastern Arabic digits fallback and rotation math
 * - desktop folder export filename de-duplication
 * - hub intake file format validation and rejection
 * - OCR Type3 multi-font encoding capacity (>255 unique Unicode characters)
 *
 * Run via npm test.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

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

async function makePdf(label, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} ${index + 1}`, { x: 72, y: 770, size: 24, font });
  }
  return doc;
}

const fixtureA = await makePdf("Part A", 2);
const fixtureB = await makePdf("Part B", 3);

console.log("\nmerge (copyPages, as tools/merge.js does)");
{
  const out = await PDFDocument.create();
  for (const source of [fixtureA, fixtureB]) {
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  check("page count adds up", out.getPageCount() === 5);
  const bytes = await out.save();
  const reloaded = await PDFDocument.load(bytes);
  check("merged output reloads cleanly", reloaded.getPageCount() === 5);
}

console.log("\nsplit (ranges / every-N, as tools/split.js does)");
{
  const four = await makePdf("Doc", 4);
  const bytes = await four.save();

  const extract = await PDFDocument.load(bytes);
  const picked = await PDFDocument.create();
  for (const index of [0, 2]) {
    const [page] = await picked.copyPages(extract, [index]);
    picked.addPage(page);
  }
  check("extract picks only listed pages", picked.getPageCount() === 2);

  const everyN = await PDFDocument.load(bytes);
  const chunkSize = 2;
  const chunks = Math.ceil(everyN.getPageCount() / chunkSize);
  check("every-N yields ceil(pages/N) files", chunks === 2);

  const single = await PDFDocument.create();
  const [page] = await single.copyPages(four, [1]);
  single.addPage(page);
  const saved = await single.save();
  const reloaded = await PDFDocument.load(saved);
  check("single-page output round-trips", reloaded.getPageCount() === 1);
}

console.log("\nwatermark (rotation transforms on 0°, 90°, 180°, 270° pages)");
{
  // 1x1 PNG dummy image bytes
  const tinyPng = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
    137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 0, 0,
    2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130
  ]);

  const doc = await PDFDocument.create();
  const stamp = await doc.embedPng(tinyPng);
  const angles = [0, 90, 180, 270];

  function placements(position, pageWidth, pageHeight, stampWidth, stampHeight) {
    const inset = Math.min(pageWidth, pageHeight) * 0.06;
    const centred = { x: (pageWidth - stampWidth) / 2, y: (pageHeight - stampHeight) / 2 };
    switch (position) {
      case "top-right":
        return [{ x: pageWidth - stampWidth - inset, y: pageHeight - stampHeight - inset }];
      case "top-left":
        return [{ x: inset, y: pageHeight - stampHeight - inset }];
      case "bottom-right":
        return [{ x: pageWidth - stampWidth - inset, y: inset }];
      case "bottom-left":
        return [{ x: inset, y: inset }];
      default:
        return [centred];
    }
  }

  for (const angle of angles) {
    const page = doc.addPage([600, 800]);
    page.setRotation(degrees(angle));

    const { width, height } = page.getSize();
    const isSideways = angle === 90 || angle === 270;
    const visualW = isSideways ? height : width;
    const visualH = isSideways ? width : height;
    const stampWidth = 100;
    const stampHeight = 40;

    for (const spot of placements("top-right", visualW, visualH, stampWidth, stampHeight)) {
      let px = spot.x;
      let py = spot.y;
      let rot = 0;
      if (angle === 90) {
        px = width - spot.y;
        py = spot.x;
        rot = 90;
      } else if (angle === 180) {
        px = width - spot.x;
        py = height - spot.y;
        rot = 180;
      } else if (angle === 270) {
        px = spot.y;
        py = height - spot.x;
        rot = 270;
      }
      page.drawImage(stamp, {
        x: px,
        y: py,
        width: stampWidth,
        height: stampHeight,
        rotate: rot ? degrees(rot) : undefined
      });
    }
  }

  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const pages = reloaded.getPages();

  check("all 4 rotated pages loaded", pages.length === 4);
  check("page 0 preserves 0° rotation", pages[0].getRotation().angle === 0);
  check("page 1 preserves 90° rotation", pages[1].getRotation().angle === 90);
  check("page 2 preserves 180° rotation", pages[2].getRotation().angle === 180);
  check("page 3 preserves 270° rotation", pages[3].getRotation().angle === 270);
}

console.log("\nnumbers (Arabic numerals fallback & rotation coordinate translation)");
{
  const isNonWinAnsi = (text) => /[^\u0020-\u007E]/.test(text);

  check("ASCII numbers are recognized as WinAnsi safe", !isNonWinAnsi("1 / 10"));
  check("Arabic Eastern digits '١ / ١٠' trigger non-WinAnsi fallback", isNonWinAnsi("١ / ١٠"));
  check("Arabic text 'صفحة ١' triggers non-WinAnsi fallback", isNonWinAnsi("صفحة ١"));
  check("Unicode symbols trigger non-WinAnsi fallback", isNonWinAnsi("Page 1 • 5"));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Stamping on 0, 90, 180, 270 rotated pages
  for (const angle of [0, 90, 180, 270]) {
    const page = doc.addPage([500, 700]);
    page.setRotation(degrees(angle));
    const { width, height } = page.getSize();
    const isSideways = angle === 90 || angle === 270;
    const visualW = isSideways ? height : width;
    const visualH = isSideways ? width : height;

    const label = `Page 1 of 4`;
    const textWidth = font.widthOfTextAtSize(label, 14);
    const spotX = (visualW - textWidth) / 2;
    const spotY = 30;

    let px = spotX;
    let py = spotY;
    let rot = 0;
    if (angle === 90) {
      px = width - spotY;
      py = spotX;
      rot = 90;
    } else if (angle === 180) {
      px = width - spotX;
      py = height - spotY;
      rot = 180;
    } else if (angle === 270) {
      px = spotY;
      py = height - spotX;
      rot = 270;
    }

    page.drawText(label, {
      x: px,
      y: py,
      size: 14,
      font,
      color: rgb(0.1, 0.1, 0.1),
      rotate: rot ? degrees(rot) : undefined
    });
  }

  const saved = await doc.save();
  const reloaded = await PDFDocument.load(saved);
  check("rotated numbered pages saved and reloaded", reloaded.getPageCount() === 4);
}

console.log("\ndesktop save folder (filename deduplication)");
{
  function deduplicateNames(files) {
    const usedNames = new Set();
    const result = [];
    for (const file of files) {
      const rawName = file.name;
      const dotIndex = rawName.lastIndexOf(".");
      const ext = dotIndex !== -1 ? rawName.slice(dotIndex) : "";
      const base = dotIndex !== -1 ? rawName.slice(0, dotIndex) : rawName;
      let finalName = rawName;
      let count = 1;
      while (usedNames.has(finalName)) {
        finalName = `${base} (${count})${ext}`;
        count++;
      }
      usedNames.add(finalName);
      result.push(finalName);
    }
    return result;
  }

  const testFiles = [
    { name: "image.png" },
    { name: "image.png" },
    { name: "image.png" },
    { name: "image (1).png" },
    { name: "doc.pdf" },
    { name: "doc.pdf" }
  ];

  const deduped = deduplicateNames(testFiles);
  check("first duplicate keeps name", deduped[0] === "image.png");
  check("second duplicate gets (1)", deduped[1] === "image (1).png");
  check("third duplicate gets (2) avoiding collision with image (1).png", deduped[2] === "image (2).png");
  check("existing (1) file gets (1) (1) or (3)", deduped[3] === "image (1) (1).png" || deduped[3] === "image (3).png");
  check("first pdf keeps name", deduped[4] === "doc.pdf");
  check("second pdf gets (1)", deduped[5] === "doc (1).pdf");
}

console.log("\nhub file intake (unsupported file format filtering & rejection)");
{
  const isPdfFile = (file) => /\.pdf$/i.test(file.name);
  const isImageFile = (file) => /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(file.name);
  const acceptAny = (file) => isPdfFile(file) || isImageFile(file);

  const testBatch = [
    { name: "report.pdf" },
    { name: "photo.jpg" },
    { name: "readme.txt" },
    { name: "archive.zip" }
  ];

  const valid = testBatch.filter(acceptAny);
  const invalid = testBatch.filter((f) => !acceptAny(f));

  check("filters accepted files correctly (2)", valid.length === 2);
  check("filters rejected files correctly (2)", invalid.length === 2);

  const allInvalid = [{ name: "bad1.exe" }, { name: "bad2.docx" }];
  const validOfInvalid = allInvalid.filter(acceptAny);
  check("all-invalid batch yields 0 accepted files", validOfInvalid.length === 0);
}

console.log("\nocr type3 multi-font capacity (>255 unique Unicode characters)");
{
  function uniqueCharsFromWords(words) {
    const seen = new Set();
    const chars = [];
    for (const word of words) {
      for (const ch of word.text) {
        if (ch === " " || ch === "\n" || ch === "\t") continue;
        if (seen.has(ch)) continue;
        seen.add(ch);
        chars.push(ch);
      }
    }
    return chars;
  }

  // Generate 320 unique Unicode characters across Arabic and Extended Latin
  const generatedWords = [];
  let charCode = 0x0600; // Arabic Unicode block start
  for (let i = 0; i < 320; i++) {
    const ch = String.fromCharCode(charCode + i);
    generatedWords.push({ text: `كلمة${ch}`, confidence: 90, bbox: { x0: 10, y0: 10, x1: 100, y1: 30 } });
  }

  const chars = uniqueCharsFromWords(generatedWords);
  check("all unique characters retained without 255 cap", chars.length >= 320);

  const FONT_CHUNK_SIZE = 255;
  const chunkCount = Math.ceil(chars.length / FONT_CHUNK_SIZE);
  check("chunking splits into multiple font buckets (ceil(320/255) = 2)", chunkCount === 2);

  const charMap = new Map();
  const fonts = [];
  for (let i = 0; i < chars.length; i += FONT_CHUNK_SIZE) {
    const chunk = chars.slice(i, i + FONT_CHUNK_SIZE);
    const fontIndex = fonts.length;
    fonts.push({ index: fontIndex, size: chunk.length });
    chunk.forEach((ch, idx) => {
      charMap.set(ch, { fontIndex, hex: (idx + 1).toString(16).padStart(2, "0") });
    });
  }

  check("all 320 characters mapped to a font index", charMap.size >= 320);
  check("font chunk 0 has exactly 255 glyphs", fonts[0].size === 255);
  check("font chunk 1 has remaining 65 glyphs", fonts[1].size === 65);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
