const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_DIR = "C:\\Users\\abdel\\.gemini\\antigravity-ide\\brain\\a84a29aa-db28-48f3-b71f-ad9dddfa969c\\scratch";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
};

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, "http://127.0.0.1:5999").pathname;
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  fs.createReadStream(file).pipe(res);
});

server.listen(5999, "127.0.0.1", async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: false
    }
  });

  await win.loadURL("http://127.0.0.1:5999");

  // Wait for tools to load
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => {
        if (window.PDFLib && globalThis.__pdfStudioToolsLoaded) {
          Promise.resolve(globalThis.__pdfStudioToolsLoaded).then(resolve);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  `);

  console.log("App ready. Creating and loading sample PDF directly into Edit Tool...");

  await win.webContents.executeJavaScript(`
    (async () => {
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      
      const p1 = doc.addPage([595, 842]);
      p1.drawText("PDF Document Sample - Page 1", { x: 50, y: 750, size: 22, font, color: rgb(0.1, 0.2, 0.6) });
      p1.drawText("Official Report Header & Document Body Content", { x: 50, y: 700, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
      p1.drawRectangle({ x: 50, y: 300, width: 495, height: 350, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
      
      const p2 = doc.addPage([595, 842]);
      p2.drawText("PDF Document Sample - Page 2", { x: 50, y: 750, size: 22, font, color: rgb(0.6, 0.2, 0.1) });
      
      const p3 = doc.addPage([595, 842]);
      p3.drawText("PDF Document Sample - Page 3", { x: 50, y: 750, size: 22, font, color: rgb(0.1, 0.6, 0.2) });
      
      const bytes = await doc.save();
      const file = new File([bytes], "test-doc.pdf", { type: "application/pdf" });
      
      // Navigate to edit route directly
      const { route } = await import("./assets/js/ui/router.js");
      const { setCapture } = await import("./assets/js/ui/capture.js");
      setCapture([file]);
      await route("edit");
    })()
  `);

  await new Promise((r) => setTimeout(r, 2500));

  const img1 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, "screenshot-edit-initial.png"), img1.toPNG());
  console.log("Captured screenshot-edit-initial.png");

  // Select text tool
  await win.webContents.executeJavaScript(`
    const textRadio = document.querySelector('input[name="edit-tool"][value="text"]');
    if (textRadio) {
      textRadio.checked = true;
      textRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `);
  await new Promise((r) => setTimeout(r, 800));

  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, "screenshot-edit-text.png"), img2.toPNG());
  console.log("Captured screenshot-edit-text.png");

  // Select stamp tool
  await win.webContents.executeJavaScript(`
    const stampRadio = document.querySelector('input[name="edit-tool"][value="stamp"]');
    if (stampRadio) {
      stampRadio.checked = true;
      stampRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `);
  await new Promise((r) => setTimeout(r, 800));

  const img3 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, "screenshot-edit-stamp.png"), img3.toPNG());
  console.log("Captured screenshot-edit-stamp.png");

  app.exit(0);
  process.exit(0);
});
