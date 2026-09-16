# خريطة المعمارية — PDF Studio

> آخر تحديث: 2026-09-16 — الإصدار 1.0.20. التفاصيل التنفيذية لنظام التصميم في `DESIGN.md` و`docs/design-system-lumen.md`.

## التشغيل (Runtime)

```
Electron (main.cjs) ── سيرفر HTTP على 127.0.0.1:PORT ──► BrowserWindow
   │  حوارات أصلية (حفظ ملف/مجلد) + single-instance + autoUpdater
   └── index.html + assets/** (يُقدَّم عبر SERVED_PREFIXES فقط، CSP صارمة)
```

- الأصل المحلي هو ما يتيح ES modules والـ Workers وWASM (ملف `file://` كان سيمنعها).
- الرندر بلا Node (`preload.cjs` ضيّق فقط) — الحفظ يتم عبر IPC (`pdf-studio:save-file` / `save-folder`).

## الواجهة (Frontend — بلا فريمورك)

| المسار | الدور |
|---|---|
| `index.html` | كل الشاشات (`view-start` + `view-*` لكل أداة) + مكتبة أيقونات SVG + عقدة الاتجاه (Lumen Glow v2) |
| `assets/js/main.js` | الإقلاع: تهيئة المحركات، تحميل الأدوات **تدريجيًا** بعد الهيرو، `__pdfStudioToolsLoaded` للفحوص |
| `assets/js/ui/` | `router.js` (التنقل + تسجيل الأدوات)، `tabs.js` (تابات بعزل حالة عبر `captureState`/`restoreState`)، `hub.js` (الرئيسية)، `titleblock.js` (شريط التنفيذ)، `toolprefs.js` (تثبيت/إخفاء)، `recents.js`، `keys.js`، `feedback.js`، `dialog.js` |
| `assets/js/tools/*` | كل أداة وحدة بنمط Manifest: `mount`/`enter`/`leave`/`run`/`acceptFiles` + `captureState`/`restoreState` لعزل التابات |
| `assets/js/pdf/` | `core.js` (محركات pdf.js/pdf-lib) + `workspaces.js` |
| `assets/js/scan/` | خط أنابيب المسح (`pipeline.js` + `pipeline.worker.js` + `client.js`) — OpenCV.js للكشف، TF.js/WASM للرفع |
| `assets/js/lib/` | `files.js` (حفظ ZIP/مجلد)، `errors.js` (رسائل عربية)، `heic.js` (تحميل كسول) |
| `assets/css/app.css` | التطبيق الكامل (Lumen v2) — `assets/css/fonts.css` للخطوط المضمّنة |

## الأدوات العشر (المعرّفات)

`scan` (صور ← PDF) · `merge` (دمج) · `organize` (ترتيب) · `split` (تقسيم) · `compress` (ضغط) · `numbers` (ترقيم) · `rasterize` (PDF ← صور) · `edit` (تعديل PDF — `tools/edit/`: app/board/coords/fit/flatten/text-png/ui) · `crop` (قص — `tools/crop/`) · `extract-images` (صور أصلية — `tools/extract-images/`)

ملاحظة: العربية في التراكبات (الترقيم/التحرير) تُرسم PNG لأن خطوط pdf-lib القياسية بلا عربية.

## الفحوص (`npm test` — 12 سكربتًا، الكل يجب أن يبقى أخضر)

`check-syntax` · `test-scan` · `test-scan-export` · `test-experience` · `test-error-guard` · `test-tools` · `test-edit` (+`test-edit-flatten` +`test-edit-board`) · `test-launch` · `test-electron-shell` (يعمل مخفيًا عبر `PDF_STUDIO_TEST`) · `test-publish` (قناة النشر والهبوط) · `test-toolprefs`

## النشر

- `release.yml`: كل push على `main` يرفع patch تلقائيًا ويبني NSIS وينشره (tag بصيغة `v*` لإصدار برقم ثابت).
- `pages.yml`: نشر مجلد `landing/` على GitHub Pages.
- المثبّت: one-click per-user (`quitAndInstall(true, true)`) + مهمتا Task Scheduler (كل 6 ساعات + عند Logon) عبر `build/installer.nsh`.
