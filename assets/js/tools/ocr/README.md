# Searchable PDF — OCR (`ocr`)

Self-contained tool for PDF Studio. Tesseract.js with **Arabic + English** (`ara+eng`) writes an **invisible text layer** on top of the original pages so the file becomes searchable and copyable without changing how it looks.

This is **not** “extract existing text to `.txt`”. That is a different tool (`pdf-to-text`).

Free, local, RTL Arabic UI. No network after install.

## Files

| File | Role |
|---|---|
| `manifest.js` | `{ id, title, mount, unmount }` plus router helpers |
| `hub-fragment.html` | View markup to paste into `index.html` |
| `ocr.js` | Load, options, run, save |
| `engine.js` | Tesseract worker (dynamic import) |
| `overlay.js` | Word boxes → Type3 invisible text (no fontkit) |
| `paths.js` | Worker / core / tessdata URLs |
| `copy-runtime.mjs` | Copy WASM + download `ara`/`eng` tessdata |

Do not import this folder from other tools.

## Offline setup (required)

Electron only serves `assets/` and `index.html`. `node_modules` is not on the loopback server and is not packed into the desktop build.

From the **repo root**, after `npm install tesseract.js`:

```bash
node assets/js/tools/ocr/copy-runtime.mjs
```

That script:

1. Copies from `node_modules` into `assets/vendor/tesseract/`:
   - `tesseract.esm.min.js` — API loaded by the renderer (`import()`)
   - `worker.min.js` — Web Worker (`workerPath`)
   - LSTM cores the worker picks among (do **not** point `corePath` at a single `.js` file):
     - `tesseract-core-lstm.wasm.js` + `.wasm`
     - `tesseract-core-simd-lstm.wasm.js` + `.wasm`
     - `tesseract-core-relaxedsimd-lstm.wasm.js` + `.wasm`
2. Downloads **tessdata_fast** into `assets/vendor/tessdata/` (skips files already present):
   - `ara.traineddata`
   - `eng.traineddata`

Re-run the script after upgrading `tesseract.js`.

### Worker / tessdata paths (already set in `paths.js`)

| Option | Value | Notes |
|---|---|---|
| `workerPath` | `/assets/vendor/tesseract/worker.min.js` | Absolute URL via `import.meta.url` |
| `corePath` | `/assets/vendor/tesseract` | **Directory**, no trailing filename |
| `langPath` | `/assets/vendor/tessdata` | Fetches `{lang}.traineddata` |
| `gzip` | `false` | Uncompressed `.traineddata` |
| `cacheMethod` | `none` | Always read the vendored files |
| `workerBlobURL` | `false` | Classic `new Worker(workerPath)` so CSP `worker-src 'self'` applies. Blob workers + `importScripts` are brittle under this app’s CSP. |

Languages: `ara+eng`. OEM: LSTM only (`1`). tessdata_fast is LSTM; do not request the legacy engine.

### Electron (do not edit)

Current `electron/main.cjs` already allows this load path:

- Serves `assets/` (wasm MIME `application/wasm`, other binaries as octet-stream)
- CSP: `script-src 'self'`, `worker-src 'self' blob:`, `connect-src 'self' blob: data:`

No Electron change is required. If a worker fails to start, confirm `copy-runtime.mjs` was run and that those `assets/vendor/**` files exist on disk.

## Integrator steps

Nothing in this folder is wired until you paste the fragment, copy the runtime, and register the manifest. **Do not** change files inside this folder to hook it up.

### 1. Vendor the runtime

```bash
npm install tesseract.js
node assets/js/tools/ocr/copy-runtime.mjs
```

### 2. Paste the view

Copy the `<section id="view-ocr">` from `hub-fragment.html` into `index.html` next to the other `.view` sections.

Legend icon is `icon-file` (already in the sprite). You may add a dedicated OCR glyph later and change `icon` in `manifest.js`.

### 3. Register the tool

In `assets/js/main.js`:

```js
import ocrManifest from "./tools/ocr/manifest.js";

registerTools([
  // …existing tools,
  {
    id: ocrManifest.id,
    name: ocrManifest.title,
    icon: ocrManifest.icon,
    input: ocrManifest.input,
    actionLabel: ocrManifest.actionLabel,
    outputName: ocrManifest.outputName,
    setup: () => ocrManifest.mount(),
    enter: () => ocrManifest.enter(),
    leave: () => ocrManifest.leave(),
    run: () => ocrManifest.run()
  }
]);
```

Call `mount()` once from `setup`. **Do not** call `unmount()` on route leave — that would drop the open file and kill the Tesseract worker. Use `unmount()` only if the whole tool is being destroyed.

### 4. Title block

`enter` / `run` talk to the existing title block (`تعرّف وحفظ`, suggested name `…-قابل-للبحث.pdf`). The in-panel save button hides itself when `#tb-run` is present.

## Behaviour

- One PDF. Original pages are kept (`pdf-lib` load + overlay). Appearance does not become a raster of the page.
- pdf.js renders each selected page at 150 / 200 / 300 DPI → Tesseract → **word** boxes (not full lines) drawn with PDF text rendering mode 3.
- Arabic uses a glyph-less Type3 font + ToUnicode (StandardFonts cannot encode Arabic; `@pdf-lib/fontkit` is not a dependency).
- Optional page ranges (`1-3, 5`). Optional skip of pages that already have a digital text layer (~24+ characters).
- Honest quality: clear printed Arabic is usually fine; handwriting and dark photos are weak.

## Manifest

```js
{
  id: "ocr",
  title: "PDF قابل للبحث",
  mount(root?),   // wire intake; no-op if the fragment is missing
  unmount(),      // close file + terminate worker
  enter(),
  leave(),        // no-op (keeps state)
  run()
}
```
