/**
 * AHK-63 — Global Error Handling & Memory Guard.
 * Node checks without DOM: error mapping, large-file gate, and static
 * wiring (dialog modal, canvas disposal, progress+cancel). Run via npm test.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LARGE_DOCUMENT_PAGES,
  LARGE_FILE_BYTES,
  shouldWarnLargeFile
} from "../assets/js/config.js";
import {
  friendlyMessage,
  isCorruptError,
  isEncryptedError,
  isMemoryError,
  isPasswordError,
  isScanError
} from "../assets/js/lib/errors.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** Line-ending immune source reads (LF/CRLF blobs × LF/CRLF checkouts). */
const norm = (s) => String(s).replace(/\r\n/g, "\n");
const src = (rel) => norm(readFileSync(join(ROOT, rel), "utf8"));

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

function group(name, body) {
  console.log(`\n${name}`);
  body();
}

group("error mapping (lib/errors.js)", () => {
  check("detects password errors", isPasswordError({ name: "PasswordException", message: "x" }));
  check("wrong-password copy is Arabic", friendlyMessage({ message: "Incorrect password" }, "f").includes("صحيحة"));
  check("detects encrypted errors", isEncryptedError({ name: "EncryptedPdfError", message: "x" }));
  check("detects corrupt PDFs", isCorruptError({ message: "Invalid PDF structure, missing xref" }));
  check("corrupt copy is Arabic", friendlyMessage({ message: "PDF is corrupt" }, "f").includes("تالف"));
  check("corrupt wins over scan-substring (format/mat)", friendlyMessage({ message: "Format error: bad xref" }, "f").includes("تالف"));
  check("detects memory errors", isMemoryError({ message: "Out of memory" }));
  check("memory copy is Arabic", friendlyMessage({ message: "allocation failed" }, "f").includes("ذاكرة"));
  check("detects OpenCV/scan errors", isScanError({ message: "OpenCV assertion failed" }));
  check("scan copy is Arabic", friendlyMessage({ message: "cv.warpPerspective failed" }, "f").includes("الصورة"));
  const cancel = Object.assign(new Error("cancelled"), { name: "CancelledError" });
  check("cancellations stay silent", friendlyMessage(cancel, "f") === null);
});

group("large-file gate (config.js)", () => {
  check("100MB threshold", LARGE_FILE_BYTES === 100 * 1024 * 1024);
  check("warns on huge bytes", shouldWarnLargeFile(LARGE_FILE_BYTES, 0) === true);
  check("warns on many pages", shouldWarnLargeFile(0, LARGE_DOCUMENT_PAGES) === true);
  check("small input stays quiet", shouldWarnLargeFile(1024, 3) === false);
});

group("retry wiring (static source checks)", () => {
  // Every idempotent run()/load() passes retry so the error modal's
  // retry button actually retries. Intentional exceptions (no retry):
  // organize addPdfs (partial insert would duplicate on retry),
  // scan multi-op flows, and the edit custom wrapper.
  const has = (rel, snippet) => src(rel).includes(snippet);
  check("merge add retries via acceptFiles", has("assets/js/tools/merge.js", "retry: () => acceptFiles(files)"));
  check("merge run retries", has("assets/js/tools/merge.js", "retry: () => run()"));
  check("organize run retries", has("assets/js/tools/organize.js", "retry: () => run()"));
  check("split load retries", has("assets/js/tools/split.js", "retry: () => load(files)"));
  check("split run retries", has("assets/js/tools/split.js", "retry: () => run()"));
  check("compress load retries", has("assets/js/tools/compress.js", "retry: () => load(files)"));
  check("compress run retries", has("assets/js/tools/compress.js", "retry: () => run()"));
  check("numbers load retries", has("assets/js/tools/numbers.js", "retry: () => load(files)"));
  check("numbers run retries", has("assets/js/tools/numbers.js", "retry: () => run()"));
  check("rasterize load retries", has("assets/js/tools/rasterize.js", "retry: () => load(files)"));
  check("rasterize exportOne retries the page", has("assets/js/tools/rasterize.js", "retry: () => exportOne(pageNumber)"));
  check("rasterize run retries", has("assets/js/tools/rasterize.js", "retry: () => run()"));
  check("extract-images load retries", has("assets/js/tools/extract-images/manifest.js", "retry: () => load(files)"));
  check("extract-images run retries", has("assets/js/tools/extract-images/manifest.js", "retry: () => run()"));
  check("crop load retries", has("assets/js/tools/crop/crop.js", "retry: () => load(files)"));
  check("crop run retries", has("assets/js/tools/crop/crop.js", "retry: () => run()"));
});

group("wiring (static source checks)", () => {
  const dialog = src("assets/js/ui/dialog.js");
  check("size confirm modal exists", dialog.includes("confirmLargeFile"));
  check("size copy mentions MB + cancel", dialog.includes("ميجابايت") && dialog.includes("إلغاء آمن"));
  check("error modal exists", dialog.includes("showError"));
  check("modal offers retry + home", dialog.includes("إعادة المحاولة") && dialog.includes("العودة للرئيسية"));

  const shared = src("assets/js/tools/shared.js");
  check("shared size gate exists", shared.includes("confirmHeavyFile"));
  check("readPdfFile guards size first", shared.includes("LARGE_FILE_BYTES"));
  check("reportFailure shows dialog on severe errors", shared.includes("showError"));

  const dom = src("assets/js/dom.js");
  check("disposeCanvas helper exists", dom.includes("disposeCanvas"));

  const core = src("assets/js/pdf/core.js");
  check("core disposes canvases centrally", core.includes("disposeCanvas(canvas)"));

  const preview = src("assets/js/tools/preview.js");
  check("preview disposes stale bitmaps", preview.includes("disposeCanvas(this.page)"));

  const merge = src("assets/js/tools/merge.js");
  check("merge warns before heavy runs", merge.includes("confirmLarge("));
  check("merge guards huge inputs", merge.includes("confirmHeavyFile("));

  const rasterize = src("assets/js/tools/rasterize.js");
  check(
    "exportOne closes the document on failure",
    /exportOne[\s\S]*?finally:\s*\n?\s*await source\?\.\bdestroy\b/.test(rasterize) ||
      (rasterize.includes("async function exportOne") && rasterize.includes("await source?.destroy?.()"))
  );

  const main = src("assets/js/main.js");
  check("global rejection handler stays Arabic", main.includes("unhandledrejection"));
  check("global error handler prevents white-screen death", main.includes('addEventListener("error"'));

  const feedback = src("assets/js/ui/feedback.js");
  check("progress overlay has percent", feedback.includes("progress-pct") || feedback.includes("percent"));
  check("progress overlay is cancellable", feedback.includes("progress-cancel") && feedback.includes("Escape"));
});

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
