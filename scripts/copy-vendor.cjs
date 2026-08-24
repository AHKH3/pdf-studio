"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vendor = path.join(root, "assets", "vendor");

const copies = [
  ["pdf-lib/dist/pdf-lib.min.js", "pdf-lib.min.js"],
  ["sortablejs/Sortable.min.js", "Sortable.min.js"],
  ["pdfjs-dist/legacy/build/pdf.js", "pdf.js"],
  ["pdfjs-dist/legacy/build/pdf.worker.js", "pdf.worker.js"],
  ["heic2any/dist/heic2any.min.js", "heic2any.js"]
];

fs.mkdirSync(vendor, { recursive: true });

let ok = true;
for (const [rel, destName] of copies) {
  const src = path.join(root, "node_modules", rel);
  const dest = path.join(vendor, destName);
  if (!fs.existsSync(src)) {
    console.error("copy-vendor: missing", rel);
    ok = false;
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log("copy-vendor:", destName);
}
if (!ok) process.exit(1);
