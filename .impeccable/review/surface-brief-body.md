Mode: Operate.
Audience: Arabic-speaking individuals finishing one local PDF job in under a minute.
Job: Drop files on the photographed origami square, then pick a relevant action from a top strip, then run from the status bar.
Constraints: Keep drop/browse/theme/run IDs. No side rail. No duplicate صور→PDF / مسح. No marketing badges or steppers. Self-hosted fonts. `data-theme="blueprint"` is the dark-mode lock. Spacing 4/8/16/24/32/40/48. No crease SVG. No violet. No gold.

Direction: Orizuru sheet. Stage is the cream fold photograph (dark: `fold-stage-dark.webp`). Drop target is the vermilion origami photograph (dark: `drop-sheet-dark.webp`). Primary button is the red folded-paper face; secondary is cream in light and charcoal in dark.

Memorable moment: Empty window is a real origami square on real folded paper.

Approved comp: `.impeccable/mocks/start-square.png`

Inventory:
| Region | Medium |
|---|---|
| Fold-paper stage | raster `assets/textures/fold-stage.webp` / `fold-stage-dark.webp` |
| Origami drop square | raster `assets/textures/drop-sheet.webp` / `drop-sheet-dark.webp` |
| Primary button | raster `assets/textures/btn-red.jpeg` / `btn-red-dark.jpeg` |
| Secondary button | raster `assets/textures/btn-cream.jpeg` / `btn-cream-dark.jpeg` |
| Titlebar, status, labels | HTML/CSS |
| Icons | existing SVG sprite |
| Execute | HTML `.btn--act` on the red folded-paper face |

Unresolved: Linux custom window buttons; Windows overlay and macOS traffic lights stay native.
