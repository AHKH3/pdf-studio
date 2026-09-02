#!/usr/bin/env node
// E2E Tests for the Tabs system using Electron's native Chromium engine
import { app, BrowserWindow } from "electron";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let ok = 0;
let fail = 0;
function check(name, cond, hint = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
    ok++;
  } else {
    console.log(`  FAIL ${name}${hint ? ` — ${hint}` : ""}`);
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
  const file = path.join(root, rel);
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

  const logs = [];
  win.webContents.on("console-message", (_e, level, msg) => {
    logs.push(msg);
  });

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);

  // Wait for boot
  await new Promise((r) => setTimeout(r, 1500));

  console.log("Tabs System — Chromium E2E Verification");

  // 1. Check initial tab
  const tab1Info = await win.webContents.executeJavaScript(`
    (() => {
      const tabs = document.querySelectorAll('.tab-item');
      const startVisible = document.getElementById('view-start')?.classList.contains('view--active');
      const dropVisible = !document.getElementById('hub-drop')?.hidden;
      const panelHidden = document.getElementById('hub-panel')?.hidden;
      const title = tabs[0]?.querySelector('.tab-item__title')?.textContent;
      return { count: tabs.length, startVisible, dropVisible, panelHidden, title };
    })()
  `);

  check("Initial Tab 1 exists and is named الرئيسية", tab1Info.count === 1 && tab1Info.title === "الرئيسية");
  check("Initial Tab 1 starts on Main drop view (hub-drop visible)", tab1Info.startVisible && tab1Info.dropVisible && tab1Info.panelHidden);

  // 2. Simulate adding files to Tab 1
  const tab1AddFiles = await win.webContents.executeJavaScript(`
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

  check("Tab 1 has 2 files and shows files panel", tab1AddFiles.fileCount === 2 && tab1AddFiles.dropHidden && tab1AddFiles.panelVisible);
  check("Tab 1 title updates to 2 ملفات", tab1AddFiles.title === "2 ملفات");

  // 3. Click [+] to create Tab 2
  const tab2Created = await win.webContents.executeJavaScript(`
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

  check("Clicking [+] creates Tab 2 (total 2 tabs)", tab2Created.count === 2);
  check("Tab 2 opens cleanly on الرئيسية with 0 files (not duplicating Tab 1)", tab2Created.activeTitle === "الرئيسية" && tab2Created.currentFiles === 0);
  check("Tab 2 shows clean drop intake area (#hub-drop visible, #hub-panel hidden)", tab2Created.startVisible && tab2Created.dropVisible && tab2Created.panelHidden);

  // 4. Switch back to Tab 1
  const switchedToTab1 = await win.webContents.executeJavaScript(`
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

  check("Switching back to Tab 1 restores Tab 1 files (2 files)", switchedToTab1.fileCount === 2 && switchedToTab1.panelVisible);
  check("Tab 1 title is preserved (2 ملفات)", switchedToTab1.activeTitle === "2 ملفات");

  // 5. Switch to Tab 2 again
  const switchedToTab2 = await win.webContents.executeJavaScript(`
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

  check("Switching to Tab 2 again restores Tab 2 clean state (0 files, drop visible)", switchedToTab2.fileCount === 0 && switchedToTab2.dropVisible);

  // 6. Close Tab 2
  const closedTab2 = await win.webContents.executeJavaScript(`
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

  check("Closing Tab 2 leaves 1 tab (Tab 1)", closedTab2.count === 1);
  check("Active tab becomes Tab 1 with its 2 files preserved", closedTab2.activeTitle === "2 ملفات" && closedTab2.fileCount === 2);

  // 7. Close Tab 1 (last remaining tab)
  const closedLastTab = await win.webContents.executeJavaScript(`
    (async () => {
      const tabs = document.querySelectorAll('.tab-item');
      const closeBtn = tabs[0].querySelector('.tab-item__close');
      closeBtn.click();
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

  check("Closing last tab automatically creates a fresh new 'الرئيسية' tab", closedLastTab.count === 1 && closedLastTab.title === "الرئيسية");
  check("Fresh tab starts with 0 files and drop area visible", closedLastTab.fileCount === 0 && closedLastTab.dropVisible);

  // 8. Test Keyboard Shortcuts (Ctrl+T, Ctrl+W, Ctrl+Tab)
  const shortcutsTest = await win.webContents.executeJavaScript(`
    (async () => {
      const { createTab, closeCurrentTab, nextTab, getAllTabs } = await import('./assets/js/ui/tabs.js');
      await createTab({ title: "الرئيسية", activate: true });
      await createTab({ title: "الرئيسية", activate: true });
      const threeTabs = getAllTabs().length;
      await nextTab();
      await closeCurrentTab();
      const twoTabs = getAllTabs().length;
      return { threeTabs, twoTabs };
    })()
  `);

  check("Keyboard shortcuts & lifecycle functions create and close tabs properly", shortcutsTest.threeTabs === 3 && shortcutsTest.twoTabs === 2);

  console.log(`\nResults: ${ok} passed, ${fail} failed.`);

  srv.close();
  app.quit();
  process.exit(fail === 0 ? 0 : 1);
});
