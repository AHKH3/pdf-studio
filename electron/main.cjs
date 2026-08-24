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
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          res.setHeader(
            "Content-Security-Policy",
            [
              "default-src 'none'",
              "script-src 'self'",
              "worker-src 'self' blob:",
              "style-src 'self'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' blob: data:",
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
          color: chrome.bg || "#F5F1E7",
          symbolColor: chrome.symbol || "#4E4A3E",
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

async function ensureServerPort() {
  if (!staticServer) staticServer = await createStaticServer();
  return staticServer.address().port;
}

async function createWindow() {
  const port = await ensureServerPort();
  const origin = `http://127.0.0.1:${port}`;

  const iconPath = path.join(ROOT, "assets", "branding", "app-icon-512.png");
  const winOpts = {
    width: 1320,
    height: 880,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: "#FCFAF4",
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
      color: "#F5F1E7",
      symbolColor: "#4E4A3E",
      height: 40
    };
  }
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) winOpts.icon = icon;
  }

  mainWindow = new BrowserWindow(winOpts);
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The app is a single local origin; nothing may navigate it elsewhere.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault();
  });

  await mainWindow.loadURL(`${origin}/index.html`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function shutdownServer() {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
}

/**
 * Auto-updates: صامت تمامًا، لا يقطع عمل المستخدم أبدًا.
 * - الفحص والتنزيل في الخلفية، مع إرسال الحالة للهيدر.
 * - عند الجاهزية: يظهر شريط هادئ في الهيدر + يثبّت تلقائيًا عند الإغلاق.
 * - لا حوار modal يزعج المستخدم أثناء العمل.
 */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function sendUpdateStatus(payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("app:update-status", payload);
  }
}

function wireAutoUpdater() {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // يسمح بإعادة المحاولة بدون إزعاج لو فشل التحميل
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ state: "downloading", percent: 0, version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({ state: "idle" });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      state: "downloading",
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond || 0
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", () => {
    // فشل صامت — نعيد المحاولة في الفحص الدوري، بدون إزعاج
    sendUpdateStatus({ state: "idle" });
  });

  // يسمح للواجهة بطلب إعادة التشغيل فورًا
  ipcMain.handle("app:restart-to-update", () => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch {
      app.relaunch();
      app.quit();
    }
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };
  // فحص أولي بعد 8 ثوانٍ من الإقلاع (حتى لا يبطّئ فتح النافذة)
  setTimeout(check, 8000);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

// ---- أداء: تسريع الإقلاع وتقليل استهلاك الخلفية ----
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerIpc();
    await createWindow();
    wireAutoUpdater();
    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", shutdownServer);
}
