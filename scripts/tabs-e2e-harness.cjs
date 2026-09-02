
"use strict";
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let ok = 0;
let fail = 0;
function check(name, cond, hint = "") {
  if (cond) {
    console.log("  ok   " + name);
    ok++;
  } else {
    console.log("  FAIL " + name + (hint ? " — " + hint : ""));
    fail++;
  }
}

const srv = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  let rel;
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  } catch {
    res.writeHead(400);
    return res.end();
  }
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
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  fs.createReadStream(file).pipe(res);
});

srv.listen(0, "127.0.0.1", async () => {
  const port = srv.address().port;
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await win.loadURL("http://127.0.0.1:" + port + "/index.html");
  await new Promise((r) => setTimeout(r, 1200));

  console.log("Tabs System — Chromium E2E Verification");

  // 1. Initial tab check
  const tab1 = await win.webContents.executeJavaScript(`
    (() => {
      const tabs = document.querySelectorAll('.tab-item');
      const startVisible = document.getElementById('view-start')?.classList.contains('view--active');
      const dropVisible = !document.getElementById('hub-drop')?.hidden;
      const panelHidden = document.getElementById('hub-panel')?.hidden;
      const title = tabs[0]?.querySelector('.tab-item__title')?.textContent;
      return { count: tabs.length, startVisible, dropVisible, panelHidden, title };
    })()
  `);

  check("Initial Tab 1 exists and is named الرئيسية", tab1.count === 1 && tab1.title === "الرئيسية");
  check("Initial Tab 1 starts on Main drop view (hub-drop visible)", tab1.startVisible && tab1.dropVisible && tab1.panelHidden);

  // 2. Add files to Tab 1
  const tab1Files = await win.webContents.executeJavaScript(`
    (async () => {
      const { setCapture, captureFiles } = await import('./assets/js/ui/capture.js');
      const f1 = new File([new Uint8Array([1, 2, 3])], "document1.pdf", { type: "application/pdf" });
      const f2 = new File([new Uint8Array([4, 5, 6])], "document2.pdf", { type: "application/pdf" });
      setCapture([f1, f2]);
      await new Promise(r => setTimeout(r, 100));
      const tabs = document.querySelectorAll('.tab-item');
      const title = tabs[0]?.querySelector('.tab-item__title')?.textContent;
      const dropHidden = document.getElementById('hub-drop')?.hidden;
      const panelVisible = !document.getElementById('hub-panel')?.hidden;
      return { fileCount: captureFiles().length, title, dropHidden, panelVisible };
    })()
  `);

  check("Tab 1 has 2 files and shows files panel", tab1Files.fileCount === 2 && tab1Files.dropHidden && tab1Files.panelVisible);
  check("Tab 1 title updates to 2 ملفات", tab1Files.title === "2 ملفات");

  // 3. Click [+] to create Tab 2
  const tab2 = await win.webContents.executeJavaScript(`
    (async () => {
      const addBtn = document.getElementById('tab-add');
      addBtn.click();
      await new Promise(r => setTimeout(r, 200));
      const tabs = document.querySelectorAll('.tab-item');
      const activeTab = document.querySelector('.tab-item--active');
      const activeTitle = activeTab?.querySelector('.tab-item__title')?.textContent;
      const startVisible = document.getElementById('view-start')?.classList.contains('view--active');
      const dropVisible = !document.getElementById('hub-drop')?.hidden;
      const panelHidden = document.getElementById('hub-panel')?.hidden;
      const { captureFiles } = await import('./assets/js/ui/capture.js');
      return {
        count: tabs.length,
        activeTitle,
        startVisible,
        dropVisible,
        panelHidden,
        currentFiles: captureFiles().length
      };
    })()
  `);

  check("Clicking [+] creates Tab 2 (total 2 tabs)", tab2.count === 2);
  check("Tab 2 opens cleanly on الرئيسية with 0 files (not duplicating Tab 1)", tab2.activeTitle === "الرئيسية" && tab2.currentFiles === 0);
  check("Tab 2 shows clean drop intake area (#hub-drop visible, #hub-panel hidden)", tab2.startVisible && tab2.dropVisible && tab2.panelHidden);

  // 4. Switch back to Tab 1
  const backToTab1 = await win.webContents.executeJavaScript(`
    (async () => {
      const tabs = document.querySelectorAll('.tab-item');
      tabs[0].click();
      await new Promise(r => setTimeout(r, 200));
      const activeTab = document.querySelector('.tab-item--active');
      const activeTitle = activeTab?.querySelector('.tab-item__title')?.textContent;
      const { captureFiles } = await import('./assets/js/ui/capture.js');
      const panelVisible = !document.getElementById('hub-panel')?.hidden;
      return {
        activeTitle,
        fileCount: captureFiles().length,
        panelVisible
      };
    })()
  `);

  check("Switching back to Tab 1 restores Tab 1 files (2 files)", backToTab1.fileCount === 2 && backToTab1.panelVisible);
  check("Tab 1 title is preserved (2 ملفات)", backToTab1.activeTitle === "2 ملفات");

  // 5. Switch to Tab 2 again
  const backToTab2 = await win.webContents.executeJavaScript(`
    (async () => {
      const tabs = document.querySelectorAll('.tab-item');
      tabs[1].click();
      await new Promise(r => setTimeout(r, 200));
      const { captureFiles } = await import('./assets/js/ui/capture.js');
      const dropVisible = !document.getElementById('hub-drop')?.hidden;
      return {
        fileCount: captureFiles().length,
        dropVisible
      };
    })()
  `);

  check("Switching to Tab 2 again restores Tab 2 clean state (0 files, drop visible)", backToTab2.fileCount === 0 && backToTab2.dropVisible);

  // 6. Close Tab 2
  const closeTab2Res = await win.webContents.executeJavaScript(`
    (async () => {
      const tabs = document.querySelectorAll('.tab-item');
      const closeBtn = tabs[1].querySelector('.tab-item__close');
      closeBtn.click();
      await new Promise(r => setTimeout(r, 200));
      const tabsAfter = document.querySelectorAll('.tab-item');
      const { captureFiles } = await import('./assets/js/ui/capture.js');
      return {
        count: tabsAfter.length,
        activeTitle: document.querySelector('.tab-item--active')?.querySelector('.tab-item__title')?.textContent,
        fileCount: captureFiles().length
      };
    })()
  `);

  check("Closing Tab 2 leaves 1 tab (Tab 1)", closeTab2Res.count === 1);
  check("Active tab becomes Tab 1 with its 2 files preserved", closeTab2Res.activeTitle === "2 ملفات" && closeTab2Res.fileCount === 2);

  // 7. Test Cross-Tool Route Isolation: Tab 1 enters Merge -> Tab 2 created -> Tab 2 is on Start Hub
  const routeIsolation = await win.webContents.executeJavaScript(`
    (async () => {
      const { route } = await import('./assets/js/ui/router.js');
      const { setCapture, captureFiles } = await import('./assets/js/ui/capture.js');
      const { createTab, getAllTabs, switchTab } = await import('./assets/js/ui/tabs.js');
      const { lib } = await import('./assets/js/pdf/core.js');
      const { PDFDocument } = lib();

      // Ensure Tab 1 has files and is on merge
      const doc1 = await PDFDocument.create();
      doc1.addPage([200, 200]);
      const bytes1 = await doc1.save();
      const doc2 = await PDFDocument.create();
      doc2.addPage([200, 200]);
      const bytes2 = await doc2.save();

      const f1 = new File([bytes1], "DocA.pdf", { type: "application/pdf" });
      const f2 = new File([bytes2], "DocB.pdf", { type: "application/pdf" });
      setCapture([f1, f2]);
      await route("merge");
      await new Promise(r => setTimeout(r, 400));

      const tab1ActiveView = document.querySelector('.view--active')?.id;

      // Click [+] to create Tab 2
      const addBtn = document.getElementById('tab-add');
      addBtn.click();
      await new Promise(r => setTimeout(r, 400));

      const tab2ActiveView = document.querySelector('.view--active')?.id;
      const tab2Title = document.querySelector('.tab-item--active .tab-item__title')?.textContent;
      const tab2Files = captureFiles().length;

      // In Tab 2, visit merge with 0 files
      await route("merge");
      await new Promise(r => setTimeout(r, 400));
      const tab2MergePanelHidden = document.getElementById('merge-panel')?.hidden;
      const tab2MergeDropHidden = document.getElementById('merge-drop')?.hidden;

      // Switch back to Tab 1
      const all = getAllTabs();
      await switchTab(all[0].id);
      await new Promise(r => setTimeout(r, 400));
      const tab1RestoredView = document.querySelector('.view--active')?.id;
      const tab1RestoredTitle = document.querySelector('.tab-item--active .tab-item__title')?.textContent;
      const tab1RestoredFiles = captureFiles().length;

      return {
        tab1ActiveView,
        tab2ActiveView,
        tab2Title,
        tab2Files,
        tab2MergePanelHidden,
        tab2MergeDropHidden,
        tab1RestoredView,
        tab1RestoredTitle,
        tab1RestoredFiles
      };
    })()
  `);

  check("Tab 1 navigates to Merge view", routeIsolation.tab1ActiveView === "view-merge");
  check("Creating Tab 2 opens on Start Hub with 0 files (not copying Merge from Tab 1)", routeIsolation.tab2ActiveView === "view-start" && routeIsolation.tab2Title === "الرئيسية" && routeIsolation.tab2Files === 0);
  check("Tab 2 visiting Merge with 0 files shows empty drop area without Tab 1 files", routeIsolation.tab2MergePanelHidden && !routeIsolation.tab2MergeDropHidden);
  check("Switching back to Tab 1 restores Merge view with Tab 1 files intact", routeIsolation.tab1RestoredView === "view-merge" && routeIsolation.tab1RestoredFiles === 2);

  // 8. Close last tab
  const closeLastRes = await win.webContents.executeJavaScript(`
    (async () => {
      const { getAllTabs, closeTab, createTab } = await import('./assets/js/ui/tabs.js');
      const all = getAllTabs();
      for (const t of all) {
        await closeTab(t.id);
      }
      await new Promise(r => setTimeout(r, 200));
      const tabsAfter = document.querySelectorAll('.tab-item');
      const { captureFiles } = await import('./assets/js/ui/capture.js');
      const dropVisible = !document.getElementById('hub-drop')?.hidden;
      return {
        count: tabsAfter.length,
        title: tabsAfter[0]?.querySelector('.tab-item__title')?.textContent,
        fileCount: captureFiles().length,
        dropVisible
      };
    })()
  `);

  check("Closing all tabs automatically creates a fresh new 'الرئيسية' tab", closeLastRes.count === 1 && closeLastRes.title === "الرئيسية");
  check("Fresh tab starts with 0 files and drop area visible", closeLastRes.fileCount === 0 && closeLastRes.dropVisible);

  console.log("TABS_RESULT " + Buffer.from(JSON.stringify({ ok, fail })).toString("base64"));
  srv.close();
  app.quit();
});
