/**
 * End-to-end checks for the edit overlay's flatten step on REAL output files.
 *
 * The old suite only covered coordinate math, so regressions like "edits land
 * on the wrong page" or "vector overlays vanish from the saved file" passed
 * silently. Here we stamp shapes + ink onto a 3-page PDF with the production
 * flattenObjects(), save it, reload it, decode every page's content streams
 * and assert the drawing operators are on the pages they were placed on.
 *
 * Text/image overlays need a browser canvas, so they are covered by the skip
 * rules here (empty text must not touch the canvas path) and by code review;
 * the vector paths share the same per-page dispatch.
 */
import zlib from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRef, StandardFonts, degrees, rgb } from "pdf-lib";

/* ——— minimal browser stubs: updateProgress only needs settable elements ——— */
function fakeElement() {
  return {
    textContent: "",
    hidden: false,
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

globalThis.window = {
  PDFLib: { PDFDocument, rgb, degrees },
  "pdfjs-dist/build/pdf": { GlobalWorkerOptions: {} }
};
globalThis.document = { getElementById: () => fakeElement() };

const { initPdfEngines } = await import("../assets/js/pdf/core.js");
initPdfEngines();
const { flattenObjects } = await import("../assets/js/tools/edit/flatten.js");

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

/** Decoded content-stream text of one page. */
function pageText(doc, index) {
  const page = doc.getPage(index);
  const raw = page.node.get(PDFName.of("Contents"));
  const refs = raw instanceof PDFArray ? raw.asArray() : [raw];
  const parts = [];
  for (const ref of refs) {
    const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    const bytes = Buffer.from(stream.contents);
    try {
      parts.push(zlib.inflateSync(bytes).toString("latin1"));
    } catch {
      parts.push(bytes.toString("latin1"));
    }
  }
  return parts.join("\n");
}

console.log("\nedit flatten (production stamp → saved file → decoded pages)");

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 3; i += 1) {
  source.getPages()[i]?.constructor; // no-op guard
  const page = source.addPage([595, 842]);
  page.drawText(`original ${i + 1}`, { x: 72, y: 770, size: 24, font });
}
const inputBytes = await source.save();

/** Deliberately unordered: output must still route every object to its page. */
const objects = [
  { id: "tri", type: "shape", kind: "triangle", pageIndex: 2, x: 200, y: 300, width: 120, height: 90, rotation: 30, fill: "#BFDBFE", fillOn: true, stroke: "#1E3A8A", strokeWidth: 2 },
  { id: "ink", type: "ink", pageIndex: 1, x: 40, y: 40, width: 160, height: 100, rotation: 0, color: "#DC2626", strokeWidth: 3, points: [{ x: 50, y: 50 }, { x: 120, y: 120 }, { x: 190, y: 70 }] },
  { id: "rect", type: "shape", kind: "rect", pageIndex: 0, x: 50, y: 50, width: 100, height: 60, rotation: 0, fill: "#FDE68A", fillOn: true, stroke: "#111827", strokeWidth: 2 },
  { id: "ell", type: "shape", kind: "ellipse", pageIndex: 1, x: 300, y: 500, width: 140, height: 90, rotation: 0, fill: "#BBF7D0", fillOn: true, stroke: "#059669", strokeWidth: 2 },
  { id: "empty-text", type: "text", pageIndex: 1, x: 10, y: 10, width: 100, height: 30, rotation: 0, text: "   ", fontSize: 18, color: "#111827", bold: false, align: "right" },
  { id: "invisible", type: "shape", kind: "rect", pageIndex: 0, x: 10, y: 10, width: 40, height: 40, rotation: 0, fillOn: false, fill: "#fff", stroke: "#000", strokeWidth: 0 },
  { id: "ghost-page", type: "shape", kind: "rect", pageIndex: 9, x: 10, y: 10, width: 40, height: 40, rotation: 0, fill: "#fff", fillOn: true, stroke: "#000", strokeWidth: 1 }
];

const outBytes = await flattenObjects(inputBytes, objects);
check("output is a PDF", Buffer.from(outBytes.slice(0, 5)).toString() === "%PDF-");

const out = await PDFDocument.load(outBytes);
check("page count survives the stamp", out.getPageCount() === 3, `got ${out.getPageCount()}`);

const t0 = pageText(out, 0);
const t1 = pageText(out, 1);
const t2 = pageText(out, 2);

for (let i = 0; i < 3; i += 1) {
  check(`page ${i + 1} keeps its original text`, pageText(out, i).includes("Tj"), `page ${i}`);
}

check("page 1 carries the rectangle path (m/l/h + fill)", /m[\s\S]*l[\s\S]*h[\s\S]*(f|B)/.test(t0), t0.slice(0, 160));
check("page 2 carries the ellipse curves", /\bc\b/.test(t1) && /m[\s\S]*l/.test(t1));
check("page 2 carries the ink stroke (m/l + S)", /m[\s\S]*l[\s\S]*S/.test(t1));
check("page 3 carries the rotated triangle (h + fill)", /h[\s\S]*(f|B)/.test(t2));
check(
  "page-1-only operators did not leak onto page 2",
  !/\bh\b/.test(t1),
  t1.slice(0, 160)
);
check("output is larger than the input (paint actually added)", outBytes.length > inputBytes.length);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
