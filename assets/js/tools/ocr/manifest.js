import { enter, leave, mount, outputName, run, unmount, acceptFiles } from "./ocr.js";

/**
 * Searchable PDF (OCR) — Tesseract.js ara+eng, invisible text layer.
 * Integrator: paste hub-fragment.html, copy runtime, then register this object.
 * See README.md.
 */
export const ocrManifest = {
  id: "ocr",
  title: "بحث",
  name: "بحث",
  icon: "icon-file",
  input: "PDF",
  actionLabel: "تعرّف",
  mount,
  unmount,
  enter,
  leave,
  run,
  acceptFiles,
  outputName
};

export const id = ocrManifest.id;
export const title = ocrManifest.title;

export { enter, leave, mount, run, unmount };

export default ocrManifest;
