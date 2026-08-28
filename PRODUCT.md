# Product

<!-- impeccable:product-schema 1 -->

<!--
Interview substitution: the user's brief instructed "ابدأ فوراً ولا تنتظر موافقة. أنت المالك"
(start immediately, do not wait for approval, you are the owner). Under init.md's rule, that is an
explicit instruction to proceed, so this record is written from the brief plus repository evidence.
Facts that were inferred rather than confirmed are marked (inferred).
-->

## Platform

web

## Stack

Existing codebase: Electron 34 desktop shell (`electron/main.cjs`) serving a static, vanilla
HTML/CSS/ES-module front end over a loopback HTTP server. No framework, no bundler. Vendored
libraries only: pdf-lib, pdf.js, Sortable, OpenCV.js. Ships **Windows NSIS installer only**
(owner policy 2026-08-26: no Portable, no Linux/macOS release builds).

## Users

Arabic-speaking (Egyptian) individuals handling everyday paperwork on a personal Windows
machine: students assembling assignments, employees preparing contracts and reports, people
digitising ID cards, invoices, and handwritten notes photographed with a phone. They are not
document professionals, they work alone, and they usually need one specific operation finished and
saved in under a minute. (inferred from brief)

## Product Purpose

Give people the full set of everyday PDF operations without uploading a single byte. Success is a
user who stops going to an online converter because the desktop app is faster, works offline, and
never sees their documents.

## Positioning

Every operation runs on the user's own machine. Web competitors (iLovePDF and its clones) require
uploading private documents to a server and gate volume and file size behind an account. This
product's mechanism is the same toolset executed entirely in a local renderer process: no network
call, no queue, no size ceiling other than the machine's own memory, no paywall.

## Operating Context

- Desktop, single window, mouse and keyboard, offline by default.
- Source material arrives as phone photographs (skewed, shadowed, uneven lighting), scans, and PDFs
  received by email or messaging apps.
- Output is saved to the local filesystem and then attached, printed, or archived by the user.
- Right-to-left Arabic interface; Arabic filenames are normal input.

## Capabilities and Constraints

Shipping today: document scan (perspective correction + enhancement + upscale), images → PDF,
merge PDFs, page organiser (insert / delete / rotate / reorder), split (ranges / every-N / extract),
compress (recompress embedded images while keeping searchable text, or rasterize like a scan),
text watermark, page numbering, PDF → images, sign (draw/name/image/date + flatten),
edit / markup (text, freehand, images, shapes flattened onto pages),
protect / unlock (AES-256 via qpdf-wasm), crop, extract embedded images, OCR (Arabic + English
via local Tesseract.js WASM).

Constraints:
- 100% local. No cloud service, no telemetry, no paid tier — the app is free.
- No live camera capture. The scanning feature operates on image files the user already has.
- Electron security posture must stay `contextIsolation: true`, `sandbox: true`, `nodeIntegration:
  false`, with a narrow preload.
- pdf-lib standard fonts lack Arabic; Arabic overlays (watermark, numbering) are drawn as PNG images.

## Brand Commitments

- Name: **PDF Studio**. Kept.
- Arabic-first, right-to-left. English UI strings are a possible later addition, not a requirement.
- Free, forever, with no paywall or account.

## Evidence on Hand

- Working implementations of six tools in `assets/js/pdf/workspaces.js`.
- App icon at `assets/branding/app-icon-{192,512,1024}.png`.
- A full OpenCV.js build already vendored at `assets/vendor/opencv.js`.
- No user testimonials, no usage numbers, no press, no benchmark results exist. Future work must not
  invent them.

## Product Principles

1. The document never leaves the machine. Every feature must be implementable locally or not shipped.
2. One operation, one screen, finished in under a minute. Depth is available, never mandatory.
3. Long work must be visible and interruptible: progress, a real percentage, and a cancel that works.
4. Arabic is the design's native language, not a translation layer applied to a Latin layout.
5. Free means complete. No feature is withheld, degraded, or counted.

## Accessibility & Inclusion

Keyboard operation of every tool, visible focus, `prefers-reduced-motion` respected, and text
contrast at WCAG AA. Arabic screen-reader labels on all controls.
