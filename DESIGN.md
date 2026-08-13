---
name: PDF Studio
description: Arabic-first local PDF workbench. Cream folded paper, vermilion origami square, no violet.
colors:
  accent: "#E22A28"
  accent-hover: "#CE2224"
  accent-hi: "#E44C43"
  accent-deep: "#B81016"
  accent-soft: "rgba(226, 42, 40, 0.12)"
  accent-contrast: "#FFFBF1"
  bg: "#ECE0D0"
  surface-1: "#F7EEE2"
  surface-2: "#EDE1D1"
  surface-3: "#E3D4C2"
  text-primary: "#1C1814"
  text-secondary: "#3F382F"
  text-muted: "#6A5E52"
  border-subtle: "rgba(28, 24, 20, 0.12)"
  border-strong: "rgba(28, 24, 20, 0.18)"
  danger: "#9B1218"
  warning: "#775F47"
  success: "#217A4B"
  night-bg: "#111113"
  night-surface: "#1C1C20"
  night-text: "#F3F0EA"
  night-accent: "#C4332E"
typography:
  display:
    fontFamily: "Amiri, Playfair Display, serif"
    fontSize: "clamp(1.875rem, 4vw, 2.375rem)"
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "Amiri, Playfair Display, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.35
  wordmark:
    fontFamily: "Playfair Display, Geist, serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "0.01em"
    lineHeight: 1
  copy:
    fontFamily: "Noto Naskh Arabic, Geist, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "Noto Sans Arabic, Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Noto Sans Arabic, Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.3
  micro:
    fontFamily: "Geist, Noto Sans Arabic, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.3
  data:
    fontFamily: "Geist, Noto Sans Arabic, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  xs: "2px"
  sm: "4px"
  control: "6px"
  pill: "999px"
  panel: "8px"
  sheet: "8px"
spacing:
  gap: "8px"
  pad: "16px"
  rail: "232px"
  titlebar: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.control}"
    padding: "7px 18px"
    typography: "{typography.micro}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    border: "1px solid {colors.border-strong}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: "6px"
    size: "30px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
    height: "32px"
  nav-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px"
---

# Design System: PDF Studio

## Overview

**Creative North Star: «طيّ الورقة» — The Orizuru Sheet**

PDF Studio sits on a photographed sheet of cream folded paper. The empty state is a photographed vermilion origami square. Primary actions use the red folded-paper button face; secondary actions use the cream folded-paper button face. There is no violet and no gold. Window chrome stays flush (40px hidden titlebar + overlay). Quiet controls stay hairline. Shadows exist on the origami faces and on floating layers (dialogs, toasts). Motion stays short: 120/160/200ms.

Arabic is native: Amiri display, Noto Sans Arabic UI, Noto Naskh Arabic copy, Playfair Display wordmark, Geist figures. The existing SVG sprite stays; icons are coloured by route. Dark mode (`data-theme="blueprint"`, a JavaScript lock) uses the dark fold photograph, dark origami square, and dark button photographs.

Scan is the first feature: corners stay on the original image. Rotate and colour filters preview live in that same window. Warped extraction is export-only, never mixed with corner drag.

**Key Characteristics:**
- Cream fold photograph as the stage; vermilion origami photograph as the drop square.
- After files, a top action strip of allowed tools only. No permanent side rail.
- Primary button: red folded-paper photograph, cream label. Secondary button: cream folded-paper photograph, ink label.
- Quiet buttons stay transparent with hairlines. No violet. No gold.
- RTL-first. No letter-spacing on Arabic.

## Colors

Neutrals sampled from the cream fold photograph. Accent sampled from the origami square. Two button faces, not a purple stamp.

### Primary
- **Accent** (`#E22A28` light, `#E44C43` dark): origami red. Marks the current tool, focus, and the primary run face.

### Semantic
- **Success** (`#217A4B` / `#4CAE7C`): done state.
- **Warning** (`#775F47` / `#E3A93D`): busy / in-progress, from the paper's darkest fold.
- **Danger** (`#9B1218` / `#E5685F`): errors and destructive hover. Darker than the origami red so it is not the primary button.

### Neutral
- **Background** (`#ECE0D0` / `#2A221C`): cream fold stage.
- **Surface 1** (`#F7EEE2` / `#332C23`): titlebar, strip, status bar.
- **Surface 2** (`#EDE1D1` / `#3D3429`): secondary hover.
- **Surface 3** (`#E3D4C2` / `#4A4033`): press wells.
- **Text** (`#1C1814` / `#3F382F` / `#6A5E52`): ink, secondary, muted.
- **Border** (`rgba(28,24,20,0.12)` / `0.18`): hairline and strong.

**The One Red Rule.** Origami red marks the thing the user is about to do. Selected rows use red-soft with primary text. Secondary is cream paper, never purple.

## Typography

**Display Font:** Amiri (Arabic headings) with Playfair Display for the Latin wordmark only.
**Body Font:** Noto Sans Arabic for UI; Noto Naskh Arabic for ledes and notes.
**Label/Data Font:** Geist with tabular lining figures.

**Character:** Classical Naskh display sitting in a flat paper instrument. Amiri is the document; Geist and Noto Sans are the instrument.

### Hierarchy
- **Display** (Amiri 700, clamp(30–38px) / `--t-2xl`): start title only.
- **Headline** (Amiri 700, 24px / `--t-xl`): tool view titles.
- **Wordmark** (Playfair Display 600, 1rem): "PDF Studio" with `lang="en"`.
- **Copy** (Noto Naskh Arabic 400, 16px, 1.7): ledes and notes. Max ~62ch.
- **Body** (Noto Sans Arabic 400, 14px, 1.55): controls, lists, legend.
- **Label** (Noto Sans Arabic 550, 12px): field labels, status labels, panel titles.
- **Data** (Geist, tabular-nums): page counts, sizes, scan pager, legend badges.

**The No Tracking Rule.** Never apply letter-spacing to Arabic. Tracking is allowed only on the Latin wordmark (`0.01em`).

## Layout

Flush three-row grid: 40px Electron titlebar, body, 52px status bar. The body is a two-column grid: permanent tool rail (232px, inline-start) then the paper work stage. Native overlay insets the titlebar via `env(titlebar-area-*)`. Linux gets custom min/max/close; Windows overlay and macOS traffic lights stay native. Electron keeps `contextIsolation` and `sandbox`.

The rail holds «الإجراءات» with a file count, then every tool. Before files the rows are dimmed (`aria-disabled`, still focusable); clicking one returns to the start stage with an «ارفع الملفات أولاً» toast. After files, allowed tools light up with input/output badges.

At `900px` the rail collapses to icon-only (56px). At `640px` it becomes a horizontal strip above the work stage and the status bar drops numeric and state cells.

**The Keep-the-Instrument Rule.** New tools inherit this topology. Do not introduce a card grid of operations or a left-aligned LTR shell.

## Elevation & Depth

Mostly flat and tonal. Hairlines do the work. Shadows are reserved for floating layers only: dialogs, progress card, toasts.

### Shadow Vocabulary
- **Sheet:** none — the window is the surface.
- **Lift** (`0 8px 24px rgba(33,30,22,0.14)`): toasts.
- **Panel** (`0 16px 48px rgba(33,30,22,0.2)`): progress / dialog card. Dark: `0 16px 48px rgba(0,0,0,0.55)`.

**The Offset-Blur Rule.** Shadows always have offset and blur. No neon halo, no hard `4px 4px 0` stamp, no crop-mark ticks.

## Shapes

- Tight chips and checkboxes: 4px (`--radius-sm`).
- Fields, nav rows, buttons, inputs: 6px (`--radius`).
- Panels, intake, cards, toasts, dialogs: 8px (`--radius-md`).
- Window chrome (titlebar, native/Linux window buttons) stays tight.
- Status uses a 7px semantic dot.

## Components

### Buttons
- **Shape:** 8px radius. Primary and secondary faces are photographed folded paper, not flat fills.
- **Primary (`.btn--act`):** red folded-paper photograph (`assets/textures/btn-red.jpeg`; dark: `btn-red-dark.jpeg`), cream 12px label. Hover brightens the photo. Disabled `opacity: 0.45` on the same face.
- **Secondary (`.btn`):** cream folded-paper photograph (`assets/textures/btn-cream.jpeg`; dark: charcoal `btn-cream-dark.jpeg`), ink label. Not purple.
- **Quiet / ghost:** transparent with a light hairline; no origami face. Titlebar ghost is a 30px square.
- **Danger:** danger color on a quiet face; not the red origami primary.
- **Focus:** 2px origami-red outline, 3px offset, 4px red-soft halo. Visible for keyboard.

### Inputs / Fields
- Paper fill, 6px radius, strong hairline. Focus: 2px origami-red outline, 2px offset, 4px red-soft halo. Number fields use Geist, LTR, end-aligned. Checkboxes are 15px, 4px radius, red when checked.

### Navigation
- Rail titled **الأدوات**, one vertical list without grouping chrome. Coloured square icon wells stay route-tinted when current. Disabled rows dim to 55% with muted wells but stay focusable. Icon-only under `900px`; horizontal strip under `640px`.

### Status bar (`.titleblock`)
- Bottom execute strip: الأداة، الملف، صفحات، الحجم، حفظ باسم، الحالة + Ctrl/⌘ Enter + run. Semantic state dot. Busy shows a thin origami-red progress hairline. `safe-area-inset-bottom` padding. State colour: muted idle, warning busy, success done, danger error.

### Intake
- Empty state: photographed vermilion origami square (`assets/textures/drop-sheet.webp`; dark: `drop-sheet-dark.webp`) on the fold stage (`assets/textures/fold-stage.webp`; dark: `fold-stage-dark.webp`). Hover brightens the photo. No crease SVG.

### Scan editor
- Canvas is always the original/display image with draggable corners. Rotate (90°) and colour modes apply instantly via canvas transform/filter in that same window. Corner detection never shows the warped page, export still runs `engine.process`. Live chip (`#scan-preview`) stays on; it does not swap the editor to the extracted result.

### Progress / toasts
- Dim of the window. Card 8px radius, panel shadow, 3px origami-red track. Toasts sit at the inline-end corner; done uses a success icon, error uses danger.

## Do's and Don'ts

### Do:
- **Do** keep the top action strip + work + status-bar topology.
- **Do** self-host Amiri, Noto Sans Arabic, Noto Naskh Arabic, Playfair Display, and Geist as local woff2.
- **Do** use origami red for the thing the user is about to do.
- **Do** respect `prefers-reduced-motion` (durations collapse to `0.001ms`).
- **Do** keep `data-theme="blueprint"` as the dark-mode attribute; JavaScript owns the name.

### Don't:
- **Don't** load fonts from Google Fonts CDN.
- **Don't** draw crop marks, tiled grids, or ISO drafting frames.
- **Don't** use process magenta, sage, terracotta, aurora/glass, Bootstrap blue, or violet.
- **Don't** letter-space Arabic labels.
- **Don't** put a coloured `border-inline` thicker than 1px on rows, notes, or cards.
- **Don't** use display faces on buttons, data, or field labels.
- **Don't** invent a purple or gold button. Secondary is cream folded paper; primary is red folded paper.
- **Don't** use pill (999px) buttons.
- **Don't** restyle dark mode as a blueprint or a magenta proofing monitor; it is the dark folded-paper photographs.
