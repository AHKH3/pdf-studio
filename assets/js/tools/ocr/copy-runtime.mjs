/**
 * Copies tesseract.js worker/core files and downloads tessdata_fast (ara+eng)
 * into assets/ so the Electron loopback server can serve them offline.
 *
 * Electron only exposes `assets/` and `index.html` — node_modules is not served
 * and is not packed into the desktop build.
 *
 * Usage (from the repo root):
 *   node assets/js/tools/ocr/copy-runtime.mjs
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const tessJs = path.join(root, "node_modules", "tesseract.js");
const tessCore = path.join(root, "node_modules", "tesseract.js-core");
const runtimeDest = path.join(root, "assets", "vendor", "tesseract");
const tessdataDest = path.join(root, "assets", "vendor", "tessdata");

const RUNTIME = [
  ["tesseract.js/dist/tesseract.esm.min.js", "tesseract.esm.min.js"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"]
];

/** LSTM-only cores: createWorker(..., 1) never loads the legacy (non-lstm) builds. */
const CORE = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm"
];

const LANGS = ["ara", "eng"];

const TESSDATA_URLS = (lang) => [
  `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${lang}.traineddata`,
  `https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/${lang}.traineddata`
];

function fail(message) {
  console.error("copy-ocr:", message);
  process.exit(1);
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function ensureLang(lang) {
  const dest = path.join(tessdataDest, `${lang}.traineddata`);
  if (existsSync(dest)) {
    const info = await stat(dest);
    if (info.size > 50_000) {
      console.log("copy-ocr: keep", `${lang}.traineddata`);
      return;
    }
  }
  let lastError = null;
  for (const url of TESSDATA_URLS(lang)) {
    try {
      console.log("copy-ocr: download", lang, "from", url);
      const bytes = await download(url);
      if (bytes.length < 50_000) throw new Error(`file too small (${bytes.length} bytes)`);
      writeFileSync(dest, bytes);
      console.log("copy-ocr:", `${lang}.traineddata`, `${(bytes.length / 1e6).toFixed(1)} MB`);
      return;
    } catch (error) {
      lastError = error;
      console.warn("copy-ocr: failed", String(error?.message || error));
    }
  }
  fail(`could not download ${lang}.traineddata (${lastError?.message || lastError})`);
}

if (!existsSync(path.join(tessJs, "dist", "worker.min.js"))) {
  fail("missing node_modules/tesseract.js. Run: npm install tesseract.js");
}
if (!existsSync(path.join(tessCore, "tesseract-core-simd-lstm.wasm.js"))) {
  fail("missing node_modules/tesseract.js-core. Re-run npm install tesseract.js");
}

mkdirSync(runtimeDest, { recursive: true });
mkdirSync(tessdataDest, { recursive: true });

for (const [rel, destName] of RUNTIME) {
  const from = path.join(root, "node_modules", rel);
  if (!existsSync(from)) fail(`missing ${rel}`);
  copyFileSync(from, path.join(runtimeDest, destName));
  console.log("copy-ocr:", destName);
}

for (const name of CORE) {
  const from = path.join(tessCore, name);
  if (!existsSync(from)) fail(`missing tesseract.js-core/${name}`);
  copyFileSync(from, path.join(runtimeDest, name));
  console.log("copy-ocr:", name);
}

await Promise.all(LANGS.map(ensureLang));
console.log("copy-ocr: done");
console.log("  runtime ", path.relative(root, runtimeDest));
console.log("  tessdata", path.relative(root, tessdataDest));
