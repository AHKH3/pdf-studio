/**
 * Test v2: preview modal — footer controls, page thumbs, files switcher, zoom.
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9335;
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

const profile = join(os.tmpdir(), `pdf-studio-prev2-${Date.now()}`);
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

// inject: 3-page PDF (built in-page with pdf-lib) + 1 image
const inject = `(async () => {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([400, 560]);
    page.drawText('Page ' + i, { x: 160, y: 280, size: 32, font });
  }
  const pdfBytes = await doc.save();
  const pdf = new File([pdfBytes], "مستند-ثلاثي.pdf", { type: "application/pdf" });

  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 400;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 300, 400);
  g.addColorStop(0, '#4F46E5'); g.addColorStop(1, '#DB2777');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 300, 400);
  ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText('IMG', 110, 210);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const img = new File([blob], "صورة-ملونة.png", { type: "image/png" });

  const input = document.getElementById("hub-input");
  const dt = new DataTransfer();
  dt.items.add(pdf);
  dt.items.add(img);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise(r => setTimeout(r, 1400));
  return {
    cards: document.querySelectorAll(".hub-card").length,
    pdfPages: document.querySelectorAll("#hub-list .hub-card")[0]?.querySelectorAll("[data-pages]").length
  };
})()`;
const state = await evaluate(ws, inject);
console.log("cards:", JSON.stringify(state));

// open preview on the PDF (first card thumb)
await evaluate(ws, `document.querySelector('.hub-card__thumb').click()`);
await wait(2500);
const open = await evaluate(ws, `({
  open: !document.getElementById('file-preview').hidden,
  count: document.getElementById('file-preview-count').textContent,
  footVisible: !document.getElementById('file-preview-pager').hidden,
  zoomVisible: !document.getElementById('file-preview-zoombar').hidden,
  pagesThumbs: document.querySelectorAll('#fp-pages .preview-modal__thumb').length,
  filesRows: document.querySelectorAll('#fp-files .preview-modal__file').length,
  renderedThumbs: document.querySelectorAll('#fp-pages .preview-modal__thumb:not(.is-empty)').length
})`);
console.log("preview:", JSON.stringify(open));
await shot(ws, "test2-pdf-preview.png");

// next page
await evaluate(ws, `document.getElementById('file-preview-next').click()`);
await wait(1200);
const afterNext = await evaluate(ws, `({
  count: document.getElementById('file-preview-count').textContent,
  activeThumb: document.querySelector('#fp-pages .preview-modal__thumb.is-active')?.dataset.page
})`);
console.log("after next:", JSON.stringify(afterNext));
await shot(ws, "test2-pdf-page2.png");

// zoom in twice
await evaluate(ws, `document.getElementById('file-preview-zoom-in').click(); document.getElementById('file-preview-zoom-in').click()`);
await wait(400);
const zoomPct = await evaluate(ws, `document.getElementById('file-preview-zoom-fit').textContent`);
console.log("zoom after 2x in:", zoomPct);

// switch to image via files list
await evaluate(ws, `document.querySelectorAll('#fp-files .preview-modal__file')[1].click()`);
await wait(1200);
const imgState = await evaluate(ws, `({
  title: document.getElementById('file-preview-title').textContent,
  imgVisible: !document.getElementById('file-preview-img').hidden,
  pagerHidden: document.getElementById('file-preview-pager').hidden,
  activeFile: document.querySelector('#fp-files [data-active="true"] .preview-modal__file-name')?.textContent
})`);
console.log("switched to image:", JSON.stringify(imgState));
await shot(ws, "test2-image-preview.png");

ws.close();
chrome.kill();
