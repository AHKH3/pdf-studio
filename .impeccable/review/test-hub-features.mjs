/**
 * Test: context menu (right-click on tool), pin flow, hidden section, and file preview modal.
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9334;
const PAGE = "http://127.0.0.1:8766/index.html";

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rpc(ws, method, params = {}) {
  const id = rpc.n = (rpc.n || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const on = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", on);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", on);
  });
}

async function shot(ws, name) {
  const { data } = await rpc(ws, "Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(OUT, name), Buffer.from(data, "base64"));
  console.log("wrote", name);
}

async function evaluate(ws, expression) {
  const r = await rpc(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result?.value;
}

const profile = join(os.tmpdir(), `pdf-studio-ctx-${Date.now()}`);
await mkdir(profile, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--disable-gpu", "--hide-scrollbars", "--window-size=1440,900", PAGE
], { stdio: "ignore" });

let listed;
for (let i = 0; i < 40; i++) {
  try {
    listed = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    if (listed?.length) break;
  } catch {}
  await wait(150);
}
if (!listed?.length) { chrome.kill(); throw new Error("no devtools"); }

const target = listed.find((t) => t.type === "page") || listed[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });

await rpc(ws, "Page.enable");
await rpc(ws, "Runtime.enable");
await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await rpc(ws, "Page.navigate", { url: PAGE });
await wait(1200);

// inject files (valid minimal PDF with one page)
const pdfBase64 = "JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzMgMCBSXS9Db3VudCAxPj4KZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAyMDAgMjAwXS9QYXJlbnQgMiAwIFI+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4K";
const inject = `(async () => {
  const bin = atob("${pdfBase64}");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdf = new File([bytes], "test.pdf", { type: "application/pdf" });
  const input = document.getElementById("hub-input");
  const dt = new DataTransfer();
  dt.items.add(pdf);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  return document.querySelectorAll(".hub-tool").length;
})()`;
const toolCount = await evaluate(ws, inject);
console.log("tools shown:", toolCount);

// right-click on first tool
await evaluate(ws, `(function () {
  const btn = document.querySelector('.hub-tool');
  const r = btn.getBoundingClientRect();
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
})()`);
await wait(300);
const menuVisible = await evaluate(ws, `!document.getElementById('tool-ctxmenu').hidden`);
console.log("ctx menu visible:", menuVisible);
await shot(ws, "test-ctxmenu.png");

// click "pin"
await evaluate(ws, `document.querySelector('#tool-ctxmenu [data-ctx="pin"]').click()`);
await wait(300);
const pinnedSectionVisible = await evaluate(ws, `!document.getElementById('hub-tools-pinned-section').hidden`);
console.log("pinned section visible:", pinnedSectionVisible);
await shot(ws, "test-pinned.png");

// hide another tool
await evaluate(ws, `(function () {
  const btns = document.querySelectorAll('#hub-legend .hub-tool');
  const btn = btns[btns.length - 1];
  const r = btn.getBoundingClientRect();
  btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
})()`);
await wait(200);
await evaluate(ws, `document.querySelector('#tool-ctxmenu [data-ctx="hide"]').click()`);
await wait(300);
const hiddenCount = await evaluate(ws, `document.getElementById('hub-hidden-count').textContent`);
const detailsOpen = await evaluate(ws, `document.getElementById('hub-tools-hidden-details').open = true; document.querySelectorAll('#hub-legend-hidden .hub-tool').length`);
console.log("hidden count:", hiddenCount, "hidden tools:", detailsOpen);
await shot(ws, "test-hidden.png");

// open preview modal on the PDF card
await evaluate(ws, `document.querySelector('.hub-card__thumb').click()`);
await wait(1200);
const modalOpen = await evaluate(ws, `!document.getElementById('file-preview').hidden`);
console.log("preview modal open:", modalOpen);
await shot(ws, "test-preview.png");

// close modal
await evaluate(ws, `document.getElementById('file-preview-close').click()`);
await wait(200);
const modalClosed = await evaluate(ws, `document.getElementById('file-preview').hidden`);
console.log("modal closed:", modalClosed);

// localStorage persistence
const saved = await evaluate(ws, `localStorage.getItem('pdfstudio.toolprefs.v1')`);
console.log("prefs saved:", saved);

ws.close();
chrome.kill();
