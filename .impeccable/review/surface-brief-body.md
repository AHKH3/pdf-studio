Mode: Operate.
Audience: Arabic-speaking individuals finishing one local PDF job in under a minute.
Job: Drop files on a CSS-lined inlay rectangle, then pick a relevant action from the titlebar, then run from the status bar.
Constraints: Keep drop/browse/theme/run IDs. No side rail. No duplicate صور→PDF / مسح. No marketing badges or steppers. Self-hosted fonts only (Noto Naskh Arabic + Playfair Display). `data-theme="blueprint"` is the dark-mode lock. Spacing 4/8/16/24/32/40/48. No photographs, no paper-grain rasters, no cassette object, no origami. No violet. No gold.

Direction: Lined inlay / ballpoint. Stage is a 28px CSS repeating-linear-gradient (#F4F4F2 / #B8B8B4; dark #12141C / #3A4258). Drop is a 1px ballpoint rectangle (#1E3A8A) with the lines showing through. Primary is flat TDK red (#C41A1A); secondary is inlay fill + 1px ink hairline. Current tool is a 2px red underline in the titlebar.

Memorable moment: Empty window is ruled paper and one ink rectangle that says أسقط الملفات.

Approved comp: none — visual world locked from direction `challenger-j-card` (seed b42e33ef). Implement from DESIGN.md, not from generated pictures.

Inventory:
| Region | Medium |
|---|---|
| Lined stage | CSS `repeating-linear-gradient` on body / .board / .sheet |
| Drop well | HTML/CSS rectangle, 1px ink |
| Primary button | HTML `.btn--act` flat red fill |
| Secondary button | HTML `.btn` inlay + 1px ink |
| Titlebar, status, labels | HTML/CSS |
| Icons | existing SVG sprite, ink color |
| Execute | HTML `.btn--act` |

Unresolved: Linux custom window buttons; Windows overlay and macOS traffic lights stay native.
