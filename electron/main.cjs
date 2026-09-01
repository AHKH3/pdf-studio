"use strict";
const { app, BrowserWindow, shell, nativeImage, ipcMain, dialog, Menu } = require("electron");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  /* electron-updater is missing in dev or a broken install — the app still runs */
}
const path = require("path");
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");

const ROOT = path.join(__dirname, "..");
const BOOT_T0 = Date.now();
const BACKGROUND_UPDATE_FLAG = "--background-update";
const EXIT_WATCHDOG_MS = 5000;
const BACKGROUND_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UNSAVED_QUERY_MS = 1000;

function argvHasFlag(argv, flag) {
  return Array.isArray(argv) && argv.includes(flag);
}

/** Everything the renderer is allowed to fetch. Anything else 404s. */
const SERVED_PREFIXES = ["assets/", "index.html"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".webp": "image/webp"
};

function guessMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeFilePath(requestPath) {
  const raw = (requestPath || "/").split("?")[0];
  let rel;
  try {
    rel = decodeURIComponent(raw).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!rel) rel = "index.html";
  if (!SERVED_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix))) return null;

  const rootResolved = path.resolve(ROOT);
  const candidate = path.resolve(path.join(rootResolved, rel));
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (candidate !== rootResolved && !candidate.startsWith(prefix)) return null;
  return candidate;
}

/**
 * A local origin is what makes ES modules, workers, and a real CSP possible.
 * `file://` would block all three.
 */
function createStaticServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        const urlPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
        const filePath = safeFilePath(urlPath);
        if (!filePath) {
          res.writeHead(404);
          return res.end("Not found");
        }
        fs.stat(filePath, (err, st) => {
          if (err || !st.isFile()) {
            res.writeHead(404);
            return res.end("Not found");
          }
          res.setHeader("Content-Type", guessMime(filePath));
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          // credentialless: يسمح لـ WASM/workers بالعمل دون مطالبة كل مورد بـ CORP، مع الحفاظ على عزل الأصل المتقاطع
          res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          res.setHeader(
            "Content-Security-Policy",
            [
              "default-src 'none'",
              // wasm-unsafe-eval: يسمح لـ pdf.js/tesseract/heic2any بتجميع WASM دون فتح eval الكامل
              // unsafe-eval: مطلوب لـ heic2any (يستخدم new Function داخليًا)
              "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
              "worker-src 'self' blob:",
              // unsafe-inline: حقن <style> عبر JS (injectStyles) وإسناد element.style
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' blob: data:",
              "media-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'none'",
              "frame-ancestors 'none'"
            ].join("; ")
          );
          if (/\.(js|mjs|css)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
          } else if (/\.(png|jpg|jpeg|webp|woff2?)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=86400");
          }
          fs.createReadStream(filePath).pipe(res);
        });
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
    srv.on("error", reject);
  });
}

const SAVE_FILTERS = {
  pdf: [{ name: "PDF", extensions: ["pdf"] }],
  png: [{ name: "PNG", extensions: ["png"] }],
  jpeg: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
  zip: [{ name: "ZIP", extensions: ["zip"] }]
};

function sanitiseSegment(name) {
  return String(name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 180) || "file";
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function registerIpc() {
  ipcMain.handle("window:set-chrome", async (_event, chrome) => {
    const win = getMainWindow();
    if (!win || !chrome) return;
    try {
      if (typeof chrome.bg === "string" && chrome.bg) win.setBackgroundColor(chrome.bg);
      if (typeof win.setTitleBarOverlay === "function" && process.platform === "win32") {
        win.setTitleBarOverlay({
          color: chrome.bg || "#FFFFFF",
          symbolColor: chrome.symbol || "#475569",
          height: 40
        });
      }
    } catch {
      /* setTitleBarOverlay is Windows-only when titleBarOverlay is enabled */
    }
  });

  ipcMain.handle("window:minimize", () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle("window:toggle-maximize", () => {
    const win = getMainWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle("window:close", () => {
    getMainWindow()?.close();
  });

  ipcMain.handle("pdf-studio:save-file", async (event, request, data) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { saved: false };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: sanitiseSegment(request?.suggestedName),
      filters: SAVE_FILTERS[request?.kind] || []
    });
    if (canceled || !filePath) return { saved: false };
    await fsp.writeFile(filePath, Buffer.from(data));
    return { saved: true, name: path.basename(filePath) };
  });

  ipcMain.handle("pdf-studio:save-folder", async (event, request, files) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !Array.isArray(files) || !files.length) return { saved: false };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "حفظ هنا"
    });
    if (canceled || !filePaths?.length) return { saved: false };

    const target = path.join(filePaths[0], sanitiseSegment(request?.suggestedName));
    await fsp.mkdir(target, { recursive: true });
    for (const file of files) {
      await fsp.writeFile(path.join(target, sanitiseSegment(file.name)), Buffer.from(file.data));
    }
    return { saved: true, name: path.basename(target), count: files.length };
  });
}

let mainWindow = null;
let staticServer = null;
let serverPromise = null;
let forceClose = false;
let closeInFlight = false;
let exitWatchdog = null;
let updaterWired = false;
let restartHandlerReady = false;
let updateReadyToInstall = false;
let updateInstallStarted = false;
let runMode = argvHasFlag(process.argv, BACKGROUND_UPDATE_FLAG) ? "background" : "ui";

function bootLog(msg) {
  console.log(`[boot] ${msg} ${Date.now() - BOOT_T0}ms`);
}

async function waitRenderer(win, expr, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (!win || win.isDestroyed()) return null;
    const value = await win.webContents.executeJavaScript(expr, true).catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Opt-in probe for scripts/test-electron-shell.mjs — no-op in production. */
async function runTestProbe(win) {
  const mode = process.env.PDF_STUDIO_TEST;
  if (!mode || !win || win.isDestroyed()) return;

  const boot = await waitRenderer(win, "globalThis.__pdfStudioBoot || null");
  if (boot && typeof boot === "object") {
    console.log(`[boot] hero-ms ${boot.heroMs} fcp-ms ${boot.fcpMs}`);
  }

  if (mode === "hold") {
    console.log("[test] holding");
    return;
  }

  if (mode === "boot") {
    const tools = await waitRenderer(
      win,
      "Promise.resolve(globalThis.__pdfStudioToolsLoaded).then((ids) => (Array.isArray(ids) ? ids.length : 0))",
      120
    );
    const unsaved = await win.webContents
      .executeJavaScript("typeof __pdfStudioHasUnsavedWork==='function'&&__pdfStudioHasUnsavedWork()", true)
      .catch(() => "err");
    console.log(`[test] tools ${tools} unsaved ${unsaved}`);
    forceClose = true;
    armExitWatchdog();
    app.exit(0);
    return;
  }

  if (mode === "dirty-tools") {
    await waitRenderer(
      win,
      "Promise.resolve(globalThis.__pdfStudioToolsLoaded).then((ids) => (Array.isArray(ids) ? ids.length : 0))",
      120
    );
    const result = await win.webContents
      .executeJavaScript(
        `(async () => {
          const lib = window.PDFLib;
          if (!lib) return { error: "no-pdflib" };
          const doc = await lib.PDFDocument.create();
          const page = doc.addPage([595, 842]);
          const font = await doc.embedFont(lib.StandardFonts.Helvetica);
          page.drawText("sample", { x: 72, y: 720, size: 18, font });
          const bytes = await doc.save();
          const file = new File([bytes], "sample.pdf", { type: "application/pdf" });
          const dt = new DataTransfer();
          dt.items.add(file);
          const drop = document.getElementById("hub-drop");
          if (!drop) return { error: "no-drop" };
          drop.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
          await new Promise((r) => setTimeout(r, 500));

          const ids = ["organize", "split", "compress", "watermark", "numbers", "rasterize", "edit"];
          const dirty = {};
          for (const id of ids) {
            const btn = document.querySelector("[data-route='" + id + "']");
            if (!btn) {
              dirty[id] = "missing-button";
              continue;
            }
            btn.click();
            await new Promise((r) => setTimeout(r, 200));
            const leave = document.querySelector(".progress.is-open .btn--act");
            if (leave) {
              leave.click();
              await new Promise((r) => setTimeout(r, 400));
            }
            await new Promise((r) => setTimeout(r, 700));
            const idsDirty = typeof __pdfStudioDirtyToolIds === "function" ? __pdfStudioDirtyToolIds() : [];
            dirty[id] = idsDirty.includes(id);
          }
          return { dirty, hasFile: true };
        })()`,
        true
      )
      .catch((error) => ({ error: String(error) }));
    console.log("[test] dirty-tools " + JSON.stringify(result));
    forceClose = true;
    armExitWatchdog();
    app.exit(0);
    return;
  }

  if (mode === "close-clean" || mode === "close-unsaved-stay" || mode === "close-unsaved-close") {
    await waitRenderer(win, "typeof __pdfStudioHasUnsavedWork==='function'");
    if (mode !== "close-clean") {
      await win.webContents
        .executeJavaScript("globalThis.__pdfStudioHasUnsavedWork=()=>true", true)
        .catch(() => {});
    }
    if (!win.isDestroyed()) win.close();
    if (mode === "close-unsaved-stay") {
      setTimeout(() => {
        const alive = Boolean(getMainWindow() && !getMainWindow().isDestroyed());
        console.log(`[test] stayed ${alive}`);
        forceClose = true;
        app.exit(alive ? 0 : 1);
      }, 1200);
    }
  }
}

function ensureServer() {
  if (!serverPromise) {
    serverPromise = createStaticServer().then((srv) => {
      staticServer = srv;
      bootLog(`server :${srv.address().port}`);
      return srv;
    });
  }
  return serverPromise;
}

function armExitWatchdog() {
  if (exitWatchdog) return;
  exitWatchdog = setTimeout(() => {
    console.warn("[close] watchdog — app.exit(0)");
    app.exit(0);
  }, EXIT_WATCHDOG_MS);
}

async function queryRendererUnsaved(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  const script =
    "typeof __pdfStudioHasUnsavedWork==='function'&&__pdfStudioHasUnsavedWork()===true";
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise((resolve) => setTimeout(() => resolve(false), UNSAVED_QUERY_MS))
    ]);
  } catch {
    return false;
  }
}

async function confirmCloseIfUnsaved(win) {
  const testChoice = process.env.PDF_STUDIO_TEST_UNSAVED;
  if (testChoice === "close") return true;
  if (testChoice === "stay") {
    const unsaved = await queryRendererUnsaved(win);
    return !unsaved;
  }

  const unsaved = await queryRendererUnsaved(win);
  if (!unsaved || !win || win.isDestroyed()) return true;

  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["إغلاق", "البقاء"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: "عمل غير محفوظ",
    message: "لديك عمل غير محفوظ.",
    detail: "الإغلاق يتخلّص من العمل الذي لم يُحفظ."
  });
  return response === 0;
}

function attachCloseGuard(win) {
  win.on("close", (event) => {
    if (forceClose) return;
    event.preventDefault();
    if (closeInFlight) return;
    closeInFlight = true;
    void (async () => {
      const ok = await confirmCloseIfUnsaved(win);
      if (!ok) {
        closeInFlight = false;
        return;
      }
      if (updateReadyToInstall && installDownloadedUpdateAndRelaunch()) return;
      forceClose = true;
      armExitWatchdog();
      if (!win.isDestroyed()) win.close();
    })().catch(() => {
      if (updateReadyToInstall && installDownloadedUpdateAndRelaunch()) return;
      forceClose = true;
      armExitWatchdog();
      if (!win.isDestroyed()) win.close();
      else app.exit(0);
    });
  });
}

function revealWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "win32") {
    win.setAlwaysOnTop(true);
    win.focus();
    win.setAlwaysOnTop(false);
  }
}

async function createWindow() {
  const serverReady = ensureServer();

  const iconPath = path.join(ROOT, "assets", "branding", "app-icon-512.png");
  const winOpts = {
    width: 1320,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: "#FFFFFF",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  };
  if (process.platform === "win32") {
    winOpts.titleBarOverlay = {
      color: "#FFFFFF",
      symbolColor: "#475569",
      height: 40
    };
  }
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) winOpts.icon = icon;
  }

  mainWindow = new BrowserWindow(winOpts);
  attachCloseGuard(mainWindow);
  mainWindow.center();

  // احتياط: إذا لم يطلق ready-to-show خلال 3 ثوانٍ (خطأ CSP/JS)، أظهر النافذة قسراً حتى لا يبدو التطبيق متوقفاً
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn("ready-to-show لم يطلق — إظهار قسري للنافذة");
      revealWindow(mainWindow);
    }
  }, 3500);
  mainWindow.once("ready-to-show", () => {
    clearTimeout(showFallback);
    bootLog("ready-to-show");
    revealWindow(mainWindow);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2 || !app.isPackaged) {
      console.log(`[renderer:${level}] ${message} (${sourceId || ""}:${line})`);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("render-process-gone", details);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const srv = await serverReady;
  const origin = `http://127.0.0.1:${srv.address().port}`;

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault();
  });

  await mainWindow.loadURL(`${origin}/index.html`);
  bootLog("loadURL");
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    revealWindow(mainWindow);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void runTestProbe(mainWindow);
}

function shutdownServer() {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
}

function sendUpdateStatus(payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("app:update-status", payload);
  }
}

function finishBackgroundIfStillHeadless() {
  if (runMode === "background") app.exit(0);
}

/** Silent NSIS install (/S) + force relaunch (--force-run). All install paths use this. */
function installDownloadedUpdateAndRelaunch() {
  if (!autoUpdater || updateInstallStarted) return false;
  updateInstallStarted = true;
  forceClose = true;
  armExitWatchdog();
  try {
    autoUpdater.quitAndInstall(true, true);
    return true;
  } catch {
    updateInstallStarted = false;
    return false;
  }
}

function wireAutoUpdater() {
  if (!autoUpdater || updaterWired) return;
  if (!app.isPackaged && runMode === "ui") return;
  updaterWired = true;

  autoUpdater.autoDownload = true;
  // We install ourselves via quitAndInstall(true, true) so the app always relaunches.
  // electron-updater's quit handler uses install(true, false) which skips --force-run.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    if (runMode === "ui") sendUpdateStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    if (runMode === "ui") sendUpdateStatus({ state: "downloading", percent: 0, version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    if (runMode === "ui") sendUpdateStatus({ state: "idle" });
    else finishBackgroundIfStillHeadless();
  });
  autoUpdater.on("download-progress", (progress) => {
    if (runMode !== "ui") return;
    sendUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    updateReadyToInstall = true;
    if (runMode === "ui") {
      sendUpdateStatus({ state: "ready", version: info.version });
      return;
    }
    if (!installDownloadedUpdateAndRelaunch()) app.exit(0);
  });
  autoUpdater.on("error", () => {
    if (runMode === "ui") sendUpdateStatus({ state: "idle" });
    else finishBackgroundIfStillHeadless();
  });

  if (!restartHandlerReady) {
    restartHandlerReady = true;
    ipcMain.handle("app:restart-to-update", () => {
      if (installDownloadedUpdateAndRelaunch()) return;
      try {
        app.relaunch();
        app.quit();
      } catch {
        app.exit(0);
      }
    });
  }
}

function startUpdateChecks() {
  if (!app.isPackaged || !autoUpdater) {
    if (runMode === "background") {
      console.log("[update] background-update skipped (unpackaged)");
      app.exit(0);
    }
    return;
  }

  wireAutoUpdater();

  if (runMode === "background") {
    setTimeout(() => finishBackgroundIfStillHeadless(), BACKGROUND_UPDATE_TIMEOUT_MS);
    autoUpdater.checkForUpdates().catch(() => finishBackgroundIfStillHeadless());
    return;
  }

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 8000);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

function shouldRequestLock() {
  if (runMode === "background") return true;
  if (app.isPackaged) return true;
  if (process.env.PDF_STUDIO_SINGLE_INSTANCE === "1") return true;
  return false;
}

function focusMainWindow() {
  const win = getMainWindow();
  if (!win) return;
  revealWindow(win);
}

async function promoteBackgroundToUi() {
  if (runMode === "ui" && getMainWindow()) {
    focusMainWindow();
    return;
  }
  runMode = "ui";
  try {
    app.dock?.show?.();
  } catch {
    /* macOS only */
  }
  if (!getMainWindow()) await createWindow();
  startUpdateChecks();
}

if (
  process.env.PDF_STUDIO_DISABLE_GPU === "1" ||
  process.env.ELECTRON_DISABLE_GPU === "1" ||
  argvHasFlag(process.argv, "--disable-gpu") ||
  argvHasFlag(process.argv, "--disable-software-rasterizer")
) {
  app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const gotLock = shouldRequestLock() ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  console.log("[instance] lock held — quitting this instance");
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const secondIsBackground = argvHasFlag(argv, BACKGROUND_UPDATE_FLAG);
    if (secondIsBackground) {
      console.log("[instance] ignoring background-update (app already open)");
      if (runMode === "ui" && app.isPackaged && autoUpdater) {
        autoUpdater.checkForUpdates().catch(() => {});
      }
      return;
    }
    if (runMode === "background") {
      console.log("[instance] promoting background-update to UI");
      void promoteBackgroundToUi();
      return;
    }
    focusMainWindow();
  });

  if (runMode === "ui") ensureServer();

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerIpc();
    if (runMode === "background") {
      try {
        app.dock?.hide?.();
      } catch {
        /* macOS only */
      }
      startUpdateChecks();
      return;
    }
    await createWindow();
    startUpdateChecks();
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        runMode = "ui";
        await createWindow();
      }
    });
  });

  app.on("child-process-gone", (_event, details) => {
    if (details?.type === "GPU") {
      console.warn(`[gpu] GPU process exited (${details.reason || details.exitCode})`);
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("window-all-closed", () => {
    if (runMode === "background") return;
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    shutdownServer();
    if (
      runMode === "ui" &&
      updateReadyToInstall &&
      !updateInstallStarted &&
      autoUpdater &&
      app.isPackaged
    ) {
      event.preventDefault();
      if (!installDownloadedUpdateAndRelaunch()) app.exit(0);
    }
  });
}
