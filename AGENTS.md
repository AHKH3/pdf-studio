# PDF Studio

PDF Studio (`أدوات PDF عربية`) is an **Electron desktop application** that provides Arabic (RTL) PDF tools: images→PDF, merge PDFs, edit/reorder pages, page numbering, and PDF→images. The UI is a static HTML/CSS/JS front end (`index.html` + `assets/`) that runs entirely client-side using `pdf-lib`, `pdfjs-dist`, and `sortablejs`. At runtime `electron/main.cjs` starts a tiny local HTTP server on `127.0.0.1` and loads it in a `BrowserWindow`.

Standard commands live in `package.json` scripts (`start`, `pack`, `dist:*`, `vendor`). There is no dev server and no lint config. The automated suite (`npm test`, `scripts/test-*.mjs`) gates every push via the Release workflow — keep it green.

## دستور مجلد الشغل — إلزامي على كل وكيل

هذا المشروع تابع لدستور مجلد الشغل. المرجع الأعلى: `C:/Users/abdel/dev/AGENTS.md` — اقرأه فورًا (هوية المستخدم، القواعد الكاملة، فهرس المشاريع). أي تعليمات محلية هنا لا تخالفه.

1. قبل تنفيذ أي ميزة أو تغيير كبير: اقرأ `docs/PROJECT.md` أو `README.md` وحدّد هل الطلب داخل النطاق المعلن.
2. طلب خارج النطاق: أوضحه للمستخدم (وقت/تعقيد/خطر كسر الموجود) ولا تنفّذ شيئًا قبل تأكيد صريح.
3. ممنوع إضافة ميزات "مساعدة" غير مطلوبة أو تعديل مجالات محظورة/مجمّدة.
4. إذا أصرّ المستخدم: سجّل القرار في `docs/DECISIONS.md` (تاريخ + طلب + قرار + تأثير) ثم أعد الفهرسة.
5. لا تعدّل القرارات المسجلة أو تعريف النطاق أو الدستور بدون إذن صريح.

## Line endings & source-reading tests — إلزامي على كل وكيل

- Repo standard is **LF**. There is no `.gitattributes`, so Windows checkouts with `core.autocrlf=true` materialize **CRLF** in the working tree.
- 2026-09-08 lesson: a CRLF `board.js` broke an exact-multiline-literal assertion in `scripts/test-edit.mjs` on CI while the same suite passed on LF checkouts. Exact string/regex matching against file bytes must never depend on line-ending style.
- Any test that reads repo sources MUST normalize first: `src.replace(/\r\n/g, "\n")` (see the `norm()` helper in `scripts/test-edit.mjs`). This covers all four combinations (LF/CRLF blobs × LF/CRLF checkouts).
- Keep committed blobs LF: if your editor writes CRLF, convert before staging so diffs stay clean (tests tolerate either, reviewers should not have to).

## Cursor Cloud specific instructions

- Running the app: `DISPLAY=:1 npm start` (runs `electron .`). A display is required; use the provided X display `:1`. Do the render/GUI testing through the Desktop pane.
- Automated tests run headless-hidden: any `PDF_STUDIO_TEST` run (all GUI cases in `scripts/test-electron-shell.mjs`) never calls `show()`/`focus()` and sets `skipTaskbar` (`isHeadlessTest()` in `electron/main.cjs`), so `npm test` never pops a window in the user's face. To launch the app hidden manually, set `PDF_STUDIO_HEADLESS=1`.
- Benign noise in Electron logs: `Failed to connect to the bus` (dbus), `Exiting GPU process due to errors during initialization`, `use-gl=angle ... swiftshader` (software WebGL), and `dconf-WARNING ... transport "disabled"` (emitted by the GTK file/save dialogs). None of these indicate a real failure — the window renders and the tools work.
- Vendored libraries: `assets/vendor/*.js` are **not** committed (git-ignored). They are copied from `node_modules` by `scripts/copy-vendor.cjs`, which runs automatically on `npm install` (postinstall) and can be re-run manually with `npm run vendor`. If you change/reinstall the `pdf-lib`/`pdfjs-dist`/`sortablejs` dependencies, re-run `npm run vendor` so the app picks up the new files (the running Electron window has no hot reload — reload the window or restart `npm start`).
- File I/O uses native GTK dialogs: importing files opens an open-dialog, and exporting a PDF triggers a browser download that opens a native "Save As" dialog. In the GTK file chooser, press `Ctrl+L` to type a path directly.
- Exports have no in-app success toast by default; confirm success by checking the saved file on disk (a valid `%PDF` file with the expected embedded image/page objects).
