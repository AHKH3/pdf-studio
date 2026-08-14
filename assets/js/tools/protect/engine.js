const WORKER_URL = new URL("./qpdf.worker.js", import.meta.url);
const JOB_TIMEOUT_MS = 180_000;

let worker = null;
let seq = 0;
/** @type {Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: number }>} */
const pending = new Map();

export class QpdfError extends Error {
  /**
   * @param {string} message
   * @param {{ reason?: string; code?: number }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "QpdfError";
    this.reason = meta.reason || "";
    this.code = meta.code;
  }
}

function translate(reason, stderr) {
  const text = String(stderr || "").toLowerCase();
  if (reason === "no-sab") {
    return "تعذّر تشغيل محرّك التشفير في هذه الجلسة. راجع ملاحظات الدمج لأداة الحماية.";
  }
  if (
    reason === "decrypt-failed" ||
    text.includes("invalid password") ||
    text.includes("incorrect password") ||
    text.includes("password is incorrect") ||
    text.includes("unrecognized password") ||
    text.includes("invalid password supplied")
  ) {
    return "كلمة السر غير صحيحة. لا نحاول تخمينها أو كسر الحماية.";
  }
  if (text.includes("already encrypted") || text.includes("is encrypted")) {
    return "هذا الملف محمي مسبقاً. أزل الحماية أولاً إن كنت تعرف كلمة السر.";
  }
  if (text.includes("not encrypted")) {
    return "هذا الملف غير محمي بكلمة سر.";
  }
  return "تعذّرت معالجة الملف. تأكد أنه PDF صالح وأن كلمة السر صحيحة.";
}

function fail(reason, stderr, code) {
  return new QpdfError(translate(reason, stderr), { reason, code });
}

function settle(id, fn) {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  clearTimeout(job.timer);
  fn(job);
}

function onMessage(event) {
  const msg = event.data || {};
  settle(msg.id, (job) => {
    if (!msg.ok) {
      job.reject(fail(msg.reason, msg.stderr, msg.code));
      return;
    }
    job.resolve(new Uint8Array(msg.bytes));
  });
}

function onError() {
  for (const id of [...pending.keys()]) {
    settle(id, (job) => job.reject(fail("engine", "worker crashed")));
  }
  worker = null;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: "module" });
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);
  return worker;
}

/**
 * @param {{ op: "encrypt" | "decrypt"; bytes: Uint8Array; userPassword?: string; ownerPassword?: string; password?: string }} job
 * @returns {Promise<Uint8Array>}
 */
function callWorker(job) {
  const id = (seq += 1);
  const copy = job.bytes.slice();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      settle(id, (item) => item.reject(fail("engine", "timeout")));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const payload = {
      id,
      op: job.op,
      userPassword: job.userPassword,
      ownerPassword: job.ownerPassword,
      password: job.password,
      bytes: copy.buffer
    };
    getWorker().postMessage(payload, [copy.buffer]);
  });
}

/** @param {Uint8Array} bytes @param {string} password */
export function encryptPdf(bytes, password) {
  return callWorker({
    op: "encrypt",
    bytes,
    userPassword: password,
    ownerPassword: password
  });
}

/** @param {Uint8Array} bytes @param {string} password */
export function decryptPdf(bytes, password) {
  return callWorker({
    op: "decrypt",
    bytes,
    password
  });
}

export function disposeEngine() {
  for (const id of [...pending.keys()]) {
    settle(id, (job) => job.reject(fail("engine", "disposed")));
  }
  if (worker) {
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    worker.terminate();
    worker = null;
  }
}
