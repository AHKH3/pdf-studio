/**
 * Copies qpdf-wasm's runtime into this folder so Electron can serve it.
 * Electron only exposes `assets/` and `index.html` — node_modules is not served
 * and is not packed into the desktop build.
 *
 * Usage (from the repo root):
 *   node assets/js/tools/protect/copy-qpdf.mjs
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const src = path.join(root, "node_modules", "qpdf-wasm");
const dest = path.join(here, "vendor");

const files = ["qpdf.js", "qpdf.wasm", "LICENSE"];

if (!existsSync(path.join(src, "qpdf.wasm"))) {
  console.error("copy-qpdf: missing node_modules/qpdf-wasm. Run: npm install qpdf-wasm");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const name of files) {
  const from = path.join(src, name);
  if (!existsSync(from)) {
    console.error("copy-qpdf: missing", name);
    process.exit(1);
  }
  copyFileSync(from, path.join(dest, name));
  console.log("copy-qpdf:", name);
}
