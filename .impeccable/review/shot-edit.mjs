import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8767;
const CDP_PORT = 9334;

function contentType(p) {
  const e = extname(p).toLowerCase();
  if (e === ".html") return "text/html";
  if (e === ".js" || e === ".mjs" || e === ".cjs") return "text/javascript";
  if (e === ".css") return "text/css";
  if (e === ".json") return "application/json";
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".pdf") return "application/pdf";
  if (e === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

async function startStatic(root, port) {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/index.html";
    const file = join(root, url);
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-cache" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found: " + url);
    }
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  return server;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  const { data } = await rpc(ws, "Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const dest = join(OUT, name);
  await writeFile(dest, Buffer.from(data, "base64"));
  console.log("wrote", dest);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const server = await startStatic(root, PORT);
console.log("static on", PORT);

const profile = join(os.tmpdir(), `pdf-studio-shot-edit-${Date.now()}`);
await mkdir(profile, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  "--disable-gpu",
  "--hide-scrollbars",
  "--window-size=1440,900",
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: "ignore" });

let listed;
for (let i = 0; i < 40; i++) {
  try {
    listed = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then(r => r.json());
    if (listed?.length) break;
  } catch {}
  await wait(150);
}
if (!listed?.length) { chrome.kill(); server.close(); throw new Error("Chrome did not expose DevTools"); }

const target = listed.find(t => t.type === "page") || listed[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
await rpc(ws, "Page.enable");
await rpc(ws, "Runtime.enable");
await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await rpc(ws, "Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
await wait(900);
await rpc(ws, "Runtime.evaluate", { expression: `document.fonts ? document.fonts.ready.then(()=>true) : true`, awaitPromise: true });
await wait(300);

// 1: empty edit view (force show)
await rpc(ws, "Runtime.evaluate", { expression: `
  (() => {
    document.querySelectorAll('.view').forEach(v=>{ v.hidden=true; v.classList.remove('view--active'); });
    const e = document.getElementById('view-edit');
    e.hidden=false; e.classList.add('view--active');
    // ensure edit styles injected
    if (!document.getElementById('pdf-studio-edit-styles')) {
      const s=document.createElement('style'); s.id='pdf-studio-edit-styles';
      s.textContent='';
      document.head.append(s);
    }
    // mount if not mounted
    if (!e.querySelector('#edit-drop')) {
      // trigger setup by dispatching a fake tool mount - import via script
      return 'mounted:' + !!e.querySelector('#edit-drop');
    }
    return 'shown';
  })()
`, awaitPromise: true });
await wait(600);
await shot(ws, "edit-empty.png");

// try to trigger actual mount via router if available
await rpc(ws, "Runtime.evaluate", { expression: `
  (async () => {
    try {
      const mod = await import('./assets/js/tools/edit/app.js');
      const root = document.getElementById('view-edit');
      if (root && !root.querySelector('#edit-drop')) {
        mod.mount(root);
        return 'mounted via import';
      }
      return 'already mounted';
    } catch(e) { return 'import err:'+e.message; }
  })()
`, awaitPromise: true });
await wait(600);
await shot(ws, "edit-empty-mounted.png");

// 2: simulate workspace with a PDF page (inject fake board state)
await rpc(ws, "Runtime.evaluate", { expression: `
  (() => {
    const ws = document.getElementById('edit-workspace');
    const drop = document.getElementById('edit-drop');
    if (ws) ws.hidden=false;
    if (drop) drop.hidden=true;
    const canvas = document.getElementById('edit-page');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#e8eaf0'; ctx.fillRect(40,40,280,400);
      ctx.fillStyle='#1e3a8a'; ctx.font='14px sans-serif'; ctx.fillText('معاينة صفحة PDF', 100, 200);
      // fake object
      const layer = document.getElementById('edit-layer');
      if (layer) {
        layer.innerHTML = '<div class=\"edit-obj is-selected\" style=\"left:60px;top:80px;width:160px;height:40px;background:#fff;border:1px dashed #c41a1a;display:flex;align-items:center;justify-content:center;font:700 14px serif;color:#1e3a8a\">نص تجريبي<div class=\"edit-handle\" data-handle=\"se\" style=\"position:absolute;bottom:-6px;right:-6px;width:11px;height:11px;background:#c41a1a\"></div><div class=\"edit-rotate\" style=\"position:absolute;left:50%;top:-28px;width:11px;height:11px;background:#fff;border:2px solid #c41a1a\"></div></div>';
      }
    }
    return 'workspace faked';
  })()
`, awaitPromise: true });
await wait(400);
await shot(ws, "edit-workspace-faked.png");

// 3: mobile
await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(400);
await shot(ws, "edit-mobile.png");

ws.close();
chrome.kill();
server.close();
console.log("done");
