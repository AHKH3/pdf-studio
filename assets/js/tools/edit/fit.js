/**
 * Fit a PDF page into the edit pane without the first-open zoom jump.
 *
 * The board used to treat a hidden wrap (clientWidth/Height = 0) as an 80×80
 * box and then floor the CSS width at 120px. Un-hiding the workspace then
 * refit to the real pane — the page appeared to zoom in (and ResizeObserver
 * jitter made it look random). Return 0 until the wrap is actually laid out.
 */

export const MIN_FIT_PX = 120;
export const MIN_BOX_PX = 80;
export const FIT_SLACK_PX = 2;

/**
 * CSS width in px of a page fitted into a content box.
 * Never upscales past 1 CSS px per PDF pt. Returns 0 if the box is not laid out.
 *
 * @param {number} pageWidthPt
 * @param {number} pageHeightPt
 * @param {number} boxWidthPx
 * @param {number} boxHeightPx
 * @param {{ minPx?: number }} [options]
 */
export function fitPageCssWidth(pageWidthPt, pageHeightPt, boxWidthPx, boxHeightPx, options = {}) {
  const minPx = options.minPx ?? MIN_FIT_PX;
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) return 0;
  if (!(boxWidthPx >= MIN_BOX_PX) || !(boxHeightPx >= MIN_BOX_PX)) return 0;
  const byHeight = boxHeightPx * (pageWidthPt / pageHeightPt);
  const fitted = Math.min(boxWidthPx, byHeight, pageWidthPt);
  if (!(fitted > 0)) return 0;
  if (boxWidthPx >= minPx && byHeight >= minPx) return Math.max(minPx, fitted);
  return fitted;
}

/**
 * Keep the previous width when the next one is missing or only 1–2px off,
 * so ResizeObserver scrollbar/flex jitter cannot loop applySize.
 *
 * @param {number} nextPx
 * @param {number} prevPx
 * @param {number} [slackPx]
 */
export function stabilizeFitPx(nextPx, prevPx, slackPx = FIT_SLACK_PX) {
  if (!(nextPx > 0)) return prevPx > 0 ? prevPx : 0;
  if (!(prevPx > 0)) return nextPx;
  return Math.abs(nextPx - prevPx) <= slackPx ? prevPx : nextPx;
}
