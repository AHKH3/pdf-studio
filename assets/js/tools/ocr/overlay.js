import { lib } from "../../pdf/core.js";

const EM = 1000;
const GLYPH_W = 500;
const MIN_CONFIDENCE = 40;
const MIN_BOX = 2;
const MAX_GLYPHS = 255;

function asBox(box) {
  if (!box) return null;
  if (typeof box.x0 === "number" && typeof box.y1 === "number") return box;
  if (Array.isArray(box) && box.length >= 4) {
    return { x0: box[0], y0: box[1], x1: box[2], y1: box[3] };
  }
  return null;
}

/**
 * Flatten tesseract.js v7 blocks → words (no top-level `data.words`).
 * @param {any} data
 */
export function collectWords(data) {
  /** @type {Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>} */
  const words = [];
  const push = (word) => {
    if (!word) return;
    const text = String(word.text ?? word.word ?? "")
      .replace(/\u0000/g, "")
      .trim();
    if (!text) return;
    const box = asBox(word.bbox);
    if (!box) return;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w < MIN_BOX || h < MIN_BOX) return;
    if (typeof word.confidence === "number" && word.confidence < MIN_CONFIDENCE) return;
    words.push({ text, confidence: word.confidence ?? 0, bbox: box });
  };

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.words)) node.words.forEach(push);
    for (const key of ["blocks", "paragraphs", "lines"]) {
      if (Array.isArray(node[key])) node[key].forEach(walk);
    }
  };

  walk(data);
  if (Array.isArray(data?.words)) data.words.forEach(push);
  return words;
}

function uniqueChars(words) {
  const seen = new Set();
  /** @type {string[]} */
  const chars = [];
  for (const word of words) {
    for (const ch of word.text) {
      if (ch === " " || ch === "\n" || ch === "\t") continue;
      if (seen.has(ch)) continue;
      seen.add(ch);
      chars.push(ch);
      if (chars.length >= MAX_GLYPHS) return chars;
    }
  }
  return chars;
}

function unicodeHex(ch) {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0xffff) return code.toString(16).padStart(4, "0").toUpperCase();
  const s = code - 0x10000;
  const hi = 0xd800 + (s >> 10);
  const lo = 0xdc00 + (s & 0x3ff);
  return (
    hi.toString(16).padStart(4, "0").toUpperCase() + lo.toString(16).padStart(4, "0").toUpperCase()
  );
}

function toUnicodeCmap(chars) {
  const chunks = [];
  for (let i = 0; i < chars.length; i += 100) {
    const slice = chars.slice(i, i + 100);
    chunks.push(`${slice.length} beginbfchar`);
    slice.forEach((ch, index) => {
      const src = (i + index + 1).toString(16).padStart(2, "0").toUpperCase();
      chunks.push(`<${src}> <${unicodeHex(ch)}>`);
    });
    chunks.push("endbfchar");
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
${chunks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/**
 * Type3 glyph-less font: equal-width empty glyphs + ToUnicode.
 * Avoids fontkit (pdf-lib StandardFonts cannot encode Arabic).
 * @param {any} pdfDoc
 * @param {string[]} chars
 */
function embedType3(pdfDoc, chars) {
  const P = lib();
  const context = pdfDoc.context;
  const names = chars.map((_, i) => `g${String(i + 1).padStart(2, "0")}`);

  const charProcs = context.obj({});
  for (const name of names) {
    const stream = context.flateStream(`${GLYPH_W} 0 d0\n`);
    charProcs.set(P.PDFName.of(name), context.register(stream));
  }

  const differences = [1, ...names.map((name) => P.PDFName.of(name))];
  const encoding = context.obj({ Type: "Encoding", Differences: differences });
  const toUnicode = context.register(context.flateStream(toUnicodeCmap(chars)));

  const fontDict = context.obj({
    Type: "Font",
    Subtype: "Type3",
    FontBBox: [0, 0, GLYPH_W, EM],
    FontMatrix: [1 / EM, 0, 0, 1 / EM, 0, 0],
    CharProcs: charProcs,
    Encoding: encoding,
    FirstChar: 1,
    LastChar: chars.length,
    Widths: chars.map(() => GLYPH_W),
    ToUnicode: toUnicode
  });

  const codeOf = new Map(chars.map((ch, i) => [ch, i + 1]));
  return {
    ref: context.register(fontDict),
    encode(text) {
      let hex = "";
      for (const ch of text) {
        const code = codeOf.get(ch);
        if (!code) continue;
        hex += code.toString(16).padStart(2, "0");
      }
      return hex;
    }
  };
}

function pdfPoint(viewport, x, y) {
  const point = viewport.convertToPdfPoint(x, y);
  if (Array.isArray(point)) return { x: point[0], y: point[1] };
  return { x: point.x, y: point.y };
}

/**
 * Invisible word boxes in PDF user space. Each Tesseract word is placed on its
 * own bbox (RTL-safe: no full-line reconstruction).
 * @param {any} pdfDoc
 * @param {any} page pdf-lib page
 * @param {any} viewport pdf.js viewport used to rasterize the page
 * @param {ReturnType<typeof collectWords>} words
 */
export function drawInvisibleWords(pdfDoc, page, viewport, words) {
  if (!words.length) return 0;
  const chars = uniqueChars(words);
  if (!chars.length) return 0;

  const P = lib();
  const font = embedType3(pdfDoc, chars);
  page.node.normalize();
  const fontName = page.node.newFontDictionary("Ocr", font.ref);

  let drawn = 0;
  for (const word of words) {
    const hex = font.encode(word.text);
    const glyphs = hex.length / 2;
    if (!glyphs) continue;

    const bl = pdfPoint(viewport, word.bbox.x0, word.bbox.y1);
    const br = pdfPoint(viewport, word.bbox.x1, word.bbox.y1);
    const tl = pdfPoint(viewport, word.bbox.x0, word.bbox.y0);
    const wVecX = br.x - bl.x;
    const wVecY = br.y - bl.y;
    const hVecX = tl.x - bl.x;
    const hVecY = tl.y - bl.y;
    const wLen = Math.hypot(wVecX, wVecY);
    const hLen = Math.hypot(hVecX, hVecY);
    if (wLen < 0.5 || hLen < 0.5) continue;

    const ux = wVecX / wLen;
    const uy = wVecY / wLen;
    const vx = hVecX / hLen;
    const vy = hVecY / hLen;
    const sx = (2 * wLen) / glyphs;
    const sy = hLen;

    page.pushOperators(
      P.pushGraphicsState(),
      P.beginText(),
      P.setTextRenderingMode(P.TextRenderingMode.Invisible),
      P.setFontAndSize(fontName, 1),
      P.setTextMatrix(ux * sx, uy * sx, vx * sy, vy * sy, bl.x, bl.y),
      P.showText(P.PDFHexString.of(hex)),
      P.endText(),
      P.popGraphicsState()
    );
    drawn += 1;
  }
  return drawn;
}
