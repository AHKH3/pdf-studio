# Crop PDF (`crop`)

Self-contained tool for PDF Studio. Visual crop box on a page preview; apply to the current page or every page. Local, offline, free. Uses `pdf-lib` and `pdf.js` already in the app.

Does **not** include N-up, page resize, or a separate margins tool.

## Files

| File | Role |
|---|---|
| `manifest.js` | Public API: `{ id, title, mount, unmount }` plus router helpers |
| `hub-fragment.html` | View markup to paste into `index.html` |
| `crop.js` | Load, preview, apply, save |
| `overlay.js` | Draggable crop rectangle (styles injected on `mount`) |
| `geometry.js` | Visual fractions ↔ PDF user space |

Do not import this folder from other tools. Do not add N-up / resize here.

## Integrator steps

Nothing in this folder is wired until you paste the fragment and register the manifest. **Do not** change files inside this folder to hook it up.

### 1. Paste the view

Copy the `<section id="view-crop">` from `hub-fragment.html` into `index.html` next to the other `.view` sections (after watermark / numbers is fine).

`icon-crop` already exists in the SVG sprite. Overlay CSS is injected by `mount()` — do not add rules to `app.css`.

### 2. Register the tool

In `assets/js/main.js`:

```js
import cropManifest from "./tools/crop/manifest.js";

registerTools([
  // …existing tools,
  {
    id: cropManifest.id,
    name: cropManifest.title,
    icon: cropManifest.icon,
    input: cropManifest.input,
    actionLabel: cropManifest.actionLabel,
    outputName: cropManifest.outputName,
    setup: () => cropManifest.mount(),
    enter: () => cropManifest.enter(),
    leave: () => cropManifest.leave(),
    run: () => cropManifest.run()
  }
]);
```

Call `mount()` once from `setup`, like the other tools. **Do not** call `unmount()` on route leave — that would drop the open file. Use `unmount()` only if the whole tool is being destroyed.

### 3. Title block

`enter` / `run` talk to the existing title block (`اقتصاص وحفظ`, suggested name `…-مقصوص.pdf`). The in-panel save button hides itself when `#tb-run` is present so the title block stays the only primary action.

## Behaviour

- Drop or browse one PDF. Preview uses pdf.js (rotation included).
- Default crop is a 6% inset. Drag the box, drag handles, or click the dimmed area and drag a new rectangle. Keyboard: arrows move, Alt+arrow resizes, Home restores the inset, End fills the page.
- **هذه الصفحة** writes CropBox + MediaBox (and Bleed/Trim/Art) on the previewed page only. **كل الصفحات** applies the same *visual fractions* to every page (so mixed sizes/rotations still lose the same relative margins).
- Mapping uses `viewport.convertToPdfPoint` so a rotated page crops the edge the user sees.
- Save is in-place via `PDFDocument.load` + `setCropBox` / `setMediaBox`. Content outside the box is hidden and the page size shrinks; the discarded content is **not** stripped from the file (not redaction).
- Arabic RTL chrome. Page geometry stays LTR (`direction: ltr` on the stage) so left is the paper’s left.
- No network, no new dependencies, no `npm install`.

## Manifest

```js
{
  id: "crop",
  title: "اقتصاص الصفحات",
  mount(root?),   // wire intake + overlay; safe to call once
  unmount(),      // dispose overlay + close the file
  enter(),        // restore title block
  leave(),        // no-op (keeps state)
  run()           // crop and save
}
```
