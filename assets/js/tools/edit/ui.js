const CSS = `
/* ==========================================================================
   PDF Studio — PDF Editor UI (Lumen Glow v2)
   ========================================================================== */

.edit-root {
  display: grid;
  row-gap: 0;
  min-height: 0;
  width: 100%;
}

.edit-root .view__head {
  margin-bottom: var(--space-3);
}

/* ——— Hero Intake Drop Area ——— */
#edit-drop.intake {
  min-height: 280px;
  border: 1.5px dashed var(--border-strong);
  background: var(--surface-1);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  transition: all var(--dur-fast, 140ms) var(--ease, ease);
}
#edit-drop.intake:hover,
#edit-drop.intake.is-over {
  background: var(--surface-2);
  border-color: var(--accent);
  border-style: solid;
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}
#edit-drop .intake__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-md, 1.05rem);
  font-weight: 700;
  color: var(--text-primary);
}
#edit-drop .intake__hint {
  font-size: var(--t-xs, 0.78rem);
  color: var(--text-muted);
  max-width: 44ch;
  text-wrap: balance;
  line-height: 1.6;
}

/* ——— Workspace 3-Zone Layout ——— */
.edit-workspace {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr) 320px;
  gap: var(--space-3);
  align-items: stretch;
  min-height: calc(100dvh - var(--header-h, 52px) - 60px);
  width: 100%;
  transition: grid-template-columns var(--dur-base, 180ms) var(--ease, ease);
}
.edit-workspace.sidebar-collapsed {
  grid-template-columns: 0px minmax(0, 1fr) 320px;
  gap: var(--space-3);
}

/* ——— 1. Thumbnails Sidebar ——— */
.edit-sidebar {
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  min-width: 0;
  transition: opacity var(--dur-fast, 140ms) var(--ease, ease), transform var(--dur-fast, 140ms) var(--ease, ease);
}
.edit-workspace.sidebar-collapsed .edit-sidebar {
  opacity: 0;
  pointer-events: none;
  border: 0;
  padding: 0;
  margin: 0;
}
.edit-sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-0, rgba(15, 23, 42, 0.02));
}
.edit-sidebar__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-xs, 0.82rem);
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.edit-sidebar__count {
  font-size: var(--t-2xs, 0.70rem);
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}
.edit-thumbs {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  overflow-y: auto;
  flex: 1;
  scrollbar-gutter: stable;
}
.edit-thumb-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--surface-2);
  border: 1.5px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  cursor: pointer;
  transition: all var(--dur-fast, 140ms) var(--ease, ease);
  user-select: none;
}
.edit-thumb-item:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}
.edit-thumb-item.is-active {
  border-color: var(--accent);
  background: var(--surface-3, #FFFFFF);
  box-shadow: 0 0 0 2px var(--accent-soft), 0 6px 16px var(--shadow-glow);
}
.edit-thumb-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1.414;
  background: #FFFFFF;
  border-radius: 4px;
  overflow: hidden;
  display: grid;
  place-items: center;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}
.edit-thumb-preview canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.edit-thumb-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: var(--space-2);
  padding: 0 2px;
}
.edit-thumb-num {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-2xs, 0.72rem);
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 4px;
}
.edit-thumb-badge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 4px var(--accent);
}
.edit-thumb-actions {
  display: inline-flex;
  gap: 2px;
  opacity: 0.85;
  transition: opacity var(--dur-fast, 140ms);
}
.edit-thumb-btn {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  background: var(--surface-1);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: all var(--dur-fast, 140ms);
}
.edit-thumb-btn:hover {
  background: var(--accent);
  color: #FFFFFF;
}
.edit-thumb-btn--del:hover {
  background: var(--danger, #E11D48);
  color: #FFFFFF;
}
.edit-thumb-btn .icon { width: 12px; height: 12px; }

/* ——— 2. Central Stage & Canvas Area ——— */
.edit-stage {
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  min-width: 0;
}

/* Top Toolbar Bar */
.edit-topbar, .edit-stage__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-0, rgba(15, 23, 42, 0.02));
  flex-wrap: wrap;
  z-index: 20;
}
.edit-toolbar, .edit-tool-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px 4px;
}
.edit-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-2);
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--t-xs, 0.76rem);
  font-weight: 600;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--dur-fast, 140ms) var(--ease, ease);
  user-select: none;
  white-space: nowrap;
}
.edit-tool-btn .icon { width: 15px; height: 15px; }
.edit-tool-btn:hover {
  background: var(--surface-3, #FFFFFF);
  color: var(--text-primary);
}
.edit-tool-btn.is-active,
.edit-tool-btn input:checked + span {
  background: var(--accent);
  color: #FFFFFF;
  box-shadow: 0 2px 8px var(--accent-glow);
}
.edit-tool-radio label {
  cursor: pointer;
  margin: 0;
}
.edit-tool-radio input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.edit-tool-radio span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font-size: var(--t-xs, 0.76rem);
  font-weight: 600;
  transition: all var(--dur-fast, 140ms);
}
.edit-tool-radio input:checked + span {
  background: var(--accent);
  color: #FFFFFF;
  box-shadow: 0 2px 8px var(--accent-glow);
}
.edit-tool-radio label:hover span {
  color: var(--text-primary);
}

/* Page navigation strip */
.edit-nav-group, .scan__pager {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px 6px;
}
.edit-nav-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.edit-nav-btn:hover {
  background: var(--surface-3, #FFFFFF);
  color: var(--accent);
}
.edit-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.edit-nav-count {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-xs, 0.76rem);
  font-weight: 700;
  color: var(--text-primary);
  padding: 0 var(--space-2);
  direction: ltr;
}

/* Zoom group */
.edit-zoom-group, .edit-stage__zoom {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px 6px;
}
.edit-zoom-label {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-xs, 0.76rem);
  font-weight: 700;
  color: var(--text-primary);
  min-width: 44px;
  text-align: center;
  direction: ltr;
}

/* Canvas Viewport */
.edit-viewport, .edit-board-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
  overflow: auto;
  padding: var(--space-6);
  background: var(--surface-0, rgba(15, 23, 42, 0.04));
  background-image: radial-gradient(var(--border-soft) 1px, transparent 0);
  background-size: 24px 24px;
  user-select: none;
  cursor: default;
  scrollbar-gutter: stable;
}
.edit-viewport.is-panning {
  cursor: grab;
}
.edit-viewport.is-panning:active {
  cursor: grabbing;
}
.edit-viewport.tool-crosshair { cursor: crosshair; }
.edit-viewport.tool-text { cursor: text; }
.edit-viewport.tool-eraser { cursor: cell; }

/* Document Board */
.edit-board {
  position: relative;
  display: inline-block;
  background: #FFFFFF;
  border-radius: 4px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08);
  transition: box-shadow var(--dur-base, 180ms);
  overflow: visible;
  transform-origin: center center;
}
[data-theme="blueprint"] .edit-board {
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.70), 0 0 0 1px rgba(255, 255, 255, 0.10);
}
.edit-board canvas#edit-page {
  display: block;
  max-width: none;
  height: auto;
  background: #FFFFFF;
  border-radius: 4px;
  direction: ltr;
}

/* Active Editing Layer */
.edit-layer {
  position: absolute;
  inset: 0;
  direction: ltr;
  touch-action: none;
  overflow: visible;
}

/* Objects on Canvas */
.edit-obj {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
  outline: 1px solid transparent;
  transform-origin: center center;
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  border-radius: 2px;
  user-select: none;
}
.edit-obj:active { cursor: grabbing; }
.edit-obj.is-selected {
  outline: 2px solid var(--accent);
  outline-offset: 0;
  z-index: 30;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.edit-obj.is-locked {
  outline-color: var(--text-muted);
  cursor: not-allowed;
}
.edit-obj.is-locked .edit-handle,
.edit-obj.is-locked .edit-rotate {
  display: none !important;
}

.edit-obj img,
.edit-obj svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

/* Text Content Rendering */
.edit-obj__text {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 4px;
  box-sizing: border-box;
  white-space: pre-wrap;
  overflow: hidden;
  line-height: 1.42;
  direction: rtl;
  word-break: break-word;
  pointer-events: none;
}

/* In-Place Live Textarea Editor */
.edit-inline-textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 4px;
  resize: none;
  border: 1.5px solid var(--accent);
  background: rgba(255, 255, 255, 0.96);
  color: inherit;
  font: inherit;
  line-height: 1.42;
  direction: rtl;
  white-space: pre-wrap;
  border-radius: 3px;
  outline: none;
  z-index: 40;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

/* Resize & Rotate Handles */
.edit-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--accent);
  border: 2px solid #FFFFFF;
  border-radius: 3px;
  z-index: 35;
  box-sizing: border-box;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
}
.edit-handle[data-handle="nw"] { top: -6px; left: -6px; cursor: nwse-resize; }
.edit-handle[data-handle="n"]  { top: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
.edit-handle[data-handle="ne"] { top: -6px; right: -6px; cursor: nesw-resize; }
.edit-handle[data-handle="e"]  { top: 50%; right: -6px; margin-top: -6px; cursor: ew-resize; }
.edit-handle[data-handle="se"] { bottom: -6px; right: -6px; cursor: nwse-resize; }
.edit-handle[data-handle="s"]  { bottom: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
.edit-handle[data-handle="sw"] { bottom: -6px; left: -6px; cursor: nesw-resize; }
.edit-handle[data-handle="w"]  { top: 50%; left: -6px; margin-top: -6px; cursor: ew-resize; }

.edit-rotate {
  position: absolute;
  left: 50%;
  top: -26px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: #FFFFFF;
  border: 2px solid var(--accent);
  border-radius: 50%;
  cursor: grab;
  z-index: 35;
  box-sizing: border-box;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.20);
}
.edit-rotate::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 10px;
  width: 2px;
  height: 12px;
  background: var(--accent);
  border-radius: 1px;
}
.edit-obj:not(.is-selected) .edit-handle,
.edit-obj:not(.is-selected) .edit-rotate {
  display: none;
}

/* Snap Guide Lines */
.edit-guide {
  position: absolute;
  pointer-events: none;
  z-index: 25;
}
.edit-guide--v {
  top: 0;
  bottom: 0;
  width: 1px;
  background: #3B82F6;
  box-shadow: 0 0 4px #3B82F6;
}
.edit-guide--h {
  left: 0;
  right: 0;
  height: 1px;
  background: #3B82F6;
  box-shadow: 0 0 4px #3B82F6;
}

/* Marquee Drag Box */
.edit-marquee {
  position: absolute;
  border: 1px solid var(--accent);
  background: var(--accent-soft, rgba(79, 70, 229, 0.12));
  pointer-events: none;
  z-index: 30;
  border-radius: 2px;
}

/* Ghost Creation Box */
.edit-ghost {
  position: absolute;
  border: 2px dashed var(--accent);
  background: var(--accent-soft, rgba(79, 70, 229, 0.10));
  pointer-events: none;
  border-radius: 3px;
  z-index: 28;
}

/* Live Ink Drawing Canvas */
.edit-ink-live {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 26;
}

/* Floating Quick Context Bar */
.edit-floating-bar {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--surface-3, #FFFFFF);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  padding: 4px 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  z-index: 50;
  transform: translate(-50%, -100%) translateY(-12px);
  pointer-events: auto;
  white-space: nowrap;
}
.edit-floating-bar .btn {
  height: 28px;
  padding: 0 var(--space-2);
  font-size: var(--t-xs, 0.74rem);
  border: 0;
  background: transparent;
}
.edit-floating-bar .btn:hover {
  background: var(--surface-2);
  color: var(--accent);
}

/* Stage Bottom Status & Hint */
.edit-stage__status, .edit-stage__hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-4);
  background: var(--surface-0, rgba(15, 23, 42, 0.02));
  border-top: 1px solid var(--border-soft);
  font-size: var(--t-2xs, 0.72rem);
  color: var(--text-muted);
}
.edit-stage__status kbd, .edit-stage__hint kbd {
  font-family: var(--data, "Playfair Display", monospace);
  font-size: 0.85em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  color: var(--text-primary);
}

/* ——— 3. Contextual Inspector Sidebar ——— */
.edit-inspector, .edit-panel {
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  min-width: 0;
  max-height: calc(100dvh - var(--header-h, 52px) - 60px);
}
.edit-inspector__scroll {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  overflow-y: auto;
  flex: 1;
  scrollbar-gutter: stable;
}

.edit-inspector .panel-block, .edit-panel .panel-block {
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
}
.edit-inspector .panel-block__title, .edit-panel .panel-block__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-xs, 0.80rem);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Swatches & Chips */
.edit-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--space-2);
}
.edit-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  cursor: pointer;
  transition: transform var(--dur-fast, 140ms), box-shadow var(--dur-fast, 140ms);
}
.edit-swatch:hover { transform: scale(1.15); }
.edit-swatch.is-active {
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px var(--accent-soft);
  border-color: #FFFFFF;
}

.edit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: var(--space-2);
}
.edit-chip {
  min-width: 32px;
  height: 26px;
  padding: 0 var(--space-2);
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-xs, 0.72rem);
  font-weight: 700;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background: var(--surface-3, #FFFFFF);
  color: var(--ink-2);
  cursor: pointer;
  transition: all var(--dur-fast, 140ms);
}
.edit-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.edit-chip.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #FFFFFF;
}

/* Alignment Grid */
.edit-align-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
}
.edit-align-btn {
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-soft);
  background: var(--surface-3, #FFFFFF);
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}
.edit-align-btn:hover {
  background: var(--surface-2);
  color: var(--accent);
  border-color: var(--accent);
}
.edit-align-btn .icon { width: 14px; height: 14px; }

/* Layers List */
.edit-layers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 4px;
  background: var(--surface-0, rgba(15, 23, 42, 0.02));
}
.edit-layers:empty::before {
  content: "لا عناصر بعد — اضغط على الصفحة لإضافة نص أو شكل";
  font-size: var(--t-2xs, 0.72rem);
  color: var(--text-muted);
  text-align: center;
  padding: var(--space-3);
  display: block;
}
.edit-layer-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  background: var(--surface-3, #FFFFFF);
  cursor: pointer;
  font-size: var(--t-2xs, 0.74rem);
  transition: all var(--dur-fast, 140ms);
}
.edit-layer-row:hover {
  border-color: var(--border-strong);
}
.edit-layer-row.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}
.edit-layer-row__name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: start;
}
.edit-layer-row__btn, .edit-layer-row__del {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
}
.edit-layer-row__btn:hover, .edit-layer-row__del:hover {
  background: var(--surface-2);
  color: var(--text-primary);
}
.edit-layer-row__btn--del:hover {
  background: var(--danger-soft);
  color: var(--danger, #E11D48);
}
.edit-layer-row__btn .icon, .edit-layer-row__del .icon { width: 12px; height: 12px; }

/* Preset stamps grid */
.edit-stamps-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.edit-stamp-preset {
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid currentColor;
  border-radius: 4px;
  font-family: "Amiri", "Noto Naskh Arabic", serif;
  font-size: var(--t-xs, 0.82rem);
  font-weight: 700;
  cursor: pointer;
  background: transparent;
  transition: all var(--dur-fast, 140ms);
}
.edit-stamp-preset:hover {
  transform: scale(1.03);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

/* Shape Presets */
.edit-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.edit-preset {
  height: 32px;
  padding: 0 var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: var(--t-xs, 0.74rem);
  font-weight: 600;
  border-radius: var(--radius-sm, 8px);
  border: 1px solid var(--border-strong);
  background: var(--surface-3, #FFFFFF);
  color: var(--ink-2);
  cursor: pointer;
  transition: all var(--dur-fast, 140ms);
}
.edit-preset:hover {
  border-color: var(--accent);
}
.edit-preset i {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  display: inline-block;
  border: 1px solid var(--border-strong);
  flex: none;
}

/* Responsive Rules */
@media (max-width: 1080px) {
  .edit-workspace {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .edit-workspace {
    grid-template-columns: 1fr;
  }
  .edit-sidebar, .edit-inspector {
    max-height: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .edit-obj, .edit-thumb-item, .edit-tool-btn, .edit-swatch {
    transition: none !important;
  }
}
`;

export const STYLE_ID = "pdf-studio-edit-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
}

function icon(href) {
  return `<svg class="icon" aria-hidden="true"><use href="#${href}"></use></svg>`;
}

export const INK_COLORS = ["#111827", "#1E3A8A", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777"];
export const HIGHLIGHT_COLORS = ["#FDE047", "#86EFAC", "#93C5FD", "#F9A8D4", "#FDBA74"];
export const FILL_COLORS = ["#FDE68A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FECACA", "#E5E7EB", "#FFFFFF"];
export const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48];

function swatches(forId, colors) {
  return `<div class="edit-swatches">${colors
    .map((c) => `<button type="button" class="edit-swatch" data-swatch="${c}" data-for="${forId}" style="background:${c}" aria-label="لون ${c}"></button>`)
    .join("")}</div>`;
}

function choice(name, value, label, iconHref, checked = false) {
  const ic = iconHref ? icon(iconHref) : "";
  return `<label class="choice edit-tool-radio"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} /><span>${ic}<span>${label}</span></span></label>`;
}

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("edit-root");
  root.innerHTML = `
    <div class="view__head">
      <h2 class="view__title" id="edit-title" tabindex="-1">تحرير</h2>
      <p class="view__lede">أدوات تحرير احترافية: نصوص عربية مباشرة، تظليل، حجب وتبييض، أشكال وأسهم، أختام وتوقيعات.</p>
    </div>

    <div class="view__body">
      <!-- Hero File Intake Drop Area -->
      <div id="edit-drop" class="intake" data-kind="pdf">
        ${icon("icon-file")}
        <span class="intake__title">أسقط ملف PDF هنا</span>
        <span class="intake__hint">اختر ملفاً لعرض صفحاته ومصغراته فوراً مع إمكانية إضافة وتعديل النصوص والأشكال والأختام بدقة عالية.</span>
        <button id="edit-browse" type="button" class="btn">تصفّح</button>
      </div>
      <input id="edit-input" type="file" accept="application/pdf,.pdf" hidden />
      <input id="edit-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />

      <!-- Active Workspace -->
      <div id="edit-workspace" class="edit-workspace" hidden>
        
        <!-- 1. Interactive Thumbnails Sidebar -->
        <aside class="edit-sidebar" id="edit-sidebar" aria-label="مصغرات الصفحات">
          <div class="edit-sidebar__head">
            <span class="edit-sidebar__title">
              ${icon("icon-sidebar")} الصفحات
              <span class="edit-sidebar__count num" id="edit-sidebar-count">0</span>
            </span>
            <button id="edit-sidebar-toggle" type="button" class="btn btn--compact" title="طي / فتح الشريط الجانبي">
              ${icon("icon-chev")}
            </button>
          </div>
          <div class="edit-thumbs" id="edit-thumbs" role="list"></div>
        </aside>

        <!-- 2. Central Stage & Viewport -->
        <section class="edit-stage" aria-label="مسرح التحرير">
          <!-- Main Top Toolbar -->
          <div class="edit-topbar edit-stage__bar">
            <!-- Navigation -->
            <div class="edit-nav-group scan__pager">
              <button id="edit-sidebar-btn" type="button" class="edit-nav-btn" title="شريط الصفحات">
                ${icon("icon-sidebar")}
              </button>
              <button id="edit-prev" type="button" class="edit-nav-btn btn btn--compact" title="الصفحة السابقة">
                ${icon("icon-arrow")} السابقة
              </button>
              <span class="edit-nav-count scan__count num" id="edit-count">1 / 1</span>
              <button id="edit-next" type="button" class="edit-nav-btn btn btn--compact" title="الصفحة التالية">
                التالية <svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg>
              </button>
            </div>

            <!-- Tool Selection Group -->
            <div class="edit-toolbar edit-tool-group" role="radiogroup" aria-label="أداة التحرير">
              ${choice("edit-tool", "select", "تحديد", "icon-quad", true)}
              ${choice("edit-tool", "hand", "تحريك", "icon-hand")}
              ${choice("edit-tool", "text", "نص", "icon-file")}
              ${choice("edit-tool", "highlight", "تظليل", "icon-highlighter")}
              ${choice("edit-tool", "whiteout", "حجب", "icon-crop")}
              ${choice("edit-tool", "pen", "قلم", "icon-sign")}
              ${choice("edit-tool", "eraser", "ممحاة", "icon-eraser")}
              ${choice("edit-tool", "rect", "مربع", "icon-crop")}
              ${choice("edit-tool", "ellipse", "دائرة", "icon-contrast")}
              ${choice("edit-tool", "triangle", "مثلث", "icon-alert")}
              ${choice("edit-tool", "arrow", "سهم", "icon-arrow-line")}
              ${choice("edit-tool", "line", "خط", "icon-line")}
              ${choice("edit-tool", "stamp", "ختم", "icon-stamp")}
              ${choice("edit-tool", "image", "صورة", "icon-images")}
            </div>

            <!-- Zoom & Pan Controls -->
            <div class="edit-zoom-group edit-stage__zoom">
              <button id="edit-zoom-out" type="button" class="edit-nav-btn btn btn--compact" title="تصغير">${icon("icon-rotate")} -</button>
              <span class="edit-zoom-label num" id="edit-zoom-label">100%</span>
              <button id="edit-zoom-in" type="button" class="edit-nav-btn btn btn--compact" title="تكبير">${icon("icon-plus")} +</button>
              <button id="edit-zoom-fit" type="button" class="edit-tool-btn btn btn--compact" title="ملء العرض">${icon("icon-crop")} ملء</button>
            </div>

            <!-- Quick Action Buttons -->
            <div class="btn-row">
              <button id="edit-undo" type="button" class="edit-tool-btn btn" title="تراجع (Ctrl+Z)">${icon("icon-rotate")} تراجع</button>
              <button id="edit-redo" type="button" class="edit-tool-btn btn" title="إعادة (Ctrl+Y)">${icon("icon-rotate")} إعادة</button>
              <button id="edit-delete" type="button" class="edit-tool-btn btn" title="حذف المحدد (Delete)">${icon("icon-trash")} حذف</button>
            </div>
          </div>

          <!-- Canvas Viewport -->
          <div class="edit-viewport edit-board-wrap" id="edit-wrap">
            <div class="edit-board" id="edit-board">
              <canvas id="edit-page" width="794" height="1123" aria-label="صفحة المستند"></canvas>
              <div id="edit-layer" class="edit-layer" data-tool="select"></div>
              <div id="edit-guides" class="edit-guides-wrap"></div>
            </div>

            <!-- Floating In-Place Quick Bar -->
            <div id="edit-floating-bar" class="edit-floating-bar" hidden>
              <button id="fl-duplicate" type="button" class="btn" title="تكرار (Ctrl+D)">${icon("icon-duplicate")} تكرار</button>
              <button id="fl-lock" type="button" class="btn" title="قفل العنصر">${icon("icon-lock")} قفل</button>
              <button id="fl-delete" type="button" class="btn" title="حذف (Delete)">${icon("icon-trash")} حذف</button>
            </div>
          </div>

          <!-- Stage Status Footer -->
          <div class="edit-stage__status edit-stage__hint">
            <span>💡 اضغط على الصفحة لإضافة العنصر المختار · اسحب الزوايا للحجم · المقبض العلوي للتدوير · <kbd>Delete</kbd> يحذف · <kbd>Ctrl+Z</kbd> تراجع · <kbd>Ctrl</kbd>+عجلة الفأرة تكبير</span>
            <span id="edit-status-info" class="num">جاهز</span>
          </div>
        </section>

        <!-- 3. Contextual Inspector Sidebar -->
        <aside class="edit-inspector edit-panel" aria-label="لوحة الخصائص">
          <div class="edit-inspector__scroll">

            <!-- Alignment & Multi-Selection Panel -->
            <div class="panel-block" id="panel-align">
              <h3 class="panel-block__title">المحاذاة والترتيب</h3>
              <div class="edit-align-grid">
                <button id="align-right" type="button" class="edit-align-btn" title="محاذاة لليمين">${icon("icon-align-right")}</button>
                <button id="align-center-h" type="button" class="edit-align-btn" title="محاذاة للوسط أفقياً">${icon("icon-align-center")}</button>
                <button id="align-left" type="button" class="edit-align-btn" title="محاذاة لليسار">${icon("icon-align-left")}</button>
                <button id="align-top" type="button" class="edit-align-btn" title="محاذاة للأعلى">${icon("icon-arrow")}</button>
                <button id="align-center-v" type="button" class="edit-align-btn" title="محاذاة للوسط رأسياً">${icon("icon-grip")}</button>
                <button id="align-bottom" type="button" class="edit-align-btn" title="محاذاة للأسفل"><svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg></button>
              </div>
            </div>

            <!-- Text Inspector Panel -->
            <div class="panel-block" data-edit-panel="text" hidden>
              <h3 class="panel-block__title">النص</h3>
              <div class="field field--wide">
                <label for="edit-text-font">نوع الخط</label>
                <select id="edit-text-font">
                  <option value="naskh" selected>خط النسخ (Noto Naskh)</option>
                  <option value="amiri">خط أميري (Amiri)</option>
                  <option value="cairo">خط كايرو (Cairo)</option>
                  <option value="sans">خط النظام (Sans Serif)</option>
                  <option value="mono">أحادي المسافة (Monospace)</option>
                </select>
              </div>
              <div class="field field--wide">
                <label for="edit-text">المحتوى</label>
                <textarea id="edit-text" rows="3" maxlength="2000" placeholder="اكتب النص هنا..."></textarea>
              </div>
              <div class="grid-2col">
                <div class="field">
                  <label for="edit-text-size">الحجم</label>
                  <input id="edit-text-size" type="number" min="10" max="96" value="18" />
                </div>
                <div class="field">
                  <label for="edit-text-color">اللون</label>
                  <input id="edit-text-color" type="color" value="#1E3A8A" />
                </div>
              </div>
              ${swatches("edit-text-color", INK_COLORS)}
              <div class="edit-chips" role="group" aria-label="مقاسات سريعة">
                ${TEXT_SIZES.map((s) => `<button type="button" class="edit-chip" data-size-chip="${s}" data-for="edit-text-size">${s}</button>`).join("")}
              </div>
              <div class="grid-2col" style="margin-top: var(--space-2)">
                <label class="check">
                  <input id="edit-text-bold" type="checkbox" />
                  عريض
                </label>
                <label class="check">
                  <input id="edit-text-italic" type="checkbox" />
                  مائل
                </label>
              </div>
              <div class="grid-2col">
                <label class="check">
                  <input id="edit-text-underline" type="checkbox" />
                  تسطير
                </label>
                <label class="check">
                  <input id="edit-text-strike" type="checkbox" />
                  يتوسطه خط
                </label>
              </div>
              <div class="field field--wide">
                <span>المحاذاة</span>
                <div class="choice-grid" role="radiogroup">
                  ${choice("edit-align", "right", "يمين", "icon-align-right", true)}
                  ${choice("edit-align", "center", "وسط", "icon-align-center", false)}
                  ${choice("edit-align", "left", "يسار", "icon-align-left", false)}
                </div>
              </div>
              <div class="grid-2col">
                <label class="check">
                  <input id="edit-text-bg-on" type="checkbox" />
                  خلفية
                </label>
                <input id="edit-text-bg-color" type="color" value="#FFFFFF" />
              </div>
            </div>

            <!-- Highlighter Panel -->
            <div class="panel-block" data-edit-panel="highlight" hidden>
              <h3 class="panel-block__title">قلم التظليل</h3>
              <div class="field">
                <label for="edit-hl-color">لون التظليل</label>
                <input id="edit-hl-color" type="color" value="#FDE047" />
              </div>
              ${swatches("edit-hl-color", HIGHLIGHT_COLORS)}
              <div class="field" style="margin-top: var(--space-2)">
                <label for="edit-hl-opacity">درجة الشفافية</label>
                <input id="edit-hl-opacity" type="range" min="0.1" max="0.8" step="0.05" value="0.35" />
              </div>
            </div>

            <!-- Whiteout Panel -->
            <div class="panel-block" data-edit-panel="whiteout" hidden>
              <h3 class="panel-block__title">تغطية وحجب</h3>
              <p class="panel-block__meta">غطِّ الأخطاء أو البيانات بمستطيل معتم ناصع البياض.</p>
              <div class="grid-2col">
                <div class="field">
                  <label for="edit-wo-color">لون التغطية</label>
                  <input id="edit-wo-color" type="color" value="#FFFFFF" />
                </div>
                <label class="check" style="align-self: flex-end">
                  <input id="edit-wo-border" type="checkbox" />
                  حد خفيف
                </label>
              </div>
            </div>

            <!-- Shapes & Arrows Panel -->
            <div class="panel-block" data-edit-panel="shape" hidden>
              <h3 class="panel-block__title">الشكل</h3>
              <div class="edit-presets" role="group" aria-label="أنماط جاهزة">
                <button type="button" class="edit-preset" data-shape-preset="frame"><i style="background:#fff;border-color:#DC2626"></i> إطار</button>
                <button type="button" class="edit-preset" data-shape-preset="highlight"><i style="background:#FDE68A"></i> تظليل</button>
                <button type="button" class="edit-preset" data-shape-preset="fill"><i style="background:#BFDBFE"></i> تعبئة</button>
                <button type="button" class="edit-preset" data-shape-preset="cover"><i style="background:#fff"></i> تغطية</button>
              </div>
              <div class="grid-2col" style="margin-top: var(--space-2)">
                <label class="check">
                  <input id="edit-fill-on" type="checkbox" checked />
                  تعبئة
                </label>
                <input id="edit-fill-color" type="color" value="#BFDBFE" />
              </div>
              ${swatches("edit-fill-color", FILL_COLORS)}
              <div class="grid-2col" style="margin-top: var(--space-2)">
                <div class="field">
                  <label for="edit-stroke-color">لون الحد</label>
                  <input id="edit-stroke-color" type="color" value="#1E3A8A" />
                </div>
                <div class="field">
                  <label for="edit-stroke-width">سُمك الحد</label>
                  <input id="edit-stroke-width" type="number" min="0" max="24" step="0.5" value="1.5" />
                </div>
              </div>
              ${swatches("edit-stroke-color", INK_COLORS)}
              <div class="field" style="margin-top: var(--space-2)">
                <label for="edit-shape-opacity">الشفافية</label>
                <input id="edit-shape-opacity" type="range" min="0.05" max="1" step="0.05" value="1" />
              </div>
            </div>

            <!-- Freehand Pen Panel -->
            <div class="panel-block" data-edit-panel="pen" hidden>
              <h3 class="panel-block__title">القلم الحر</h3>
              <div class="grid-2col">
                <div class="field">
                  <label for="edit-pen-color">اللون</label>
                  <input id="edit-pen-color" type="color" value="#1E3A8A" />
                </div>
                <div class="field">
                  <label for="edit-pen-weight">السُمك</label>
                  <select id="edit-pen-weight">
                    <option value="1.2">رفيع</option>
                    <option value="2.2" selected>متوسط</option>
                    <option value="4">سميك</option>
                    <option value="7">عريض</option>
                  </select>
                </div>
              </div>
              ${swatches("edit-pen-color", INK_COLORS)}
              <p class="panel-block__meta" style="margin-top: var(--space-2)">اسحب على الصفحة للرسم أو التوقيع بحرية.</p>
            </div>

            <!-- Arabic Stamps Panel -->
            <div class="panel-block" data-edit-panel="stamp" hidden>
              <h3 class="panel-block__title">الأختام</h3>
              <div class="edit-stamps-grid">
                <button type="button" class="edit-stamp-preset" data-stamp="معتمد" style="color: #DC2626">معتمد</button>
                <button type="button" class="edit-stamp-preset" data-stamp="سري للغاية" style="color: #DC2626">سري للغاية</button>
                <button type="button" class="edit-stamp-preset" data-stamp="مسودة" style="color: #2563EB">مسودة</button>
                <button type="button" class="edit-stamp-preset" data-stamp="ملغى" style="color: #DC2626">ملغى</button>
                <button type="button" class="edit-stamp-preset" data-stamp="مدفوع" style="color: #059669">مدفوع</button>
                <button type="button" class="edit-stamp-preset" data-stamp="طبق الأصل" style="color: #7C3AED">طبق الأصل</button>
              </div>
              <div class="field field--wide" style="margin-top: var(--space-2)">
                <label for="edit-stamp-custom">نص ختم مخصص</label>
                <input id="edit-stamp-custom" type="text" placeholder="اكتب نص الختم..." />
              </div>
            </div>

            <!-- Image Panel -->
            <div class="panel-block" data-edit-panel="image" hidden>
              <h3 class="panel-block__title">الصورة</h3>
              <p class="panel-block__meta" id="edit-image-meta">PNG أو JPG أو WEBP — تُضاف في الوسط ويمكن سحب زواياها.</p>
              <button id="edit-image-browse" type="button" class="btn btn--wide">
                ${icon("icon-upload")} اختيار صورة
              </button>
            </div>

            <!-- Layers Stack -->
            <div class="panel-block">
              <h3 class="panel-block__title">
                <span>الطبقات</span>
                <button id="edit-layers-clear" type="button" class="btn btn--compact" title="حذف كل طبقات الصفحة">${icon("icon-trash")}</button>
              </h3>
              <div id="edit-layers" class="edit-layers" aria-label="قائمة الطبقات"></div>
            </div>

            <!-- Final Save & Export Action Card -->
            <div class="panel-block panel-block--bare">
              <button id="edit-save" type="button" class="btn btn--act btn--wide">حفظ التحرير — دمج الطبقات</button>
              <button id="edit-clear" type="button" class="btn btn--wide" style="margin-top: var(--space-2)">
                ${icon("icon-close")} إغلاق المستند
              </button>
            </div>

          </div>
        </aside>

      </div>
    </div>
  `;

  const intakeGlyph = root.querySelector("#edit-drop .icon");
  if (intakeGlyph) intakeGlyph.classList.add("intake__glyph");

  return {
    drop: root.querySelector("#edit-drop"),
    browse: root.querySelector("#edit-browse"),
    input: root.querySelector("#edit-input"),
    imageInput: root.querySelector("#edit-image-input"),
    imageBrowse: root.querySelector("#edit-image-browse"),
    imageMeta: root.querySelector("#edit-image-meta"),
    workspace: root.querySelector("#edit-workspace"),
    sidebar: root.querySelector("#edit-sidebar"),
    sidebarCount: root.querySelector("#edit-sidebar-count"),
    sidebarToggle: root.querySelector("#edit-sidebar-toggle"),
    sidebarBtn: root.querySelector("#edit-sidebar-btn"),
    thumbs: root.querySelector("#edit-thumbs"),
    viewport: root.querySelector("#edit-wrap"),
    wrap: root.querySelector("#edit-wrap"),
    board: root.querySelector("#edit-board"),
    canvas: root.querySelector("#edit-page"),
    layer: root.querySelector("#edit-layer"),
    guides: root.querySelector("#edit-guides"),
    floatingBar: root.querySelector("#edit-floating-bar"),
    flDuplicate: root.querySelector("#fl-duplicate"),
    flLock: root.querySelector("#fl-lock"),
    flDelete: root.querySelector("#fl-delete"),
    prev: root.querySelector("#edit-prev"),
    next: root.querySelector("#edit-next"),
    count: root.querySelector("#edit-count"),
    statusInfo: root.querySelector("#edit-status-info"),
    zoomIn: root.querySelector("#edit-zoom-in"),
    zoomOut: root.querySelector("#edit-zoom-out"),
    zoomFit: root.querySelector("#edit-zoom-fit"),
    zoomLabel: root.querySelector("#edit-zoom-label"),
    layers: root.querySelector("#edit-layers"),
    layersClear: root.querySelector("#edit-layers-clear"),
    text: root.querySelector("#edit-text"),
    textFont: root.querySelector("#edit-text-font"),
    textSize: root.querySelector("#edit-text-size"),
    textColor: root.querySelector("#edit-text-color"),
    textBold: root.querySelector("#edit-text-bold"),
    textItalic: root.querySelector("#edit-text-italic"),
    textUnderline: root.querySelector("#edit-text-underline"),
    textStrike: root.querySelector("#edit-text-strike"),
    textBgOn: root.querySelector("#edit-text-bg-on"),
    textBgColor: root.querySelector("#edit-text-bg-color"),
    hlColor: root.querySelector("#edit-hl-color"),
    hlOpacity: root.querySelector("#edit-hl-opacity"),
    woColor: root.querySelector("#edit-wo-color"),
    woBorder: root.querySelector("#edit-wo-border"),
    penColor: root.querySelector("#edit-pen-color"),
    penWeight: root.querySelector("#edit-pen-weight"),
    fillOn: root.querySelector("#edit-fill-on"),
    fillColor: root.querySelector("#edit-fill-color"),
    strokeColor: root.querySelector("#edit-stroke-color"),
    strokeWidth: root.querySelector("#edit-stroke-width"),
    shapeOpacity: root.querySelector("#edit-shape-opacity"),
    stampCustom: root.querySelector("#edit-stamp-custom"),
    undo: root.querySelector("#edit-undo"),
    redo: root.querySelector("#edit-redo"),
    remove: root.querySelector("#edit-delete"),
    save: root.querySelector("#edit-save"),
    clear: root.querySelector("#edit-clear"),
    alignRight: root.querySelector("#align-right"),
    alignCenterH: root.querySelector("#align-center-h"),
    alignLeft: root.querySelector("#align-left"),
    alignTop: root.querySelector("#align-top"),
    alignCenterV: root.querySelector("#align-center-v"),
    alignBottom: root.querySelector("#align-bottom")
  };
}
