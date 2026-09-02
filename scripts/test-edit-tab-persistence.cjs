"use strict";
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARTIFACT_DIR = "C:\\Users\\abdel\\.gemini\\antigravity-ide\\brain\\a84a29aa-db28-48f3-b71f-ad9dddfa969c\\scratch";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const srv = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  const ext = path.extname(file).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm"
  };
  res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  fs.createReadStream(file).pipe(res);
});

srv.listen(0, "127.0.0.1", async () => {
  const port = srv.address().port;
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false
  });

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);

  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const check = () => {
        if (globalThis.__pdfStudioToolsLoaded) {
          Promise.resolve(globalThis.__pdfStudioToolsLoaded).then(resolve);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  `);

  console.log("Testing Tab Persistence for Edit Tool...");
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      try {
        const { route } = await import('./assets/js/ui/router.js');
        const { setCapture } = await import('./assets/js/ui/capture.js');
        const { createTab, switchTab, getAllTabs } = await import('./assets/js/ui/tabs.js');
        const { lib } = await import('./assets/js/pdf/core.js');
        const { PDFDocument, rgb } = lib();

        // 1. Create a PDF in Tab 1
        const doc = await PDFDocument.create();
        const p1 = doc.addPage([595, 842]);
        p1.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 2 });
        const p2 = doc.addPage([595, 842]);
        p2.drawRectangle({ x: 40, y: 40, width: 515, height: 762, borderColor: rgb(0.8, 0.2, 0.4), borderWidth: 2 });

        const bytes = await doc.save();
        const file = new File([bytes], "contract.pdf", { type: "application/pdf" });
        setCapture([file]);
        await route("edit");
        await new Promise(r => setTimeout(r, 1200));

        // Add a text element to Tab 1
        const textRadio = document.querySelector('input[name="edit-tool"][value="text"]');
        if (textRadio) {
          textRadio.checked = true;
          textRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const board = document.getElementById('edit-board');
        if (board) {
          board.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 400 }));
          board.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 600, clientY: 400 }));
        }
        await new Promise(r => setTimeout(r, 600));

        const tab1ObjsBefore = document.querySelectorAll('.edit-obj').length;
        const tab1WorkspaceBefore = document.getElementById('edit-workspace')?.hidden === false;

        // 2. Open Tab 2
        await createTab({ title: "تابة ثانية", activate: true });
        await new Promise(r => setTimeout(r, 600));

        const tab2View = document.querySelector('.view--active')?.id;

        // 3. Switch back to Tab 1
        const tabs = getAllTabs();
        await switchTab(tabs[0].id);
        await new Promise(r => setTimeout(r, 1500));

        const tab1WorkspaceAfter = document.getElementById('edit-workspace')?.hidden === false;
        const tab1DropAfter = document.getElementById('edit-drop')?.hidden === true;
        const tab1ObjsAfter = document.querySelectorAll('.edit-obj').length;

        return {
          tab1ObjsBefore,
          tab1WorkspaceBefore,
          tab2View,
          tab1WorkspaceAfter,
          tab1DropAfter,
          tab1ObjsAfter
        };
      } catch (e) {
        return { error: e.message, stack: e.stack };
      }
    })()
  `);

  console.log("Tab Persistence Test Result:", result);

  // Take screenshot of restored Edit workspace
  await new Promise((r) => setTimeout(r, 800));
  const imgRestored = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, "screenshot-edit-restored.png"), imgRestored.toPNG());
  console.log("Saved screenshot-edit-restored.png");

  // Open Shapes dropdown to verify popover menu
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const menu = document.getElementById('edit-shapes-menu');
      if (menu) menu.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    })
  `);
  await new Promise((r) => setTimeout(r, 600));

  const imgShapes = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ARTIFACT_DIR, "screenshot-edit-shapes-dropdown.png"), imgShapes.toPNG());
  console.log("Saved screenshot-edit-shapes-dropdown.png");

  app.exit(0);
  process.exit(0);
});
