/** Absolute URLs under the Electron loopback origin (assets/ only). */

function dirUrl(relative) {
  return new URL(relative, import.meta.url).href.replace(/\/$/, "");
}

export const TESSERACT_DIR = dirUrl("../../../vendor/tesseract/");
export const TESSDATA_DIR = dirUrl("../../../vendor/tessdata/");

export const TESSERACT_ESM = `${TESSERACT_DIR}/tesseract.esm.min.js`;
export const TESSERACT_WORKER = `${TESSERACT_DIR}/worker.min.js`;

export const LANGS = "ara+eng";
export const OEM_LSTM = 1;

export function workerOptions(logger) {
  return {
    workerPath: TESSERACT_WORKER,
    corePath: TESSERACT_DIR,
    langPath: TESSDATA_DIR,
    gzip: false,
    cacheMethod: "none",
    workerBlobURL: false,
    logger
  };
}
