/**
 * Capture start (light/dark) and scan + mobile for the design pass.
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const PAGE = "http://127.0.0.1:8766/index.html";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  const { data } = await rpc(ws, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const dest = join(OUT, name);
  await writeFile(dest, Buffer.from(data, "base64"));
  console.log("wrote", dest);
}

const profile = join(os.tmpdir(), `pdf-studio-shot-${Date.now()}`);
await mkdir(profile, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--disable-gpu",
  "--hide-scrollbars",
  "--window-size=1440,900",
  PAGE
], { stdio: "ignore" });

let listed;
for (let i = 0; i < 40; i++) {
  try {
    listed = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    if (listed?.length) break;
  } catch {
    /* chrome still booting */
  }
  await wait(150);
}
if (!listed?.length) {
  chrome.kill();
  throw new Error("Chrome did not expose DevTools");
}

const target = listed.find((t) => t.type === "page") || listed[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

await rpc(ws, "Page.enable");
await rpc(ws, "Runtime.enable");
await rpc(ws, "Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await rpc(ws, "Page.navigate", { url: PAGE });
await wait(800);
await rpc(ws, "Runtime.evaluate", {
  expression: `document.documentElement.removeAttribute("data-theme"); document.fonts ? document.fonts.ready.then(() => true) : true`,
  awaitPromise: true
});
await wait(400);

await shot(ws, "start-desktop.png");

await rpc(ws, "Runtime.evaluate", {
  expression: `(function () {
    const pdf = new File([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x34])], "مستند-ممسوح.pdf", { type: "application/pdf" });
    const png = new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])], "صورة.png", { type: "image/png" });
    const input = document.getElementById("hub-input");
    const dt = new DataTransfer();
    dt.items.add(pdf);
    dt.items.add(png);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`
});
await wait(600);
await shot(ws, "start-files.png");

await rpc(ws, "Runtime.evaluate", {
  expression: `document.querySelector('[data-route="start"]')?.click();`
});
await wait(300);

await rpc(ws, "Runtime.evaluate", {
  expression: `document.documentElement.setAttribute("data-theme","blueprint");`
});
await wait(250);
await shot(ws, "start-dark.png");

await rpc(ws, "Runtime.evaluate", {
  expression: `document.documentElement.removeAttribute("data-theme"); document.querySelector('[data-route="scan"]')?.click();`
});
await wait(500);
await shot(ws, "scan-desktop.png");

await rpc(ws, "Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true
});
await rpc(ws, "Runtime.evaluate", {
  expression: `document.querySelector('[data-route="start"]')?.click();`
});
await wait(400);
await shot(ws, "start-mobile.png");

ws.close();
chrome.kill();
