import { classifyFiles, filesKey } from "../lib/files.js";

/**
 * Shared capture bag. Tools never own the landing drop — they receive a subset.
 */

/** @type {File[]} */
let bag = [];

/** @type {Array<() => void>} */
const listeners = [];

export function onCaptureChange(fn) {
  listeners.push(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function captureFiles() {
  return bag.slice();
}

export function captureMix() {
  return classifyFiles(bag);
}

export function hasCapture() {
  return bag.length > 0;
}

export function setCapture(files) {
  bag = Array.from(files || []);
  emit();
}

export function addCapture(files) {
  bag = bag.concat(Array.from(files || []));
  emit();
}

export function removeCapture(index) {
  if (index < 0 || index >= bag.length) return;
  bag.splice(index, 1);
  emit();
}

export function clearCapture() {
  bag = [];
  emit();
}

export function reorderCapture(ordered) {
  bag = Array.from(ordered || []);
  emit();
}

const SINGLE_PDF = [
  "split",
  "compress",
  "watermark",
  "numbers",
  "rasterize",
  "sign",
  "protect",
  "crop",
  "extract-images",
  "ocr"
];

/** Action ids valid for the current mix, in legend order. */
export function actionIds() {
  const { images, pdfs } = captureMix();
  /** @type {string[]} */
  const ids = [];
  if (images.length) ids.push("scan");
  if (pdfs.length >= 2) ids.push("merge");
  if (pdfs.length >= 1) ids.push("organize");
  if (pdfs.length === 1) ids.push(...SINGLE_PDF);
  return ids;
}

/** Files to hand a tool when launching from capture. */
export function filesForAction(id) {
  const { images, pdfs } = captureMix();
  if (id === "scan" || id === "images") return images;
  if (id === "merge") return pdfs;
  if (id === "organize") return pdfs.concat(images);
  if (SINGLE_PDF.includes(id)) return pdfs.slice(0, 1);
  return [];
}

export function mixLabel() {
  const { images, pdfs } = captureMix();
  const parts = [];
  if (images.length) parts.push(`${images.length} صور`);
  if (pdfs.length) parts.push(`${pdfs.length} PDF`);
  return parts.join(" · ") || "—";
}

export { filesKey };
