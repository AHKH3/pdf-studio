# PDF Studio

PDF Studio (`أدوات PDF عربية`) is an **Electron desktop application** that provides Arabic (RTL) PDF tools: images→PDF, merge PDFs, edit/reorder pages, watermark, page numbering, and PDF→images. The UI is a static HTML/CSS/JS front end (`index.html` + `assets/`) that runs entirely client-side using `pdf-lib`, `pdfjs-dist`, and `sortablejs`. At runtime `electron/main.cjs` starts a tiny local HTTP server on `127.0.0.1` and loads it in a `BrowserWindow`.

Standard commands live in `package.json` scripts (`start`, `pack`, `dist:*`, `vendor`). There is no dev server, no lint config, and no automated test suite in this repo.

## دستور مجلد الشغل — إلزامي على كل وكيل

هذا المشروع تابع لدستور مجلد الشغل. المرجع الأعلى: `C:/Users/abdel/dev/AGENTS.md` — اقرأه فورًا (هوية المستخدم، القواعد الكاملة، فهرس المشاريع). أي تعليمات محلية هنا لا تخالفه.

1. قبل تنفيذ أي ميزة أو تغيير كبير: اقرأ `docs/PROJECT.md` أو `README.md` وحدّد هل الطلب داخل النطاق المعلن.
2. طلب خارج النطاق: أوضحه للمستخدم (وقت/تعقيد/خطر كسر الموجود) ولا تنفّذ شيئًا قبل تأكيد صريح.
3. ممنوع إضافة ميزات "مساعدة" غير مطلوبة أو تعديل مجالات محظورة/مجمّدة.
4. إذا أصرّ المستخدم: سجّل القرار في `docs/DECISIONS.md` (تاريخ + طلب + قرار + تأثير) ثم أعد الفهرسة.
5. لا تعدّل القرارات المسجلة أو تعريف النطاق أو الدستور بدون إذن صريح.

## Cursor Cloud specific instructions

- Running the app: `DISPLAY=:1 npm start` (runs `electron .`). A display is required; use the provided X display `:1`. Do the render/GUI testing through the Desktop pane.
- Benign noise in Electron logs: `Failed to connect to the bus` (dbus), `Exiting GPU process due to errors during initialization`, `use-gl=angle ... swiftshader` (software WebGL), and `dconf-WARNING ... transport "disabled"` (emitted by the GTK file/save dialogs). None of these indicate a real failure — the window renders and the tools work.
- Vendored libraries: `assets/vendor/*.js` are **not** committed (git-ignored). They are copied from `node_modules` by `scripts/copy-vendor.cjs`, which runs automatically on `npm install` (postinstall) and can be re-run manually with `npm run vendor`. If you change/reinstall the `pdf-lib`/`pdfjs-dist`/`sortablejs` dependencies, re-run `npm run vendor` so the app picks up the new files (the running Electron window has no hot reload — reload the window or restart `npm start`).
- File I/O uses native GTK dialogs: importing files opens an open-dialog, and exporting a PDF triggers a browser download that opens a native "Save As" dialog. In the GTK file chooser, press `Ctrl+L` to type a path directly.
- Exports have no in-app success toast by default; confirm success by checking the saved file on disk (a valid `%PDF` file with the expected embedded image/page objects).

## Antigravity / Windows specific instructions

> **CRITICAL — READ BEFORE DEBUGGING "window not showing":**
> On Windows, Antigravity runs commands in a **background session** that is separate from the user's interactive desktop. Any Electron (GUI) window launched from Antigravity's terminal **will not appear on the user's screen**. This is an OS-level session isolation — NOT a code bug. Electron will report `isVisible: true` and `ready-to-show` will fire, but the window physically cannot render on the user's display.

- **DO NOT** attempt to "fix" window visibility by changing `show`, `titleBarStyle`, `titleBarOverlay`, GPU flags, or any other `BrowserWindow` options when the only evidence is that the user "can't see the window" after running from Antigravity's terminal.
- **Testing the app**: Tell the user to run `npm start` from **their own PowerShell/CMD terminal** (not Antigravity's). The app works correctly when launched from the user's session.
- **Launching the app from Antigravity**: Use `explorer.exe "C:\Users\abdel\dev\pdf-studio\start.bat"` — this delegates the launch to `explorer.exe` which always runs in the user's interactive desktop session. The window will appear on the user's screen. You will NOT get stdout/stderr back (use `node scripts/check-syntax.mjs` or `npm test` for verification instead).
- **Verifying code changes**: Use `node scripts/check-syntax.mjs` (runs without a display). For renderer-level checks, use `node scripts/test-launch.mjs` or the test suite via `npm test`. These verify parsing, imports, DOM IDs, and boot without requiring a visible window.
- **Benign Electron logs**: The CSP warning (`Insecure Content-Security-Policy`) only appears in dev mode and disappears once packaged. GPU warnings (`Exiting GPU process`) are normal in headless/background sessions.
- **Custom titlebar**: The app uses `titleBarStyle: "hidden"` with `titleBarOverlay` on Windows to provide a custom header with the app's own minimize/maximize/close buttons (defined in `index.html`). **Do not remove these settings** — they are intentional.

