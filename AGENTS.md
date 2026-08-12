# PDF Studio

PDF Studio (`أدوات PDF عربية`) is an **Electron desktop application** that provides Arabic (RTL) PDF tools: images→PDF, merge PDFs, edit/reorder pages, watermark, page numbering, and PDF→images. The UI is a static HTML/CSS/JS front end (`index.html` + `assets/`) that runs entirely client-side using `pdf-lib`, `pdfjs-dist`, and `sortablejs`. At runtime `electron/main.cjs` starts a tiny local HTTP server on `127.0.0.1` and loads it in a `BrowserWindow`.

Standard commands live in `package.json` scripts (`start`, `pack`, `dist:*`, `vendor`). There is no dev server, no lint config, and no automated test suite in this repo.

## Cursor Cloud specific instructions

- Running the app: `DISPLAY=:1 npm start` (runs `electron .`). A display is required; use the provided X display `:1`. Do the render/GUI testing through the Desktop pane.
- Benign noise in Electron logs: `Failed to connect to the bus` (dbus), `Exiting GPU process due to errors during initialization`, `use-gl=angle ... swiftshader` (software WebGL), and `dconf-WARNING ... transport "disabled"` (emitted by the GTK file/save dialogs). None of these indicate a real failure — the window renders and the tools work.
- Vendored libraries: `assets/vendor/*.js` are **not** committed (git-ignored). They are copied from `node_modules` by `scripts/copy-vendor.cjs`, which runs automatically on `npm install` (postinstall) and can be re-run manually with `npm run vendor`. If you change/reinstall the `pdf-lib`/`pdfjs-dist`/`sortablejs` dependencies, re-run `npm run vendor` so the app picks up the new files (the running Electron window has no hot reload — reload the window or restart `npm start`).
- File I/O uses native GTK dialogs: importing files opens an open-dialog, and exporting a PDF triggers a browser download that opens a native "Save As" dialog. In the GTK file chooser, press `Ctrl+L` to type a path directly.
- Exports have no in-app success toast by default; confirm success by checking the saved file on disk (a valid `%PDF` file with the expected embedded image/page objects).
