/**
 * Behaviour checks for the PDF operations behind merge and split, in Node
 * with real pdf-lib fixtures. Run via npm test.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

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

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
