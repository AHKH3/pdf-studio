/**
 * Regression checks for the images→PDF export hang: the progress overlay
 * used to freeze at 0% with an ineffective cancel button whenever a worker
 * reply was lost (dead worker reused forever, no timeout) or the export
 * sat inside one long unreported stage.
 *
 * The modules under test need DOM/Worker, so this asserts source
 * invariants only (normalized to LF first — see the norm() rule).
 * Run with: npm test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_OK_SIDE, TARGET_LONG_SIDE, needsUpscale } from "../assets/js/enhance/quality.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const norm = (text) => String(text || "").replace(/\r\n/g, "\n");

async function load(rel) {
  return norm(await readFile(path.join(ROOT, rel), "utf8"));
}

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

function blockAfter(src, marker, length = 900) {
  const index = src.indexOf(marker);
  return index < 0 ? "" : src.slice(index, index + length);
}

function countOf(src, token) {
  return src.split(token).length - 1;
}

const scanClient = await load("assets/js/scan/client.js");
const enhanceClient = await load("assets/js/enhance/client.js");
const scanTool = await load("assets/js/tools/scan.js");
const qualitySrc = await load("assets/js/enhance/quality.js");
const feedbackSrc = await load("assets/js/ui/feedback.js");
const css = await load("assets/css/app.css");
const html = await load("index.html");
const bitmap = await load("assets/js/lib/bitmap.js");
const imageEmbed = await load("assets/js/lib/image-embed.js");

console.log("\nscan export hang — worker no-hang guarantee");
{
  const errBlock = blockAfter(scanClient, 'addEventListener("error"');
  check(
    "scan worker error discards the dead worker",
    errBlock.includes("this.worker = null"),
    "a broken worker was reused forever, hanging every later process() call"
  );
  check(
    "scan call() arms a rejection timeout",
    scanClient.includes("setTimeout") && scanClient.includes("انتهت مهلة"),
    "a lost reply must reject instead of freezing progress at 0%"
  );
  check(
    "late worker replies are ignored after a timeout",
    scanClient.includes("this.pending.has(id)"),
    "no double-settle once the entry is gone"
  );
  check(
    "failed postMessage rejects loudly",
    scanClient.includes("تعذر إرسال المهمة"),
    "ensure()/postMessage failures must surface as errors"
  );
}

console.log("\nenhance worker — same no-hang guarantee");
{
  check(
    "enhance call() arms a rejection timeout",
    enhanceClient.includes("setTimeout") && enhanceClient.includes("انتهت مهلة"),
    "polish/upscale stages hung the same overlay the same way"
  );
  check(
    "late enhance replies are ignored after a timeout",
    enhanceClient.includes("this.pending.has(id)")
  );
}

console.log("\nscan export — intra-page progress and cancellation");
{
  const renderStart = scanTool.indexOf("async function renderResult");
  const renderEnd = scanTool.indexOf("function syncPreviewButton");
  const renderBody = renderStart >= 0 && renderEnd > renderStart ? scanTool.slice(renderStart, renderEnd) : "";
  check("renderResult accepts an intra-page progress callback", renderBody.includes("onStep"));
  check(
    "renderResult reports intermediate stages",
    renderBody.includes("step(0.45") && renderBody.includes("step(0.9"),
    "the bar must move inside a page, not only between pages"
  );
  const renderCancels = countOf(renderBody, "throwIfCancelled();");
  check(
    "renderResult has cancellation checkpoints between stages",
    renderCancels >= 3,
    `${renderCancels} checkpoints found, need at least 3`
  );

  const runStart = scanTool.indexOf("async function run()");
  const toolStart = scanTool.indexOf("export const scanTool");
  const runBody = runStart >= 0 && toolStart > runStart ? scanTool.slice(runStart, toolStart) : "";
  check(
    "export passes a per-page progress mapper into renderResult",
    runBody.includes("renderResult(page,"),
    "overall percent must advance within each page"
  );
  const runCancels = countOf(runBody, "throwIfCancelled();");
  check(
    "export checks cancellation around encode/embed",
    runCancels >= 4,
    `${runCancels} checkpoints found, need at least 4`
  );
  check(
    "per-page progress stays within 0..100",
    runBody.includes("Math.max(0, Math.min(1, frac))"),
    "frac must be clamped before mapping to percent"
  );
}

console.log("\nbitmap encoding — loud failure instead of a crash");
{
  check(
    "bitmapToBytes guards a null blob",
    bitmap.includes("!blob") && bitmap.includes("تعذّر ترميز"),
    "toBlob can return null on huge canvases; .arrayBuffer() on null crashed"
  );
  check(
    "image-embed guards a null blob",
    imageEmbed.includes("!blob") && imageEmbed.includes("تعذّر ترميز"),
    "same toBlob failure class in the embed path"
  );
}

console.log("\nscan export — upscale stage can never hang the overlay");
{
  const renderStart = scanTool.indexOf("async function renderResult");
  const renderEnd = scanTool.indexOf("function syncPreviewButton");
  const renderBody = renderStart >= 0 && renderEnd > renderStart ? scanTool.slice(renderStart, renderEnd) : "";
  check(
    "long stages race the stop button",
    renderBody.includes("awaitStage("),
    "TF/worker work cannot be aborted mid-flight — stop waiting for it instead"
  );
  check(
    "upscale stage has a timeout with fallback",
    renderBody.includes("UPSCALE_STAGE_TIMEOUT_MS") && renderBody.includes("upscaleFallbacks"),
    "on expiry the export continues with original pixels instead of hanging"
  );
  check(
    "upscale shows a live elapsed-time heartbeat",
    renderBody.includes("onTick") && renderBody.includes(" ث)"),
    "the overlay must prove liveness during minutes-long inference"
  );
  check(
    "cancel/timeout helpers are imported",
    scanTool.includes("cancelledError") && scanTool.includes("isCancelled") && scanTool.includes("isCancellation")
  );
  check(
    "upscale fallbacks are reported to the user",
    scanTool.includes("reportUpscaleFallbacks")
  );
}

console.log("\nscan export — smart upscale by size");
{
  check("small sources still upscale", needsUpscale(1200) === true);
  check("boundary keeps native pixels", needsUpscale(NATIVE_OK_SIDE) === false);
  check(
    "ordinary photos keep native pixels",
    needsUpscale(2600) === false && needsUpscale(4000) === false
  );
  check("quality target bar is unchanged", TARGET_LONG_SIDE === 3508);
  check(
    "upscaleToTarget honors the smart floor",
    qualitySrc.includes("needsUpscale(side)")
  );
}

console.log("\nscan export — upscale opt-in and mid-run skip");
{
  const upscaleInput = html.slice(html.indexOf('id="scan-upscale"') - 200, html.indexOf('id="scan-upscale"') + 60);
  check(
    "upscale checkbox exists and is off by default",
    upscaleInput.includes('type="checkbox"') && !upscaleInput.includes("checked"),
    "fast export must be the default; AI upscale is opt-in"
  );
  check(
    "progress overlay has a skip button",
    html.includes('id="progress-skip"'),
    "button must exist in markup"
  );
  const skipTag = html.slice(html.indexOf('id="progress-skip"') - 60, html.indexOf('id="progress-skip"') + 40);
  check("skip button starts hidden", skipTag.includes("hidden"));
  check(
    "feedback wires the skip action",
    feedbackSrc.includes("setSkipHandler") && feedbackSrc.includes("setSkipVisible") &&
      feedbackSrc.includes('progress-skip'),
    "overlay needs show/hide + click delegation"
  );
  check(
    "export gates upscale on the checkbox",
    scanTool.includes('el("scan-upscale")?.checked === true'),
    "unchecked must keep native pixels with no AI cost"
  );
  check(
    "in-flight upscale resolves immediately on skip",
    scanTool.includes("skipIf") && scanTool.includes("skipValue"),
    "awaitStage must settle with native pixels, not wait for inference"
  );
  check(
    "skip flag short-circuits later pages",
    scanTool.includes("!skipUpscale &&"),
    "no wasted AI work after the user skips"
  );
  check(
    "skip button is shown and cleaned up per run",
    scanTool.includes("setSkipVisible(") && scanTool.includes("setSkipHandler(") &&
      scanTool.includes("setSkipHandler(null)"),
    "no stale skip action may leak into other tools"
  );
  check(
    "checkbox choice survives tab switches",
    scanTool.includes('"scan-upscale"'),
    "persisted via readInputValues like the other scan settings"
  );
}

console.log("\nscan page — filmstrip, keyboard, responsive export");
{
  check(
    "filmstrip markup exists",
    html.includes('id="scan-strip"') && html.includes('role="listbox"')
  );
  check(
    "strip renders thumbs with per-page remove",
    scanTool.includes("function renderStrip") && scanTool.includes("strip__remove")
  );
  check(
    "strip drag-reorders through Sortable without hijacking remove clicks",
    scanTool.includes("syncStripSortable") && scanTool.includes("applyStripOrder") &&
      scanTool.includes('filter: ".strip__remove"')
  );
  check(
    "strip reorder keeps the current page selected",
    scanTool.includes("findIndex((page) => page.id === currentId)")
  );
  check(
    "keyboard paging without clashing with corner nudging",
    scanTool.includes("PageDown") && scanTool.includes("PageUp") && scanTool.includes("stepPage")
  );
  check(
    "export yields to the UI between heavy pages",
    scanTool.includes("await yieldToUi();")
  );
  const previewStart = scanTool.indexOf("async function toggleResultPreview");
  const exportStart = scanTool.indexOf("* Export", previewStart);
  const previewBody = previewStart >= 0 && exportStart > previewStart ? scanTool.slice(previewStart, exportStart) : "";
  check(
    "preview only flips to result view on success",
    previewBody.includes("showingResult = ok"),
    "a cancelled preview must not fake the result state"
  );
  check(
    "preview offers the stop button",
    previewBody.length > 0 && !previewBody.includes("cancellable: false")
  );
  check(
    "page bitmaps and worker pixels are discarded centrally",
    scanTool.includes("function discardPage") && scanTool.includes("removePageById")
  );
  check(
    "strip styles exist",
    css.includes(".scan__strip") && css.includes(".scan-page") && css.includes(".strip__remove")
  );
  check(
    "pager buttons advertise their shortcuts",
    html.includes("PageUp") && html.includes("PageDown")
  );
}

console.log("\nscan page — edit-mirror chrome (top save, rail, no bottom bar)");
{
  check(
    "top save button exists and is wired to run",
    html.includes('id="scan-save"') && scanTool.includes('"scan-save"') && scanTool.includes("=> void run()"),
    "saving must live on top like the edit page"
  );
  check(
    "save label follows the output format",
    scanTool.includes('"scan-save-label"'),
    "mirrors tb-run-label for pdf vs images"
  );
  check(
    "bottom execution bar is hidden while scan is active",
    /\.sheet:has\(#view-scan\.view--active\) \.titleblock\s*\{\s*display\s*:\s*none/.test(css),
    "top save owns saving, like edit"
  );
  check(
    "workspace fills the viewport height",
    /\.work:has\(#view-scan\.view--active\)/.test(css) && /#view-scan\.view--active\s*\{[^}]*height\s*:\s*100%/.test(css)
  );
  check(
    "pages rail carries the pager in its head",
    html.includes("scan__rail-head") && html.indexOf('id="scan-prev"') > html.indexOf("scan__rail-head"),
    "navigation exactly like the edit rail"
  );
  check(
    "processing modes live in the top toolbar",
    html.indexOf('name="scan-mode"') > html.indexOf("scan__toolbar") &&
      html.indexOf('name="scan-mode"') < html.indexOf("scan__main"),
    "tools up top, settings on the side"
  );
  check(
    "rail items mirror the edit page cards",
    scanTool.includes('"scan-page"') && css.includes(".scan-page__img") && css.includes("aspect-ratio:3/4"),
    "3/4 thumb card with number, like edit"
  );
}

console.log("\nscan page — interaction audit fixes");
{
  check(
    "appending lands on the first new page",
    scanTool.includes("firstNew"),
    "adding files must not rewind a reviewed batch to page one"
  );
  check(
    "no blind dragging on the final preview",
    scanTool.includes("عدت للأصل"),
    "a press on the result must step back to the original first"
  );
  check(
    "hand edits take ownership even mid-review",
    scanTool.includes("can never eat hand-drawn"),
    "cancel must not destroy hand-drawn corners"
  );
  check(
    "detect-all never stomps a staged review",
    scanTool.includes("staged review"),
    "pages awaiting verdict are skipped, not overwritten"
  );
  {
    const fullStart = scanTool.indexOf("function useFullFrame");
    const fullEnd = scanTool.indexOf("}", scanTool.indexOf("scheduleDraw();", fullStart));
    const fullBody = fullStart >= 0 && fullEnd > fullStart ? scanTool.slice(fullStart, fullEnd) : "";
    check(
      "full-frame clears any staged review",
      fullBody.includes("page.review = null") && fullBody.includes("page.accepted = true"),
      "a manual frame is an owned verdict, not a pending one"
    );
  }
  check(
    "full-frame button is explicit",
    html.includes("إطار كامل"),
    "«كاملة» meant nothing out of context"
  );
  check(
    "paper settings are visible by default",
    html.includes('id="scan-pages-details" open'),
    "paper size is core to this tool, not an advanced detail"
  );
  check(
    "stage hint follows the current state",
    scanTool.includes("function syncHint") && scanTool.includes("موافق أو إلغاء"),
    "review/original/result each get their own guidance"
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
