---
name: PDF Studio
description: Arabic-first local PDF workbench. Lined inlay stock, ballpoint ink, one printed red stripe. No photographs.
colors:
  accent: "#C41A1A"
  accent-hover: "#A81616"
  accent-hi: "#D32F2F"
  accent-deep: "#8E1212"
  accent-soft: "rgba(196, 26, 26, 0.10)"
  accent-contrast: "#FCFBF7"
  ink: "#1E3A8A"
  ink-2: "#2B4C7E"
  ink-faded: "#6B86C5"
  bg: "#F4F4F2"
  surface-1: "#FCFBF7"
  surface-2: "#ECECE8"
  surface-3: "#E2E2DC"
  text-primary: "#1E3A8A"
  text-secondary: "#2B4C7E"
  text-muted: "#6B86C5"
  rule: "#B8B8B4"
  rule-strong: "#A6A6A6"
  border-subtle: "rgba(30, 58, 138, 0.16)"
  border-strong: "rgba(30, 58, 138, 0.28)"
  danger: "#8E1212"
  warning: "#6B5A2A"
  success: "#1F6B45"
  night-bg: "#12141C"
  night-surface: "#1A1E2A"
  night-rule: "#3A4258"
  night-text: "#C5D0F0"
  night-ink: "#8AA4E0"
  night-accent: "#E24A4A"
typography:
  display:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "clamp(1.35rem, 4.6vmin, 2rem)"
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.35
  wordmark:
    fontFamily: "Playfair Display, serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "0.01em"
    lineHeight: 1
  copy:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.3
  micro:
    fontFamily: "Noto Naskh Arabic, serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.3
  data:
    fontFamily: "Playfair Display, Noto Naskh Arabic, serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  xs: "2px"
  sm: "4px"
  control: "4px"
  panel: "6px"
  sheet: "6px"
  pill: "999px"
spacing:
  gap: "8px"
  pad: "16px"
  titlebar: "40px"
  status: "52px"
  rule-period: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.control}"
    padding: "8px 18px"
    typography: "{typography.micro}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faded}"
    rounded: "{rounded.control}"
    padding: "6px"
    size: "28px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
    height: "32px"
  nav-current:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px"
---

# Design System: PDF Studio

## Overview

**Creative North Star: «ورقة مسطّرة وحبر أزرق» — Lined inlay, ballpoint ink**

PDF Studio is a sheet of ruled inlay stock with writing in ballpoint blue. The only printed color besides the ink is one TDK-red stripe: the thing the user is about to run. There are no photographs, no paper textures, no origami, no cassette object. Lines, fills, and 1px hairlines are CSS (or SVG for icons). Arabic is the native language of the chrome.

This file replaces the previous Orizuru / photographed-fold world. It is the brief for implementation. Product behavior, routes, copy, and element IDs stay as they are in `index.html` today.

**Apply (for the implementing agent):**
- Restyle only. Do not add pages, tools, steppers, a side rail, or a card grid of operations.
- Keep every existing control ID (`hub-drop`, `hub-browse`, `hub-input`, `theme-toggle`, `tb-run` / `.btn--act`, tool view IDs).
- Touch visual chrome: `assets/css/app.css` and the two `<img class="sheet-photo">` nodes in `index.html` (delete them). Do not rewrite tool JS.
- Delete photographic materials from CSS: `--paper`, `--paper-head`, `--paper-foot`, `--btn-red`, `--btn-cream` must not be `url(...)`. Map them to flat color + the lined gradient below.
- Update the HTML direction-contract comment to this north star (seed `b42e33ef`, chosen `vernacular-ephemera-cassette-j-card`).
- Self-hosted fonts only: Noto Naskh Arabic (all Arabic), Playfair Display (Latin wordmark and figures). Do not add font files or a CDN. Do not use Amiri in this world.
- `data-theme="blueprint"` remains the dark-mode attribute; JavaScript owns the name.

**Key Characteristics:**
- Stage = CSS lined paper (`repeating-linear-gradient`), not an image.
- Drop = a rectangle with a 1px ballpoint hairline on that paper. No photo, no square origami.
- Primary = flat TDK red fill. Secondary = off-white fill + 1px ballpoint hairline.
- After files, allowed tools appear in the titlebar as a ballpoint list; the current tool is a 2px red underline, not a filled chip.
- RTL-first. No letter-spacing on Arabic.

## Colors

Restrained: inlay neutrals + ballpoint ink + one red. Red is never the page fill.

### Primary
- **Ink** (`#1E3A8A` light, `#8AA4E0` dark): body text, icons, secondary strokes, drop border. This is the writing color.
- **Accent** (`#C41A1A` light, `#E24A4A` dark): تنفيذ, current-tool underline, busy progress hairline, focus outline. The only saturated mark besides ink.

### Semantic
- **Success** (`#1F6B45` / `#4CAE7C`): done.
- **Warning** (`#6B5A2A` / `#C4A24A`): busy / in progress. Must not compete with accent red.
- **Danger** (`#8E1212` / `#E5685F`): errors and destructive hover. Darker than accent so حذف is not تنفيذ.

### Neutral
- **Background / stage** (`#F4F4F2` / `#12141C`): inlay stock. Cool off-white, not cream fold `#ECE0D0`.
- **Surface 1** (`#FCFBF7` / `#1A1E2A`): titlebar, status bar, secondary button face.
- **Surface 2 / 3** (`#ECECE8`, `#E2E2DC` / darker navy): hover and press wells.
- **Rule** (`#B8B8B4` / `#3A4258`): the printed notebook lines and quiet dividers.
- **Faded ink** (`#6B86C5` / muted night ink): hints, idle status, ghost labels.

**The One Red Rule.** Red is the run and the current tool underline. It is not backgrounds, not drop fills, not secondary buttons, not icons at rest.

**The Lined Stock Rule.** Horizontal rules are a CSS repeating gradient, period 28px, 1px rule on 27px stock. Same gradient on `body`, `.board`, `.sheet`. Titlebar and status bar use Surface 1 with a 1px ink hairline (`border-bottom` / `border-top`), not a cropped photo of the paper.

Light paper CSS (normative):

```css
--paper: repeating-linear-gradient(
  to bottom,
  #F4F4F2 0 27px,
  #B8B8B4 27px 28px
);
```

Dark paper CSS (normative):

```css
--paper: repeating-linear-gradient(
  to bottom,
  #12141C 0 27px,
  #3A4258 27px 28px
);
```

`background-size: auto; background-repeat: repeat; background-position: 0 0;` — never `cover` on this gradient.

Map existing custom properties: `--bg` and `--sheet` to stock; `--ink` / `--text-primary` to ballpoint; `--accent` to TDK red; `--rule` to `#B8B8B4`.

## Typography

**Arabic:** Noto Naskh Arabic for every Arabic string (titles, buttons, labels, ledes, empty state). Weight does the hierarchy. This is the ballpoint.

**Latin:** Playfair Display for `PDF Studio` (`lang="en"`) and for tabular figures (counts, sizes). No other Latin face.

**Do not** fake handwriting, comic lettering, or a script face. Do not apply `letter-spacing` to Arabic. Wordmark tracking stays `0.01em`.

### Hierarchy
- **Display** (Noto Naskh 700, clamp ~1.35–2rem): `#start-title` / drop headline «أسقط الملفات» only, in ink, no text-shadow.
- **Headline** (Noto Naskh 700, 1.5rem): tool view titles.
- **Wordmark** (Playfair 600, 1rem): PDF Studio.
- **Copy** (Noto Naskh 400, 16px / 1.7): ledes and notes.
- **Body** (Noto Naskh 400, 14px): lists, legend, chrome.
- **Label / micro** (Noto Naskh 550 / 400, 12px / 11px): field labels, status cells, buttons.
- **Data** (Playfair + Noto, tabular-nums, LTR): numbers.

## Layout

Do not change information architecture. The window is already the instrument.

Flush three-row grid:
1. **Titlebar** 40px (`.sheet__head`): mark + `PDF Studio`, then `#legend-list` (allowed tools only, after files), then theme toggle, then Linux window buttons. Native overlay via `env(titlebar-area-*)`.
2. **Work** (`.sheet__body` / `#work`): one column. Empty start = centered drop. After files = file list on the same lined stage. Tool views keep their current inner structure (scan canvas, options, etc.) restyled to ink/hairline, not redesigned.
3. **Status** 52px (`.titleblock`): hidden on empty start (`:has(#view-start.view--active)` stays). Cells: الأداة، الملف، صفحات، الحجم، حفظ باسم، الحالة + تنفيذ. `safe-area-inset-bottom` unchanged.

No permanent side rail. No iLovePDF tool-card grid. Breakpoints already in CSS (`900px`, `640px`) stay; restyle faces, do not invent a new shell.

**The Keep-the-Instrument Rule.** New chrome inherits this topology. Density may tighten; regions may not swap.

## Elevation & Depth

Flat. The paper is the window. No drop-shadow on the drop rectangle, no photo lift, no inset paper highlight.

### Shadow Vocabulary
- **Sheet / drop / buttons:** none.
- **Lift** (`0 8px 24px rgba(30, 58, 138, 0.12)`): toasts only.
- **Panel** (`0 16px 48px rgba(18, 20, 28, 0.22)`): progress and dialogs. Dark: `0 16px 48px rgba(0, 0, 0, 0.55)`.

**The Offset-Blur Rule.** If a shadow exists, it has offset and blur. No neon halo, no hard `4px 4px 0` stamp.

Remove `--shadow-head` and `--shadow-foot` from titlebar and status (those existed to sell the fold photograph). Replace with 1px hairlines.

## Shapes

- Checkboxes / tight wells: 4px.
- Buttons, inputs, drop, legend rows: 4px (`--radius` / control). Tighter than the old 6–8px origami faces.
- Dialogs / toasts / progress: 6px.
- No pill buttons (`999px` reserved for the 7px status dot only).
- Drop is a **rectangle** (current square-ish size `min(26rem, 68vmin)` may stay) with `border: 1px solid var(--ink)`, transparent fill so the lines show through.

## Components

### Buttons
- **Shape:** 4px. Flat. `background-image: none` on every `.btn`, `.btn--act`, `.btn--sheet`, `.theme-toggle`.
- **Primary (`.btn--act`):** fill `#C41A1A`, label `#FCFBF7`, 11–12px Noto Naskh 700. No text-shadow. Hover `#A81616`. Disabled `opacity: 0.45` on the same flat face.
- **Secondary (`.btn`, `.btn--sheet`, theme toggle):** fill `#FCFBF7`, 1px solid `#1E3A8A`, label ink. Hover fill `#ECECE8`. Theme toggle is a 28px square of the same language, not a cream photo.
- **Ghost:** transparent, 1px hairline or none; ink-faded.
- **Danger:** ink-less; danger color on a quiet face — never the red primary.
- **Focus:** 2px accent outline, 2px offset, 3px `accent-soft` halo. Visible for keyboard.

### Inputs / Fields
- Surface-1 fill, 4px, 1px `border-strong`. Focus: 2px ink or accent outline (accent when the field commits a run option). Number fields: Playfair, LTR, end-aligned. Checkboxes 15px, 4px, accent when checked.

### Navigation (titlebar legend)
- Horizontal list of tool names in ink. Current: 2px `#C41A1A` underline, no filled background (or the lightest `accent-soft` if hit-area needs it). Disabled-before-files: 55% opacity, still focusable. Do not introduce colored icon wells that read as a rainbow.

### Status bar (`.titleblock`)
- Surface-1 + top 1px ink hairline. Cells separated by 1px rule. Semantic dot 7px. Busy: 2px accent hairline on the top edge (keep the existing `::before` animation, recolor to accent). Execute sits at the inline-end in RTL.

### Intake / empty drop (`#hub-drop.intake--sheet`)
- Remove both `sheet-photo` images.
- Transparent lined paper showing through; 1px ink border; no box-shadow.
- Copy in ink (`--ink`), not cream-on-red: glyph, «أسقط الملفات», «أسقط صوراً أو PDF», hint, «تصفّح» as secondary button.
- Hover / drag-over: border stays ink or shifts to accent; optional `accent-soft` wash. No brightness-on-photo filter.
- Other `.intake` wells (scan, merge, …): same language — dashed or solid 1px ink on lined paper, not a grey dashed SaaS bucket.

### File list
- Rows sit on the rules like notebook entries: transparent or surface-1, 1px rule border, ink names. No cream cards.

### Scan editor
- Behavior unchanged (corners on the original, live rotate/filters). Chrome around the canvas: ink hairlines, lined stage, same buttons as above.

### Progress / toasts
- Dim the window. Card 6px, panel shadow, 3px accent track. Toasts inline-end. Success / danger icons from the existing sprite, recolored to semantic tokens.

## Do's and Don'ts

### Do:
- **Do** keep drop → titlebar tools → status run, and every existing ID.
- **Do** draw the stage with the 28px repeating-linear-gradient above.
- **Do** use ballpoint `#1E3A8A` for writing and TDK `#C41A1A` for run.
- **Do** self-host Noto Naskh Arabic and Playfair Display; Arabic never gets tracking.
- **Do** respect `prefers-reduced-motion` (durations already collapse to `0.001ms`).
- **Do** keep `data-theme="blueprint"` as the dark-mode lock.

### Don't:
- **Don't** use any raster from `assets/textures/` (fold-stage, drop-sheet, btn-red, btn-cream, or dark variants) in the UI.
- **Don't** generate or embed new photos, paper grain, cassette shells, tape reels, origami, or gold foils.
- **Don't** keep Playfair or Amiri on Arabic buttons, labels, or the empty-state title.
- **Don't** letter-space Arabic, use pill CTAs, or a coloured `border-inline` thicker than 1px on rows.
- **Don't** ship cream-fold `#ECE0D0`, origami vermilion photography, violet, process teal (iLovePDF), or a midnight transit drench.
- **Don't** add Google Fonts, a side rail, marketing badges, or a tool-card dashboard.
- **Don't** treat this as a new product or a new set of screens — it is a reskin of `index.html` as it exists.
