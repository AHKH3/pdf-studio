"use strict";
/**
 * Electron-side harness for the qpdf protection round-trip. Runs the real
 * production worker (assets/js/tools/protect/qpdf.worker.js) inside an
 * offscreen renderer served with the same COOP/COEP headers as the app,
 * prints one RESULT line, and exits.
 */
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".wasm": "application/wasm"
};

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      const url = (req.url || "/").split("?")[0];
      if (url === "/__harness.html") {
        res.setHeader("Content-Type", MIME[".html"]);
        return res.end("<!doctype html><title>protect-harness</title>");
      }
      const rel = decodeURIComponent(url).replace(/^\/+/, "");
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function main() {
  const plainB64 = process.env.HARNESS_PDF_B64;
  const password = process.env.HARNESS_PASSWORD;
  const srv = await startServer();
  const port = srv.address().port;

  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL(`http://127.0.0.1:${port}/__harness.html`);

  const driver = `
    const FIXTURE_B64 = ${JSON.stringify(plainB64)};
    const PASSWORD = ${JSON.stringify(password)};
    (async () => {
      const worker = new Worker("/assets/js/tools/protect/qpdf.worker.js", { type: "module" });
      const pending = new Map();
      worker.onmessage = (event) => {
        const settle = pending.get(event.data.id);
        if (settle) { pending.delete(event.data.id); settle(event.data); }
      };
      const call = (msg) => new Promise((resolve) => {
        const id = "job-" + Math.random().toString(36).slice(2);
        pending.set(id, resolve);
        worker.postMessage({ op: msg.op, bytes: msg.bytes, userPassword: msg.userPassword, password: msg.password, id });
      });
      const bin = Uint8Array.from(atob(FIXTURE_B64), (ch) => ch.charCodeAt(0));
      const out = { crossIsolated: crossOriginIsolated };
      try {
        const enc = await call({ op: "encrypt", bytes: bin, userPassword: PASSWORD });
        out.encryptOk = Boolean(enc.ok);
        if (!enc.ok) { out.encryptReason = enc.reason; out.encryptStderr = enc.stderr || ""; }
        else {
          const latin = new TextDecoder("latin1").decode(new Uint8Array(enc.bytes));
          out.hasEncryptDict = latin.includes("/Encrypt");
          out.encryptedB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(enc.bytes)));
          const good = await call({ op: "decrypt", bytes: new Uint8Array(enc.bytes), password: PASSWORD });
          out.decryptOk = Boolean(good.ok);
          if (!good.ok) { out.decryptReason = good.reason; out.decryptStderr = good.stderr || ""; }
          else out.decryptedB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(good.bytes)));
          const bad = await call({ op: "decrypt", bytes: new Uint8Array(enc.bytes), password: "definitely-wrong" });
          out.wrongPasswordFails = !bad.ok;
        }
      } catch (error) {
        out.error = String(error && error.message || error);
      }
      return out;
    })()
  `;

  const results = await win.webContents.executeJavaScript(driver, true);
  console.log("HARNESS_RESULT " + Buffer.from(JSON.stringify(results), "utf8").toString("base64"));
  srv.close();
  app.quit();
}

main().catch((error) => {
  console.error("HARNESS_ERROR", error);
  app.exit(1);
});
