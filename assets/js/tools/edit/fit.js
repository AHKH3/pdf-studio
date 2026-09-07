/**
 * Fit a PDF page into the edit pane. Two modes:
 * - width (default): the page fills the content width, big and legible; the
 *   user scrolls vertically. Whole-page visibility is NOT the priority.
 * - page: the whole page is contained in the pane (classic fit).
 *
 * The board used to treat a hidden wrap (clientWidth/Height = 0) as an 80×80
 * box and then floor the CSS width at 120px. Un-hiding the workspace then
 * refit to the real pane — the page appeared to zoom in (and ResizeObserver
 * jitter made it look random). Return 0 until the wrap is actually laid out.
 *
 * Upscale past 1:1 is allowed (capped at 3x) so the page fills wide panes
 * instead of sitting small in the middle; the bitmap renderer follows the
 * on-screen size with devicePixelRatio, so zoomed pages stay crisp.
 */

export const MIN_FIT_PX = 120;
export const MIN_BOX_PX = 80;
export const FIT_SLACK_PX = 2;
/** Never render wider than 3 CSS px per PDF pt (memory + sanity cap). */
export const MAX_FIT_SCALE = 3;

/**
 * CSS width in px of a page fitted into a content box.
 * Fills the box (upscales when the pane is roomy). Returns 0 if the box is
 * not laid out.
 *
 * @param {number} pageWidthPt
 * @param {number} pageHeightPt
 * @param {number} boxWidthPx
 * @param {number} boxHeightPx
 * @param {{ minPx?: number; maxScale?: number }} [options]
 */
export function fitPageCssWidth(pageWidthPt, pageHeightPt, boxWidthPx, boxHeightPx, options = {}) {
  const minPx = options.minPx ?? MIN_FIT_PX;
  const maxScale = options.maxScale ?? MAX_FIT_SCALE;
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0)) return 0;
  if (!(boxWidthPx >= MIN_BOX_PX) || !(boxHeightPx >= MIN_BOX_PX)) return 0;
  const byHeight = boxHeightPx * (pageWidthPt / pageHeightPt);
  const fitted = Math.min(boxWidthPx, byHeight, pageWidthPt * maxScale);
  if (!(fitted > 0)) return 0;
  if (boxWidthPx >= minPx && byHeight >= minPx) return Math.max(minPx, fitted);
  return fitted;
}

/**
 * @param {number} pageWidthPt
 * @param {number} boxWidthPx
 * @param {{ maxScale?: number }} [options]
 */
export function fitWidthFillPx(pageWidthPt, boxWidthPx, options = {}) {
  const maxScale = options.maxScale ?? MAX_FIT_SCALE;
  if (!(pageWidthPt > 0)) return 0;
  if (!(boxWidthPx >= MIN_BOX_PX)) return 0;
  return Math.min(boxWidthPx, pageWidthPt * maxScale);
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
