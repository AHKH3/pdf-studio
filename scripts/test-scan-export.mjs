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

  const exportStart = Math.min(
    ...["async function buildScanPdfBytes()", "async function run()"]
      .map((marker) => scanTool.indexOf(marker))
      .filter((i) => i >= 0)
  );
  const toolStart = scanTool.indexOf("export const scanTool");
  const runBody = exportStart >= 0 && toolStart > exportStart ? scanTool.slice(exportStart, toolStart) : "";
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
    "processing modes live in the side panel",
    html.indexOf('name="scan-mode"') > html.indexOf("scan__side") &&
      html.indexOf('name="scan-mode"') < html.indexOf("scan__stage"),
    "tools up top, settings on the side (AHK-83)"
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
    "result preview is directly draggable (free layout)",
    scanTool.includes("layoutDrag") && scanTool.includes("layoutHitMode"),
    "pressing the image moves/resizes it — never leaves the preview"
  );
  check(
    "empty paper is an intentional no-op (no trap exit)",
    scanTool.includes("intentional no-op"),
    "leaving the layout needs the mode switch or Esc, never a stray click"
  );
  check(
    "cursor follows the hovered capability",
    scanTool.includes("function updateHoverCursor") &&
      scanTool.includes('"grab"') && scanTool.includes("nwse-resize"),
    "grab over the image, diagonal arrows over handles, default over paper"
  );
  check(
    "two-level Esc cancels drags before exiting modes",
    scanTool.includes('"Escape"') && scanTool.includes("أُلغي السحب"),
    "first Esc restores the drag start, second leaves the mode"
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
    "stage mode segmented control is explicit",
    html.includes('id="scan-modeseg"') && html.includes('id="scan-mode-crop"'),
    "stage segmented control houses the modes cleanly"
  );
  check(
    "paper settings live in the side panel",
    html.includes('id="scan-pages-details"') &&
      html.indexOf('id="scan-page"') > html.indexOf("scan__side") &&
      html.indexOf('id="scan-orient"') > html.indexOf("scan__side"),
    "paper size is core to this tool — always visible in the side, no popover (AHK-83)"
  );
  check(
    "no numeric margin input — placement is manual on the sheet",
    !html.includes('id="scan-margin"') && !scanTool.includes('scan-margin'),
    "the margin field was removed; free layout replaces it (AHK-84)"
  );
  check(
    "stage hint follows the current state",
    scanTool.includes("function syncHint") && scanTool.includes("موافق أو إلغاء"),
    "review/original/result each get their own guidance"
  );
}

console.log("\nscan page — AHK-83 sidebar layout and ID preset");
{
  check(
    "three mode controls exist on stage",
    html.includes('id="scan-modeseg"') &&
      html.includes('id="scan-mode-crop"') &&
      html.includes('id="scan-mode-layout"') &&
      html.includes('id="scan-mode-preview"'),
    "stage switches cleanly between crop, layout, and preview modes"
  );
  check(
    "simplified tone options exist without clutter",
    html.includes('data-tone="color"') &&
      html.includes('data-tone="gray"') &&
      html.includes('data-tone="original"') &&
      !html.includes('data-tone="sharp"') &&
      !html.includes('data-tone="bw"'),
    "only color, gray, and original tone modes are provided"
  );
  check(
    "layout switch locks during a staged review",
    scanTool.includes("ثبّت الكشف أو ألغِه أولًا"),
    "switching modes mid-review would show a result built on unpinned corners"
  );
  check(
    "corner buttons never cover the paper",
    css.includes(".scan__stage-btn--corner-l") &&
      scanTool.includes("STAGE_ACTION_RESERVE") &&
      scanTool.includes("canvas.height - STAGE_ACTION_RESERVE"),
    "sheet and photo sit above a reserved bottom strip — portrait or landscape"
  );
  check(
    "no floating stage actions overlap the preview",
    !html.includes("scan__stage-actions"),
    "only the two corner buttons float — the canvas stays fully visible"
  );
  check(
    "id-card preset keeps one strict line, not a paragraph",
    html.includes('name="scan-preset"') &&
      html.includes("85.6") &&
      !html.includes("تُطبع بمقاسها الحقيقي"),
    "the legal size stays where the decision is made — nowhere else"
  );
  check(
    "layout presets and apply-to-all appear in sidebar without redundant buttons",
    html.includes('id="scan-layout-all"') &&
      !html.includes('id="scan-layout-fill"') &&
      !html.includes('id="scan-layout-center"'),
    "presets drive layout directly — redundant fill/center buttons removed"
  );
  check(
    "sheet center lines are always on in layout mode",
    scanTool.includes("Sheet center lines") && scanTool.includes("lastSnap"),
    "the user asked for guides by default — faint always, strong on snap"
  );
  check(
    "no clutter badge overlays the document",
    !scanTool.includes("function drawBadge"),
    "zero-badge policy — canvas stays completely clean"
  );
  check(
    "export draws the ID card at a fixed physical size",
    scanTool.includes("ID_CARD_MM") && scanTool.includes('"id-card"'),
    "not a ratio of the paper"
  );
  check(
    "export uses the free-layout rect, not a margin box",
    scanTool.includes("rectForPagePt(page, pageWidth, pageHeight"),
    "what-you-see-is-what-you-export: preview rect drives drawImage"
  );
  check(
    "preset choice survives tab switches",
    scanTool.includes('"scan-preset"'),
    "persisted like the tone mode"
  );
}

console.log("\nscan result view — sticky across pages, instant on edits");
{
  const refreshBody = scanTool.slice(scanTool.indexOf("function refresh()"), scanTool.indexOf("function syncOutputLabel"));
  check(
    "navigation restores the result view instead of flashing corners",
    refreshBody.includes("ensureResultView"),
    "the preview button is global but bitmaps are per-page"
  );
  const ensureBody = scanTool.slice(scanTool.indexOf("async function ensureResultView"), scanTool.indexOf("async function run()"));
  check(
    "fresh pages render behind the progress overlay",
    ensureBody.includes("startProgress") && ensureBody.includes("renderResult(page)")
  );
  check(
    "cached pages short-circuit with no overlay",
    ensureBody.includes("resultKey === stampOf(page)")
  );
  check(
    "overlapping renders are sequenced — only the latest wins",
    ensureBody.includes("resultViewSeq")
  );
  check(
    "a failed render steps back to the original",
    ensureBody.includes("showingResult = false"),
    "the button must never stay pressed over the corners"
  );
  const dirtyBody = scanTool.slice(scanTool.indexOf("function markDirty"), scanTool.indexOf("async function refreshResultPreview"));
  check(
    "hand edits drop the cached result for instant feedback",
    dirtyBody.includes("invalidateResult(page)"),
    "keeping the stale bitmap hid the edit for seconds while the worker recomputed"
  );
  const rotateAt = scanTool.indexOf('scan-rotate")?.addEventListener');
  const modeAt = scanTool.indexOf('name="scan-mode"', rotateAt);
  check(
    "rotate marks the cached result stale (mode never flickers)",
    rotateAt >= 0 && modeAt > rotateAt && scanTool.slice(rotateAt, modeAt).includes("invalidateResult(page)")
  );
  const paperAt = scanTool.indexOf('"scan-page", "scan-orient"', modeAt);
  check(
    "tone changes mark the cached result stale (mode never flickers)",
    modeAt >= 0 && paperAt > modeAt && scanTool.slice(modeAt, paperAt).includes("invalidateResult(page)")
  );
  const fullBody = scanTool.slice(scanTool.indexOf("function useFullFrame"), scanTool.indexOf("Races a long stage"));
  check(
    "full-frame drops the cached result and live-updates in result mode",
    fullBody.includes("invalidateResult(page)") &&
      (fullBody.includes("refreshResultPreview") || fullBody.includes("schedulePreviewRefresh"))
  );
  const debouncedBody = scanTool.slice(
    scanTool.indexOf("async function refreshResultPreview"),
    scanTool.indexOf("async function ensureResultView")
  );
  check(
    "a debounced re-render never draws over a flipped page",
    debouncedBody.includes("current() !== page")
  );
  check(
    "overlapping debounced refreshes are sequenced — only the latest paints",
    debouncedBody.includes("previewSeq"),
    "a fast second edit must win over an in-flight first render"
  );
  check(
    "a superseded worker output never overwrites fresh edits",
    scanTool.includes("stampOf(page) !== stamp"),
    "an older render finishing late must drop its pixels, not paint them"
  );
  check(
    "fresh results repaint the rail, not just the stage",
    debouncedBody.includes("renderStrip()"),
    "the side rail must mirror the new result in the same frame"
  );
}

console.log("\nscan rail — mirrors the stage preview");
{
  const stripStart = scanTool.indexOf("function renderStrip");
  const stripEnd = scanTool.indexOf("function syncStripSortable");
  const stripBody = stripStart >= 0 && stripEnd > stripStart ? scanTool.slice(stripStart, stripEnd) : "";
  check(
    "rail shows the result bitmap while the stage previews it",
    stripBody.includes("showingResult && page.result") && stripBody.includes("page.result : page.display"),
    "what the main preview shows must appear in the side rail too"
  );
  check(
    "mirrored thumbs reuse the baked bitmap without double transforms",
    stripBody.includes("mirrored ? 0") && stripBody.includes('mirrored ? "original"'),
    "warp/rotate/tone are already baked into the result — re-applying would distort it"
  );
  check(
    "rail cache key tracks the result bitmap and the view mode",
    stripBody.includes("resultKey") && stripBody.includes('"r" : "o"'),
    "a fresh result must rebuild thumbs instead of reusing the original ones"
  );
  const toggleBody = scanTool.slice(
    scanTool.indexOf("async function toggleResultPreview"),
    scanTool.indexOf("async function run()")
  );
  check(
    "toggling the preview repaints the rail in the same frame",
    toggleBody.includes("renderStrip()"),
    "flipping معاينة must swap every thumb between original and result"
  );
}

console.log("\nscan page — ID preset shows its final shape live");
{
  const drawStart = scanTool.indexOf("if (!cropOpen && page.result)");
  const drawBody = drawStart >= 0 ? scanTool.slice(drawStart, drawStart + 3400) : "";
  check(
    "final preview mirrors the export free-layout rect",
    drawBody.includes("rectForPagePt(page, sheet.paperW, sheet.paperH") &&
      scanTool.includes("Photoshop-like"),
    "choosing the card must redraw the sheet with the fixed-size card, not the fill layout"
  );
  check(
    "auto rect keeps the fixed-size ID card outside fit",
    scanTool.includes("function autoPaperRect") &&
      scanTool.includes('currentPreset() === "id-card"') &&
      scanTool.includes("ID_CARD_MM"),
    "fit keeps its own sheet — the card size applies to fixed paper like the export"
  );
  check(
    "preview draws selection handles on fixed paper",
    drawBody.includes("Selection frame + corner handles"),
    "the free-layout affordance must be visible on the sheet"
  );
  const setupBody = scanTool.slice(scanTool.indexOf("setup()"), scanTool.indexOf("enter: refresh"));
  // The preset radio appears several times (default + restore + listener):
  // the change listener is the LAST block mentioning it inside setup().
  const presetParts = setupBody.split('input[name="scan-preset"]');
  const presetBody = presetParts.length > 1 ? presetParts[presetParts.length - 1].slice(0, 900) : "";
  check(
    "preset choice redraws the sheet immediately",
    presetBody.includes("scheduleDraw()"),
    "selecting fill/card must repaint instead of changing nothing"
  );
  check(
    "preset choice jumps to layout mode immediately",
    presetBody.includes('setViewMode("layout")'),
    "paper layout is only visible in the result/layout view — selecting it must switch to layout"
  );
  check(
    "preset switch reuses the cached bitmap (no worker re-render)",
    !presetBody.includes("invalidateResult(page)"),
    "stampOf ignores the preset — only the placement changes"
  );
}

console.log("\nscan result mode — edits never flash the crop UI");
{
  const invStart = scanTool.indexOf("function invalidateResult");
  const invEnd = scanTool.indexOf("function markDirty", invStart);
  const invBody = invStart >= 0 && invEnd > invStart ? scanTool.slice(invStart, invEnd) : "";
  check(
    "result-mode edits keep the stale bitmap until the fresh render lands",
    invBody.includes("showingResult") && invBody.includes('page.resultKey = ""'),
    "tone/rotate nulled the bitmap, so draw() fell back to crop corners for a frame"
  );
  check(
    "leaving result mode still frees the bitmap",
    invBody.includes("page.result?.close()") && invBody.includes("page.result = null"),
    "crop-mode edits must hard-drop the hidden preview"
  );
  const flips = ["showingResult = false", "viewMode ="];
  const rotAt = scanTool.indexOf('scan-rotate")?.addEventListener');
  const toneAt = rotAt >= 0 ? scanTool.indexOf('name="scan-mode"', rotAt) : -1;
  const presetAt = toneAt >= 0 ? scanTool.indexOf('name="scan-preset"', toneAt) : -1;
  const bodies = {
    markDirty: scanTool.slice(scanTool.indexOf("function markDirty"), scanTool.indexOf("async function refreshResultPreview")),
    fullFrame: scanTool.slice(scanTool.indexOf("function useFullFrame"), scanTool.indexOf("Races a long stage")),
    rotate: rotAt >= 0 && toneAt > rotAt ? scanTool.slice(rotAt, toneAt) : "",
    tone: toneAt >= 0 && presetAt > toneAt ? scanTool.slice(toneAt, presetAt) : ""
  };
  let strayFlip = "";
  for (const [name, body] of Object.entries(bodies)) {
    if (!body) {
      strayFlip = `${name} body not found — test anchors are stale`;
      break;
    }
    for (const token of flips) {
      if (body.includes(token)) {
        strayFlip = `${name} contains "${token}"`;
        break;
      }
    }
    if (strayFlip) break;
  }
  check(
    "tone/rotate/full-frame/corner edits never switch the view mode themselves",
    strayFlip === "",
    strayFlip || "an edit flipped the mode instead of refreshing inside it"
  );
  check(
    "discrete clicks recompute immediately (no drag debounce)",
    scanTool.includes("schedulePreviewRefresh(true)"),
    "tone/rotate/full-frame must not wait the 600ms drag debounce"
  );
  {
    const dirtyStart = scanTool.indexOf("function markDirty");
    const dirtyEnd = scanTool.indexOf("function schedulePreviewRefresh", dirtyStart);
    const dirtyBody = dirtyStart >= 0 && dirtyEnd > dirtyStart ? scanTool.slice(dirtyStart, dirtyEnd) : "";
    check(
      "continuous corner drags keep the 600ms debounce",
      dirtyBody.includes("schedulePreviewRefresh(false)"),
      "drag bursts must coalesce instead of queueing a worker run per move"
    );
  }
}

console.log("\ndirect print — output fills the sheet like the preview");
{
  const printSrc = await load("assets/js/lib/print.js");
  check(
    "print uses borderless @page so fill stays fill",
    /@page\s*\{\s*size:\s*auto;\s*margin:\s*0;\s*\}/.test(printSrc),
    "any @page margin shrinks the sheet image and leaves a white frame"
  );
  check(
    "no fixed print margin remains",
    !/10mm/.test(printSrc),
    "the old 10mm margin was the reported fill bug"
  );
  check(
    "print images span the full page width",
    /#print-root img\s*\{[^}]*width:\s*100%/.test(printSrc),
    "narrow images would not match the in-app preview"
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
