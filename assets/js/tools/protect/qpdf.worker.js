import createModule from "./vendor/qpdf.js";

const JS_URL = new URL("./vendor/qpdf.js", import.meta.url).href;
const WASM_URL = new URL("./vendor/qpdf.wasm", import.meta.url).href;

/** @type {null | Awaited<ReturnType<typeof createModule>>} */
let qpdf = null;
let stdout = "";
let stderr = "";

function locateFile(filename) {
  const name = String(filename).split("/").pop() || String(filename);
  return name.endsWith(".wasm") ? WASM_URL : JS_URL;
}

function sharedMemoryWorks() {
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return memory.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("bad-bytes");
}

function resetLogs() {
  stdout = "";
  stderr = "";
}

function unlinkQuiet(path) {
  try {
    qpdf.FS.unlink(path);
  } catch {
    /* already gone */
  }
}

function runMain(args) {
  resetLogs();
  try {
    const code = qpdf.callMain(args);
    if (typeof code === "number") return code;
    return typeof qpdf.EXITSTATUS === "number" ? qpdf.EXITSTATUS : 0;
  } catch (error) {
    if (typeof error?.status === "number") return error.status;
    throw error;
  }
}

function readOut(path) {
  try {
    return qpdf.FS.readFile(path);
  } catch {
    return null;
  }
}

async function ensureModule() {
  if (qpdf) return qpdf;
  if (!sharedMemoryWorks()) {
    const error = new Error("no-sab");
    error.code = "no-sab";
    throw error;
  }
  qpdf = await createModule({
    locateFile,
    print: (text) => {
      stdout += `${text}\n`;
    },
    printErr: (text) => {
      stderr += `${text}\n`;
    }
  });
  return qpdf;
}

/**
 * @param {Uint8Array} bytes
 * @param {string[]} args
 * @param {string} [outPath]
 */
function withFiles(bytes, args, outPath = "/out.pdf") {
  unlinkQuiet("/in.pdf");
  unlinkQuiet(outPath);
  qpdf.FS.writeFile("/in.pdf", bytes);
  const code = runMain(args);
  const output = outPath ? readOut(outPath) : null;
  unlinkQuiet("/in.pdf");
  unlinkQuiet(outPath);
  return { code, output, stdout, stderr };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    await ensureModule();
    const bytes = asBytes(msg.bytes);

    if (msg.op === "encrypt") {
      const user = String(msg.userPassword ?? "");
      const owner = String(msg.ownerPassword ?? user);
      const { code, output, stderr: err } = withFiles(bytes, [
        "/in.pdf",
        "--encrypt",
        user,
        owner,
        "256",
        "--print=full",
        "--extract=y",
        "--",
        "/out.pdf"
      ]);
      if (!output || (code !== 0 && code !== 3)) {
        self.postMessage({ id, ok: false, code, stderr: err, reason: "encrypt-failed" });
        return;
      }
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
      self.postMessage({ id, ok: true, bytes: buffer }, [buffer]);
      return;
    }

    if (msg.op === "decrypt") {
      const password = String(msg.password ?? "");
      const args = password
        ? ["--password=" + password, "--decrypt", "/in.pdf", "/out.pdf"]
        : ["--decrypt", "/in.pdf", "/out.pdf"];
      const { code, output, stderr: err } = withFiles(bytes, args);
      if (!output || (code !== 0 && code !== 3)) {
        self.postMessage({ id, ok: false, code, stderr: err, reason: "decrypt-failed" });
        return;
      }
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
      self.postMessage({ id, ok: true, bytes: buffer }, [buffer]);
      return;
    }

    self.postMessage({ id, ok: false, reason: "unknown-op" });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      reason: error?.code === "no-sab" || error?.message === "no-sab" ? "no-sab" : "engine",
      stderr: String(error?.message || error || "")
    });
  }
};
