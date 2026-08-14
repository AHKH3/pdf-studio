import { LANGS, OEM_LSTM, TESSDATA_DIR, TESSERACT_ESM, workerOptions } from "./paths.js";

/** @type {any} */
let worker = null;
/** @type {Promise<any> | null} */
let loading = null;
/** @type {(msg: { status?: string; progress?: number }) => void} */
let onLog = () => {};

async function loadApi() {
  const mod = await import(TESSERACT_ESM);
  const api = mod?.createWorker ? mod : mod?.default;
  if (!api?.createWorker) throw new Error("تعذّر تحميل tesseract.js من assets/vendor/tesseract.");
  return api;
}

export async function assertTessdata() {
  for (const lang of LANGS.split("+")) {
    const url = `${TESSDATA_DIR}/${lang}.traineddata`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        "ملفات التعرف ara/eng غير موجودة. من جذر المشروع شغّل: node assets/js/tools/ocr/copy-runtime.mjs"
      );
    }
  }
}

/** @param {(msg: { status?: string; progress?: number }) => void} [fn] */
export function setWorkerLogger(fn) {
  onLog = typeof fn === "function" ? fn : () => {};
}

export async function ensureWorker() {
  if (worker) return worker;
  if (loading) return loading;
  loading = (async () => {
    await assertTessdata();
    const api = await loadApi();
    worker = await api.createWorker(LANGS, OEM_LSTM, workerOptions((msg) => onLog(msg)));
    return worker;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function terminateWorker() {
  const current = worker;
  worker = null;
  loading = null;
  if (current?.terminate) await current.terminate().catch(() => {});
}
