/** @typedef {{ left: number; top: number; right: number; bottom: number }} NormBox */
/** @typedef {{ x: number; y: number; width: number; height: number }} PdfBox */

export const FULL_PAGE = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });

/** Starting inset so handles sit inside the page and scanner margins are one drag away. */
export const DEFAULT_BOX = Object.freeze({ left: 0.06, top: 0.06, right: 0.94, bottom: 0.94 });

const MIN_SPAN = 0.02;

/** @param {number} value */
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * @param {NormBox} box
 * @param {number} [min]
 * @returns {NormBox}
 */
export function clampBox(box, min = MIN_SPAN) {
  let left = clamp01(Number(box.left) || 0);
  let top = clamp01(Number(box.top) || 0);
  let right = clamp01(Number(box.right) || 1);
  let bottom = clamp01(Number(box.bottom) || 1);

  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];

  if (right - left < min) {
    const mid = (left + right) / 2;
    left = clamp01(mid - min / 2);
    right = clamp01(left + min);
    left = right - min;
  }
  if (bottom - top < min) {
    const mid = (top + bottom) / 2;
    top = clamp01(mid - min / 2);
    bottom = clamp01(top + min);
    top = bottom - min;
  }

  return {
    left: clamp01(left),
    top: clamp01(top),
    right: clamp01(right),
    bottom: clamp01(bottom)
  };
}

/** @param {NormBox} box */
export function boxArea(box) {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

/**
 * Map a visual crop (fractions of the displayed page, origin top-left) through
 * a pdf.js viewport into PDF user space (origin bottom-left, unrotated).
 *
 * @param {NormBox} box
 * @param {{ width: number; height: number; convertToPdfPoint: (x: number, y: number) => number[] }} viewport
 * @returns {PdfBox}
 */
export function viewportBoxToPdf(box, viewport) {
  const width = viewport.width;
  const height = viewport.height;
  const corners = [
    viewport.convertToPdfPoint(box.left * width, box.top * height),
    viewport.convertToPdfPoint(box.right * width, box.top * height),
    viewport.convertToPdfPoint(box.left * width, box.bottom * height),
    viewport.convertToPdfPoint(box.right * width, box.bottom * height)
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Fallback when a pdf.js viewport is not available: same visual fractions,
 * using the page's current CropBox/MediaBox and /Rotate.
 *
 * @param {NormBox} box
 * @param {PdfBox} visible
 * @param {number} rotation clockwise display rotation
 * @returns {PdfBox}
 */
export function visualNormToPdfBox(box, visible, rotation) {
  const rot = ((Number(rotation) || 0) % 360 + 360) % 360;
  const visW = rot === 90 || rot === 270 ? visible.height : visible.width;
  const visH = rot === 90 || rot === 270 ? visible.width : visible.height;
  const corners = [
    [box.left * visW, box.top * visH],
    [box.right * visW, box.top * visH],
    [box.left * visW, box.bottom * visH],
    [box.right * visW, box.bottom * visH]
  ].map(([vx, vy]) => visualPointToPdf(vx, vy, visible, rot));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * @param {number} vx visual x from the displayed top-left, in PDF points
 * @param {number} vy visual y down, in PDF points
 * @param {PdfBox} box unrotated visible box
 * @param {number} rot 0 | 90 | 180 | 270
 */
function visualPointToPdf(vx, vy, box, rot) {
  const { x: bx, y: by, width: bw, height: bh } = box;
  switch (rot) {
    case 90:
      return { x: bx + vy, y: by + vx };
    case 180:
      return { x: bx + bw - vx, y: by + vy };
    case 270:
      return { x: bx + bw - vy, y: by + bh - vx };
    default:
      return { x: bx + vx, y: by + bh - vy };
  }
}

const PT_TO_MM = 25.4 / 72;

/**
 * Visual size of the cropped region in millimetres, from a scale-1 viewport.
 *
 * @param {NormBox} box
 * @param {{ width: number; height: number }} viewport
 */
export function cropSizeMm(box, viewport) {
  const width = Math.max(0, box.right - box.left) * viewport.width * PT_TO_MM;
  const height = Math.max(0, box.bottom - box.top) * viewport.height * PT_TO_MM;
  return { width, height };
}

/** @param {number} mm */
export function formatMm(mm) {
  const rounded = Math.abs(mm - Math.round(mm)) < 0.05 ? Math.round(mm) : Math.round(mm * 10) / 10;
  return String(rounded);
}
