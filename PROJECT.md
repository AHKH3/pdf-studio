# Project: PDF Studio TestSprite Testing & Defect Remediation

## Architecture
PDF Studio is an Electron desktop application running an isolated static server on `127.0.0.1` with strict CSP, COOP (`same-origin`), and COEP (`credentialless`). The frontend is built with vanilla ES modules (`assets/js/`) utilizing `pdf-lib`, `pdfjs-dist`, `sortablejs`, `qpdf-wasm`, and `tesseract.js`.
The user interface is entirely client-side, RTL Arabic-first, and falls back gracefully to standard browser downloads when running outside Electron (e.g., during TestSprite/Playwright testing).

### Protected Scope (Constraint R3)
- **FROZEN FILES**: `assets/js/tools/edit/*` (`app.js`, `board.js`, `coords.js`, `fit.js`, `flatten.js`, `manifest.js`, `text-png.js`, `ui.js`)
- **FROZEN DOM/CSS**: `#view-edit`, `.edit-root`, `.edit-workspace`, `.edit-stage`, `.edit-board`, `#edit-drop` in `index.html` and stylesheet files.
- **ZERO MODIFICATIONS** allowed in protected scope.

## Feature Inventory
| # | Feature / Tool | Description | Milestone | Source |
|---|----------------|-------------|-----------|--------|
| 1 | Central Hub (`start`) | File drop intake, file classification (PDF/images), route selection | M1, M2, M3 | Survey |
| 2 | Scan (`scan`) | 4-corner document detection, perspective transform, filters, upscale, PDF export | M1, M2, M3 | Survey |
| 3 | Images to PDF (`images`) | Multi-image to PDF with custom margins, sizes, and layout | M1, M2, M3 | Survey |
| 4 | Merge (`merge`) | Reorder and merge multiple PDFs with SortableJS | M1, M2, M3 | Survey |
| 5 | Organize (`organize`) | Page reordering, page deletion, page rotation (90° steps) | M1, M2, M3 | Survey |
| 6 | Split (`split`) | Split by single page, every N pages, or custom ranges (e.g. `1-3, 5`) | M1, M2, M3 | Survey |
| 7 | Compress (`compress`) | Raster downsampling with preset DPI levels (72, 144, 200) | M1, M2, M3 | Survey |
| 8 | Watermark (`watermark`) | Text watermark stamping with rotation, opacity, position grids | M1, M2, M3 | Survey |
| 9 | Page Numbers (`numbers`) | Page number stamping with Arabic/Latin templates, positions, margins | M1, M2, M3 | Survey |
| 10 | Rasterize (`rasterize`) | Render PDF pages to PNG/JPEG/WebP at 1x/2x/3x scale, ZIP / folder export | M1, M2, M3 | Survey |
| 11 | Sign (`sign`) | Interactive signature drawing canvas, stamp placement, date stamps, flattening | M1, M2, M3 | Survey |
| 12 | Protect & Unlock (`protect`) | AES-256 password encryption and password unlocking via QPDF WASM | M1, M2, M3 | Survey |
| 13 | Crop (`crop`) | Visual crop bounding box overlay per page or across document | M1, M2, M3 | Survey |
| 14 | Extract Images (`extract-images`) | Direct lossless stream extraction (JPEG, PNG, JP2) from PDF XObjects | M1, M2, M3 | Survey |
| 15 | OCR (`ocr`) | Searchable PDF text layer overlay generation via Tesseract.js | M1, M2, M3 | Survey |
| 16 | Edit (`edit`) | **PROTECTED SCOPE (R3)** - Page editing & markup | Excluded from changes | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | TestSprite MCP Generation & Execution | Run TestSprite MCP tools (code summary, standardized PRD, frontend test plan, test execution) across all accessible PDF tools. Record diagnostic reports. | None | IN_PROGRESS |
| 2 | Engine & Tool Defect Remediation | Fix rotation coordinates in Watermark & Numbers, Arabic/Unicode font fallback in Numbers, folder export collision handling in IPC, OCR multi-font capacity, thumbnail URL safety. Strictly preserve protected edit files. | M1 | PLANNED |
| 3 | Verification, Regression Hardening & Audit | Expand test harness (`npm test`), verify 100% pass across all test runners, conduct independent review, adversarial challenger tests, and forensic integrity audit. | M2 | PLANNED |

## Interface Contracts
### PDF Engine Coordinate Translation (`assets/js/pdf/core.js`, `watermark.js`, `numbers.js`)
- Input: `page.getRotation().angle`, `page.getSize()`, visual `(x, y)` position.
- Output: Exact PDF user space translation and rotation transform so visual orientation aligns with page layout on 0°, 90°, 180°, and 270° pages.
- Numbering Rendering: Uses `textToPng` canvas overlay when non-WinAnsi characters (such as Arabic digits `١، ٢، ٣` or Arabic text) are present.

### Desktop Save Folder Contract (`electron/main.cjs`)
- Input: `files = Array<{ name: string, data: ArrayBuffer }>`
- Behavior: Deduplicate duplicate file names by appending ` (1)`, ` (2)` to prevent silent overwrites.

## Code Layout
- `electron/`: Main process (`main.cjs`), preload script (`preload.cjs`).
- `assets/js/`:
  - `main.js`: App boot, engine initialization, routing.
  - `pdf/`: Core PDF abstractions (`core.js`, `unlock.js`, `render.js`).
  - `lib/`: Filesystem bridge (`files.js`), storage (`store.js`), errors (`errors.js`), worker pool (`pool.js`).
  - `tools/`: Tool controllers (`scan.js`, `merge.js`, `split.js`, `compress.js`, `watermark.js`, `numbers.js`, `rasterize.js`, `sign/*`, `protect/*`, `crop/*`, `extract-images/*`, `ocr/*`).
  - `tools/edit/*`: **PROTECTED SCOPE (R3)** - DO NOT MODIFY.
- `scripts/`: Node.js test scripts and build/vendor helpers.
- `testsprite_tests/`: TestSprite configuration, test plans, and execution reports.
