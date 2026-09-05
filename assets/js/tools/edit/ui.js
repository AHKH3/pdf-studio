const CSS = `
/* ==========================================================================
   PDF Studio — PDF Editor UI (Lumen Glow v2 Floating Canvas Architecture)
   ========================================================================== */

/* Full Viewport Expansion with Harmonious Spacing */
.work:has(#view-edit.view--active) {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
  min-height: 0 !important;
  height: calc(100vh - var(--header-h, 44px) - 8px) !important;
  padding: 6px var(--space-3) 8px !important;
  max-width: none !important;
  width: 100% !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
}

#view-edit.view--active {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
  min-height: 0 !important;
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box !important;
}

#view-edit .view__head {
  display: none !important;
}

#view-edit .view__body {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
  min-height: 0 !important;
  background: transparent !important;
  border: 0 !important;
  padding: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  box-sizing: border-box !important;
}

.edit-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}

/* ——— Hero Intake Drop Area ——— */
#edit-drop.intake {
  min-height: 380px;
  max-width: 640px;
  margin: var(--space-8) auto;
  border: 1.5px dashed var(--border-strong);
  background: var(--surface-1);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  transition: all var(--dur-fast, 140ms) var(--ease, ease);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-8);
  text-align: center;
}
#edit-drop.intake:hover,
#edit-drop.intake.is-over {
  background: var(--surface-2);
  border-color: var(--accent);
  border-style: solid;
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}
#edit-drop .intake__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-md, 1.15rem);
  font-weight: 700;
  color: var(--text-primary);
}
#edit-drop .intake__hint {
  font-size: var(--t-xs, 0.8125rem);
  color: var(--text-muted);
  max-width: 44ch;
  text-wrap: balance;
  line-height: 1.6;
}

/* ——— Workspace Full-Bleed Creative Canvas Architecture ——— */
.edit-workspace {
  position: relative;
  display: block;
  width: 100%;
  height: calc(100vh - var(--header-h, 44px) - 20px);
  min-height: 520px;
  overflow: hidden;
  box-sizing: border-box;
  border-radius: var(--radius-lg);
  background: var(--surface-0, rgba(15, 23, 42, 0.03));
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-panel);
}

/* ——— 1. Floating Thumbnails Drawer (Right in RTL) ——— */
.edit-sidebar {
  position: absolute;
  top: 76px;
  right: 16px;
  bottom: 76px;
  width: 220px;
  background: var(--surface-3, rgba(255, 255, 255, 0.88));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  z-index: 105;
  display: flex;
  flex-direction: column;
  transition: transform var(--dur-base, 220ms) cubic-bezier(0.16, 1, 0.3, 1), opacity var(--dur-base, 220ms) ease;
}
.edit-workspace.sidebar-collapsed .edit-sidebar {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
}
.edit-sidebar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-1);
  height: 42px;
  min-height: 42px;
}
.edit-sidebar__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.edit-sidebar__count {
  font-size: var(--t-2xs, 0.75rem);
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
}
.edit-thumbs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  overflow-y: auto;
  flex: 1;
  scrollbar-gutter: stable;
}
.edit-thumb-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--surface-1);
  border: 1.5px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 8px;
  cursor: pointer;
  transition: all var(--dur-fast, 140ms) var(--ease, ease);
  user-select: none;
}
.edit-thumb-item:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}
.edit-thumb-item.is-active {
  border-color: var(--accent);
  background: var(--surface-2);
  box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-glow);
}
.edit-thumb-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1.414;
  background: var(--surface-3, #FFFFFF);
  border-radius: var(--radius-xs);
  overflow: hidden;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-soft);
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
  margin-top: 6px;
  padding: 0 2px;
}
.edit-thumb-num {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-2xs, 0.75rem);
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
}
.edit-thumb-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  background: var(--surface-2);
  color: var(--text-muted);
  border-radius: var(--radius-xs);
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

/* ——— 2. Central Full-Bleed Stage & Viewport ——— */
.edit-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  min-width: 0;
  z-index: 1;
}

/* Floating Dynamic Island Topbar */
.edit-topbar, .edit-stage__bar {
  position: absolute !important;
  top: 14px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 12px !important;
  padding: 6px 14px !important;
  height: 52px !important;
  min-height: 52px !important;
  max-height: 52px !important;
  width: max-content !important;
  max-width: calc(100% - 32px) !important;
  background: var(--surface-3, rgba(255, 255, 255, 0.88)) !important;
  backdrop-filter: blur(24px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
  border: 1px solid var(--border-soft) !important;
  border-radius: var(--radius-pill) !important;
  box-shadow: var(--shadow-panel) !important;
  z-index: 120 !important;
  overflow: visible !important;
  box-sizing: border-box !important;
  white-space: nowrap !important;
  user-select: none !important;
}

.edit-topbar__section {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  flex-shrink: 0 !important;
}

.edit-toolbar, .edit-tool-group {
  display: inline-flex !important;
  align-items: center !important;
  gap: 3px !important;
  background: var(--surface-2) !important;
  border: 1px solid var(--border-soft) !important;
  border-radius: var(--radius-pill) !important;
  padding: 3px 5px !important;
  position: relative !important;
}

.edit-tool-divider {
  width: 1px;
  height: 18px;
  background: var(--border-strong);
  margin: 0 3px;
}

/* Specific Override for Tool Radios in Header */
.edit-topbar .edit-tool-radio,
.edit-toolbar .edit-tool-radio {
  display: inline-flex !important;
  align-items: center !important;
  position: relative !important;
  cursor: pointer !important;
  margin: 0 !important;
  width: auto !important;
  flex: none !important;
}

.edit-topbar .edit-tool-radio input[type="radio"],
.edit-toolbar .edit-tool-radio input[type="radio"] {
  position: absolute !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.edit-topbar .edit-tool-radio input[type="radio"] + span,
.edit-toolbar .edit-tool-radio input[type="radio"] + span {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  height: 36px !important;
  min-height: 36px !important;
  max-height: 36px !important;
  padding: 0 12px !important;
  width: auto !important;
  border-radius: var(--radius-pill) !important;
  color: var(--text-muted) !important;
  font-size: var(--t-sm, 0.8125rem) !important;
  font-weight: 600 !important;
  transition: all var(--dur-fast, 140ms) cubic-bezier(0.4, 0, 0.2, 1) !important;
  user-select: none !important;
  white-space: nowrap !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}

.edit-topbar .edit-tool-radio input[type="radio"] + span .icon,
.edit-toolbar .edit-tool-radio input[type="radio"] + span .icon {
  display: inline-block !important;
  width: 14px !important;
  height: 14px !important;
}

.edit-topbar .edit-tool-radio:hover input[type="radio"] + span,
.edit-toolbar .edit-tool-radio:hover input[type="radio"] + span {
  color: var(--text-primary) !important;
  background: var(--surface-1) !important;
}

.edit-topbar .edit-tool-radio input[type="radio"]:checked + span,
.edit-toolbar .edit-tool-radio input[type="radio"]:checked + span {
  background: var(--accent) !important;
  color: #FFFFFF !important;
  box-shadow: 0 1px 6px var(--accent-glow) !important;
}

/* Consolidated Shapes Dropdown */
.edit-dropdown-wrap {
  position: relative !important;
  display: inline-flex !important;
  align-items: center !important;
}

.edit-dropdown-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  height: 36px !important;
  min-height: 36px !important;
  padding: 0 12px !important;
  border-radius: var(--radius-pill) !important;
  color: var(--text-muted) !important;
  font-size: var(--t-sm, 0.8125rem) !important;
  font-weight: 600 !important;
  transition: all var(--dur-fast, 140ms) cubic-bezier(0.4, 0, 0.2, 1) !important;
  user-select: none !important;
  white-space: nowrap !important;
  border: 0 !important;
  background: transparent !important;
  cursor: pointer !important;
}
.edit-dropdown-btn:hover {
  color: var(--text-primary) !important;
  background: var(--surface-1) !important;
}
.edit-dropdown-btn.is-active {
  background: var(--accent) !important;
  color: #FFFFFF !important;
  box-shadow: 0 1px 6px var(--accent-glow) !important;
}
.edit-dropdown-btn .icon { width: 14px; height: 14px; }
.edit-dropdown-btn .chev { width: 10px; height: 10px; opacity: 0.7; }

.edit-popover-menu {
  position: absolute !important;
  top: calc(100% + 8px) !important;
  right: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 3px !important;
  background: var(--surface-3, #FFFFFF) !important;
  border: 1px solid var(--border-soft) !important;
  border-radius: var(--radius-md) !important;
  padding: 6px !important;
  box-shadow: var(--shadow-panel) !important;
  backdrop-filter: blur(24px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
  z-index: 999 !important;
  min-width: 140px !important;
}
.edit-popover-menu[hidden] {
  display: none !important;
}
.edit-popover-item {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  padding: 6px 10px !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--text-primary) !important;
  font-size: var(--t-xs, 0.8125rem) !important;
  font-weight: 600 !important;
  border-radius: var(--radius-xs) !important;
  cursor: pointer !important;
  text-align: start !important;
  transition: background var(--dur-fast, 140ms) !important;
}
.edit-popover-item:hover {
  background: var(--surface-2) !important;
  color: var(--accent) !important;
}
.edit-popover-item.is-active {
  background: var(--accent-soft) !important;
  color: var(--accent) !important;
  font-weight: 700 !important;
}
.edit-popover-item .icon { width: 14px !important; height: 14px !important; }

.edit-tool-btn, .edit-btn-compact {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  height: 36px !important;
  min-height: 36px !important;
  padding: 0 14px !important;
  border: 1px solid var(--border-soft) !important;
  background: var(--surface-2) !important;
  color: var(--text-primary) !important;
  font-size: var(--t-sm, 0.8125rem) !important;
  font-weight: 600 !important;
  border-radius: var(--radius-pill) !important;
  cursor: pointer !important;
  transition: all var(--dur-fast, 140ms) cubic-bezier(0.4, 0, 0.2, 1) !important;
  user-select: none !important;
  white-space: nowrap !important;
}
.edit-tool-btn .icon { width: 14px; height: 14px; }
.edit-tool-btn:hover {
  background: var(--surface-3, #FFFFFF) !important;
  border-color: var(--border-strong) !important;
  transform: translateY(-1px) !important;
  box-shadow: var(--shadow-soft) !important;
}
.edit-tool-btn:active {
  transform: translateY(0) !important;
}
.edit-tool-btn:disabled {
  opacity: 0.35 !important;
  cursor: not-allowed !important;
  transform: none !important;
  box-shadow: none !important;
}

.edit-btn-icon-only {
  width: 36px !important;
  height: 36px !important;
  padding: 0 !important;
  border-radius: 50% !important;
}

.edit-btn-primary {
  background: var(--accent) !important;
  color: #FFFFFF !important;
  border-color: var(--accent) !important;
  padding: 0 18px !important;
  box-shadow: 0 4px 12px var(--accent-glow) !important;
}
.edit-btn-primary:hover {
  background: var(--accent-hover) !important;
  box-shadow: 0 6px 16px var(--accent-glow) !important;
}

/* Page navigation strip */
.edit-nav-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px 4px;
}
.edit-nav-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  transition: background var(--dur-fast, 140ms);
}
.edit-nav-btn:hover {
  background: var(--surface-3, #FFFFFF);
  color: var(--accent);
}
.edit-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.edit-nav-btn .icon { width: 12px; height: 12px; }
.edit-nav-count {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 700;
  color: var(--text-primary);
  padding: 0 6px;
  direction: ltr;
}

/* Zoom group in status bar */
.edit-zoom-group, .edit-stage__zoom {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px 4px;
}
.edit-zoom-label {
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 700;
  color: var(--text-primary);
  min-width: 40px;
  text-align: center;
  direction: ltr;
}

/* Canvas Viewport */
.edit-viewport, .edit-board-wrap {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
  overflow: auto;
  padding: 84px 48px 84px;
  background: var(--surface-0, rgba(15, 23, 42, 0.03));
  background-image: radial-gradient(var(--border-soft) 1.5px, transparent 0);
  background-size: 24px 24px;
  user-select: none;
  cursor: default;
  scrollbar-gutter: stable;
  z-index: 1;
}
.edit-viewport.is-panning { cursor: grab; }
.edit-viewport.is-panning:active { cursor: grabbing; }
.edit-viewport.tool-crosshair { cursor: crosshair; }
.edit-viewport.tool-text { cursor: text; }
.edit-viewport.tool-eraser { cursor: cell; }

/* Document Board */
.edit-board {
  position: relative;
  display: inline-block;
  background: var(--surface-3, #FFFFFF);
  border-radius: var(--radius-xs);
  box-shadow: var(--shadow-panel);
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
  background: var(--surface-3, #FFFFFF);
  border-radius: var(--radius-xs);
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
  border-radius: var(--radius-xs);
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
  background: var(--surface-3, rgba(255, 255, 255, 0.98));
  color: inherit;
  font: inherit;
  line-height: 1.42;
  direction: rtl;
  white-space: pre-wrap;
  border-radius: var(--radius-xs);
  outline: none;
  z-index: 40;
  box-shadow: var(--shadow-panel);
}

/* Resize & Rotate Handles */
.edit-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--accent);
  border: 2px solid #FFFFFF;
  border-radius: var(--radius-xs);
  z-index: 35;
  box-sizing: border-box;
  box-shadow: var(--shadow-soft);
}
.edit-handle[data-handle="nw"] { top: -5px; left: -5px; cursor: nwse-resize; }
.edit-handle[data-handle="n"]  { top: -5px; left: 50%; margin-left: -5px; cursor: ns-resize; }
.edit-handle[data-handle="ne"] { top: -5px; right: -5px; cursor: nesw-resize; }
.edit-handle[data-handle="e"]  { top: 50%; right: -5px; margin-top: -5px; cursor: ew-resize; }
.edit-handle[data-handle="se"] { bottom: -5px; right: -5px; cursor: nwse-resize; }
.edit-handle[data-handle="s"]  { bottom: -5px; left: 50%; margin-left: -5px; cursor: ns-resize; }
.edit-handle[data-handle="sw"] { bottom: -5px; left: -5px; cursor: nesw-resize; }
.edit-handle[data-handle="w"]  { top: 50%; left: -5px; margin-top: -5px; cursor: ew-resize; }

.edit-rotate {
  position: absolute;
  left: 50%;
  top: -24px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: #FFFFFF;
  border: 2px solid var(--accent);
  border-radius: 50%;
  cursor: grab;
  z-index: 35;
  box-sizing: border-box;
  box-shadow: var(--shadow-soft);
}
.edit-rotate::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 10px;
  width: 2px;
  height: 12px;
  background: var(--accent);
  border-radius: var(--radius-xs);
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
  background: var(--accent);
  box-shadow: 0 0 4px var(--accent-glow);
}
.edit-guide--h {
  left: 0;
  right: 0;
  height: 1px;
  background: var(--accent);
  box-shadow: 0 0 4px var(--accent-glow);
}

/* Marquee Drag Box */
.edit-marquee {
  position: absolute;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  pointer-events: none;
  z-index: 30;
  border-radius: var(--radius-xs);
}

/* Ghost Creation Box */
.edit-ghost {
  position: absolute;
  border: 2px dashed var(--accent);
  background: var(--accent-soft);
  pointer-events: none;
  border-radius: var(--radius-xs);
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
  gap: 4px;
  background: var(--surface-3, rgba(255, 255, 255, 0.95));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 6px 8px;
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  z-index: 130;
  transform: translate(-50%, -100%) translateY(-14px);
  pointer-events: auto;
  white-space: nowrap;
}
.edit-floating-bar.is-below {
  transform: translate(-50%, 0) translateY(14px);
}
.edit-floating-bar .btn {
  height: 32px;
  padding: 0 12px;
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 600;
  border: 0;
  background: transparent;
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  transition: all var(--dur-fast) ease;
}
.edit-floating-bar .btn:hover {
  background: var(--surface-1);
  color: var(--accent);
}

/* Stage Bottom Status & Hint with Integrated Zoom */
.edit-stage__status, .edit-stage__hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 18px;
  height: 44px;
  min-height: 44px;
  background: var(--surface-3, rgba(255, 255, 255, 0.90));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  font-size: var(--t-xs, 0.8125rem);
  color: var(--text-muted);
  gap: 20px;
  z-index: 120;
  width: max-content;
  max-width: calc(100% - 32px);
  user-select: none;
}
.edit-stage__status-start {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.edit-stage__status-end {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.edit-stage__status kbd, .edit-stage__hint kbd {
  font-family: var(--data, "Playfair Display", monospace);
  font-size: 0.85em;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  color: var(--text-primary);
  font-weight: 600;
}

/* ——— 3. Floating Contextual Inspector Drawer (Left in RTL) ——— */
.edit-inspector, .edit-panel {
  position: absolute;
  top: 76px;
  left: 16px;
  bottom: 76px;
  width: 300px;
  max-width: calc(100% - 32px);
  background: var(--surface-3, rgba(255, 255, 255, 0.88));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  z-index: 110;
  display: flex;
  flex-direction: column;
  transition: transform var(--dur-base, 220ms) cubic-bezier(0.16, 1, 0.3, 1), opacity var(--dur-base, 220ms) ease;
}
.edit-workspace.inspector-collapsed .edit-inspector {
  transform: translateX(calc(-100% - 24px));
  opacity: 0;
  pointer-events: none;
}
.edit-inspector__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-1);
  height: 42px;
  min-height: 42px;
}
.edit-inspector__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.edit-inspector__scroll {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  overflow-y: auto;
  flex: 1;
  scrollbar-gutter: stable;
}

.edit-inspector .panel-block, .edit-panel .panel-block {
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  box-shadow: var(--shadow-soft);
}
.edit-inspector .panel-block__title, .edit-panel .panel-block__title {
  font-family: var(--ui, "Noto Naskh Arabic", serif);
  font-size: var(--t-sm, 0.8125rem);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.edit-inspector .panel-block__meta {
  font-size: var(--t-xs, 0.8125rem);
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 10px 0;
}
.edit-inspector .field label, .edit-panel .field label {
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 600;
  margin-bottom: 4px;
}
.edit-inspector .field input:not([type="color"]):not([type="range"]):not([type="checkbox"]), 
.edit-inspector .field select, 
.edit-inspector .field textarea {
  font-size: var(--t-sm, 0.8125rem);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-primary);
  font-family: inherit;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.edit-inspector .field input:focus, .edit-inspector .field select:focus, .edit-inspector .field textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: none;
}

/* Swatches & Chips */
.edit-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
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
  margin-top: 6px;
}
.edit-chip {
  min-width: 28px;
  height: 24px;
  padding: 0 6px;
  font-family: var(--data, "Playfair Display", serif);
  font-size: var(--t-2xs, 0.75rem);
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
  background: var(--surface-2);
  color: var(--text-muted);
  border-radius: var(--radius-xs);
  cursor: pointer;
  padding: 0;
  transition: all var(--dur-fast);
}
.edit-align-btn:hover {
  background: var(--surface-1);
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
  font-size: var(--t-2xs, 0.75rem);
  color: var(--text-muted);
  text-align: center;
  padding: var(--space-2);
  display: block;
}
.edit-layer-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 5px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xs);
  background: var(--surface-2);
  cursor: pointer;
  font-size: var(--t-2xs, 0.75rem);
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
  border-radius: var(--radius-xs);
  cursor: pointer;
  padding: 0;
}
.edit-layer-row__btn:hover, .edit-layer-row__del:hover {
  background: var(--surface-1);
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
  gap: 6px;
}
.edit-stamp-preset {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid currentColor;
  border-radius: var(--radius-xs);
  font-family: "Amiri", "Noto Naskh Arabic", serif;
  font-size: var(--t-xs, 0.8125rem);
  font-weight: 700;
  cursor: pointer;
  background: transparent;
  transition: all var(--dur-fast, 140ms);
}
.edit-stamp-preset:hover {
  transform: scale(1.03);
  box-shadow: var(--shadow-soft);
}

/* Shape Presets */
.edit-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 4px;
}
.edit-preset {
  height: 30px;
  padding: 0 var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: var(--t-2xs, 0.75rem);
  font-weight: 600;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--dur-fast, 140ms);
}
.edit-preset:hover { border-color: var(--accent); color: var(--accent); }
.edit-preset i {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-xs);
  display: inline-block;
  border: 1px solid var(--border-strong);
  flex: none;
}

/* Blueprint / Dark Theme Overrides */
[data-theme="blueprint"] .edit-topbar,
[data-theme="blueprint"] .edit-sidebar,
[data-theme="blueprint"] .edit-inspector,
[data-theme="blueprint"] .edit-stage__status,
[data-theme="blueprint"] .edit-floating-bar,
[data-theme="blueprint"] .edit-popover-menu {
  background: var(--surface-3) !important;
  border-color: var(--border-soft) !important;
  box-shadow: var(--shadow-panel) !important;
}

/* Responsive Rules */
@media (max-width: 1100px) {
  .edit-sidebar {
    width: 180px;
  }
  .edit-inspector {
    width: 260px;
  }
}
@media (max-width: 860px) {
  .edit-inspector {
    transform: translateX(calc(-100% - 24px));
  }
  .edit-workspace.inspector-open .edit-inspector {
    transform: translateX(0);
  }
  .edit-topbar, .edit-stage__bar {
    max-width: calc(100% - 16px) !important;
    padding: 4px 8px !important;
    gap: 6px !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .edit-obj, .edit-thumb-item, .edit-tool-btn, .edit-swatch, .edit-sidebar, .edit-inspector {
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
  return `<label class="choice edit-tool-radio" title="${label}"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} /><span>${ic}<span>${label}</span></span></label>`;
}

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("edit-root");
  root.innerHTML = `
    <!-- Hidden View Header (Accessible for tests and assistive tools) -->
    <div class="view__head" style="display:none !important">
      <h2 class="view__title" id="edit-title" tabindex="-1">تحرير</h2>
      <p class="view__lede">أدوات تحرير احترافية: نصوص عربية مباشرة، تظليل، حجب وتبييض، أشكال وأسهم، أختام وتوقيعات.</p>
    </div>

    <div class="view__body">
      <!-- Hero File Intake Drop Area (Shown only when no file is loaded) -->
      <div id="edit-drop" class="intake" data-kind="pdf">
        ${icon("icon-file")}
        <span class="intake__title">أسقط ملف PDF هنا للتحرير</span>
        <span class="intake__hint">اختر ملفاً لعرض صفحاته فوراً مع إمكانية إضافة وتعديل النصوص والأشكال والأختام بدقة عالية.</span>
        <button id="edit-browse" type="button" class="btn btn--act">تصفّح الملفات</button>
      </div>
      <input id="edit-input" type="file" accept="application/pdf,.pdf" hidden />
      <input id="edit-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />

      <!-- Active Workspace: 3-Zone Layout -->
      <div id="edit-workspace" class="edit-workspace" hidden>
        
        <!-- 1. Interactive Thumbnails Sidebar (Right in RTL) -->
        <aside class="edit-sidebar" id="edit-sidebar" aria-label="مصغرات الصفحات">
          <div class="edit-sidebar__head">
            <span class="edit-sidebar__title">
              ${icon("icon-sidebar")} الصفحات
              <span class="edit-sidebar__count num" id="edit-sidebar-count">0</span>
            </span>
            <button id="edit-sidebar-toggle" type="button" class="btn btn--compact" title="طي / فتح شريط المصغرات">
              ${icon("icon-chev")}
            </button>
          </div>
          <div class="edit-thumbs" id="edit-thumbs" role="list"></div>
        </aside>

        <!-- 2. Central Stage & Viewport -->
        <section class="edit-stage" aria-label="مسرح التحرير">
          <!-- Main Top Toolbar: 3 Clean Compact Sections with High Stacking Context -->
          <div class="edit-topbar edit-stage__bar">
            
            <!-- Right Section: Sidebar Toggle & Page Navigator -->
            <div class="edit-topbar__section">
              <button id="edit-sidebar-btn" type="button" class="edit-nav-btn" title="تبديل شريط الصفحات">
                ${icon("icon-sidebar")}
              </button>
              <div class="edit-nav-group">
                <button id="edit-prev" type="button" class="edit-nav-btn" title="الصفحة السابقة">
                  ${icon("icon-arrow")}
                </button>
                <span class="edit-nav-count num" id="edit-count">1 / 1</span>
                <button id="edit-next" type="button" class="edit-nav-btn" title="الصفحة التالية">
                  <svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg>
                </button>
              </div>
            </div>

            <!-- Center Section: Creation & Selection Tools Strip -->
            <div class="edit-topbar__section">
              <div class="edit-toolbar edit-tool-group" role="radiogroup" aria-label="أداة التحرير">
                <!-- Pointer group -->
                ${choice("edit-tool", "select", "تحديد", "icon-quad", true)}
                ${choice("edit-tool", "hand", "تحريك", "icon-hand")}
                <span class="edit-tool-divider"></span>

                <!-- Annotation group -->
                ${choice("edit-tool", "text", "نص", "icon-align-right")}
                ${choice("edit-tool", "highlight", "تظليل", "icon-highlighter")}
                ${choice("edit-tool", "whiteout", "حجب", "icon-eye-off")}
                ${choice("edit-tool", "pen", "قلم", "icon-sign")}
                ${choice("edit-tool", "eraser", "ممحاة", "icon-eraser")}
                <span class="edit-tool-divider"></span>

                <!-- Consolidated Shapes Dropdown -->
                <div class="edit-dropdown-wrap" id="edit-shapes-wrap">
                  <button id="edit-shapes-btn" type="button" class="edit-dropdown-btn" title="الأشكال والخطوط">
                    ${icon("icon-contrast")}
                    <span id="edit-shapes-label">أشكال</span>
                    <svg class="icon chev" aria-hidden="true"><use href="#icon-chev"></use></svg>
                  </button>
                  <div class="edit-popover-menu" id="edit-shapes-menu" hidden>
                    <button type="button" class="edit-popover-item is-active" data-shape="rect">${icon("icon-ruler")} مستطيل</button>
                    <button type="button" class="edit-popover-item" data-shape="ellipse">${icon("icon-contrast")} دائرة</button>
                    <button type="button" class="edit-popover-item" data-shape="triangle">${icon("icon-alert")} مثلث</button>
                    <button type="button" class="edit-popover-item" data-shape="arrow">${icon("icon-arrow-line")} سهم</button>
                    <button type="button" class="edit-popover-item" data-shape="line">${icon("icon-line")} خط</button>
                    <button type="button" class="edit-popover-item" data-shape="double-arrow">${icon("icon-arrow-line")} سهم مزدوج</button>
                  </div>
                  <!-- Hidden radio inputs for individual shapes so programmatic and test selectors work -->
                  <div style="display:none">
                    <input type="radio" name="edit-tool" value="rect" />
                    <input type="radio" name="edit-tool" value="ellipse" />
                    <input type="radio" name="edit-tool" value="triangle" />
                    <input type="radio" name="edit-tool" value="arrow" />
                    <input type="radio" name="edit-tool" value="line" />
                    <input type="radio" name="edit-tool" value="double-arrow" />
                  </div>
                </div>

                <span class="edit-tool-divider"></span>
                <!-- Media group -->
                ${choice("edit-tool", "stamp", "ختم", "icon-stamp")}
                ${choice("edit-tool", "image", "صورة", "icon-images")}
              </div>
            </div>

            <!-- Left Section: History, Delete, Inspector Toggle, and Save -->
            <div class="edit-topbar__section">
              <button id="edit-undo" type="button" class="edit-tool-btn edit-btn-icon-only" title="تراجع (Ctrl+Z)">${icon("icon-rotate")}</button>
              <button id="edit-redo" type="button" class="edit-tool-btn edit-btn-icon-only" title="إعادة (Ctrl+Y)"><svg class="icon flip" aria-hidden="true"><use href="#icon-rotate"></use></svg></button>
              <button id="edit-delete" type="button" class="edit-tool-btn edit-btn-icon-only" title="حذف المحدد (Delete)">${icon("icon-trash")}</button>
              <button id="edit-inspector-btn" type="button" class="edit-tool-btn edit-btn-icon-only" title="لوحة الخصائص والطبقات (إظهار / إخفاء)"><svg class="icon flip" aria-hidden="true"><use href="#icon-sidebar"></use></svg></button>
              <button id="edit-save" type="button" class="edit-tool-btn edit-btn-primary" title="حفظ المستند">${icon("icon-download")} <span>حفظ</span></button>
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

          <!-- Stage Status Footer with Integrated Zoom -->
          <div class="edit-stage__status edit-stage__hint">
            <div class="edit-stage__status-start">
              <span>💡 اضغط على الصفحة للإضافة · <kbd>Delete</kbd> للحذف · <kbd>Ctrl+Z</kbd> تراجع · <kbd>Ctrl</kbd>+عجلة الفأرة للتكبير</span>
            </div>
            <div class="edit-stage__status-end">
              <!-- Precision Zoom Controls in Footer -->
              <div class="edit-zoom-group edit-stage__zoom">
                <button id="edit-zoom-out" type="button" class="edit-nav-btn" title="تصغير">${icon("icon-compress")}</button>
                <span class="edit-zoom-label num" id="edit-zoom-label">100%</span>
                <button id="edit-zoom-in" type="button" class="edit-nav-btn" title="تكبير">${icon("icon-plus")}</button>
                <button id="edit-zoom-fit" type="button" class="edit-nav-btn" title="ملء الشاشة">${icon("icon-expand")}</button>
              </div>
              <span id="edit-status-info" class="num">جاهز</span>
            </div>
          </div>
        </section>

        <!-- 3. Contextual Inspector Sidebar (Left in RTL) -->
        <aside class="edit-inspector edit-panel" id="edit-inspector" aria-label="لوحة الخصائص">
          <div class="edit-inspector__head">
            <span class="edit-inspector__title">
              <svg class="icon flip" aria-hidden="true"><use href="#icon-sidebar"></use></svg> الخصائص والطبقات
            </span>
            <button id="edit-inspector-toggle" type="button" class="btn btn--compact" title="طي / فتح لوحة الخصائص">
              ${icon("icon-close")}
            </button>
          </div>
          <div class="edit-inspector__scroll">

            <!-- Alignment & Multi-Selection Panel (Visible only when 2+ elements selected) -->
            <div class="panel-block" id="panel-align" hidden>
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
              <h3 class="panel-block__title">خصائص النص</h3>
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
                <label for="edit-text">محتوى النص</label>
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
              <div class="grid-2col" style="margin-top: 6px">
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
              <div class="field" style="margin-top: 6px">
                <label for="edit-hl-opacity">درجة الشفافية</label>
                <input id="edit-hl-opacity" type="range" min="0.1" max="0.8" step="0.05" value="0.35" />
              </div>
            </div>

            <!-- Whiteout Panel -->
            <div class="panel-block" data-edit-panel="whiteout" hidden>
              <h3 class="panel-block__title">تغطية وحجب</h3>
              <p class="panel-block__meta">غطِّ الأخطاء أو البيانات بمستطيل معتم ناصع البياض.</p>
              <div class="grid-2col" style="margin-top: 6px">
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
              <h3 class="panel-block__title">خصائص الشكل</h3>
              <div class="edit-presets" role="group" aria-label="أنماط جاهزة">
                <button type="button" class="edit-preset" data-shape-preset="frame"><i style="background:var(--surface-3);border-color:var(--danger, #E11D48)"></i> إطار</button>
                <button type="button" class="edit-preset" data-shape-preset="highlight"><i style="background:var(--surface-2)"></i> تظليل</button>
                <button type="button" class="edit-preset" data-shape-preset="fill"><i style="background:var(--accent-soft)"></i> تعبئة</button>
                <button type="button" class="edit-preset" data-shape-preset="cover"><i style="background:var(--surface-3)"></i> تغطية</button>
              </div>
              <div class="grid-2col" style="margin-top: 6px">
                <label class="check">
                  <input id="edit-fill-on" type="checkbox" checked />
                  تعبئة
                </label>
                <input id="edit-fill-color" type="color" value="#BFDBFE" />
              </div>
              ${swatches("edit-fill-color", FILL_COLORS)}
              <div class="grid-2col" style="margin-top: 6px">
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
              <div class="field" style="margin-top: 6px">
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
              <p class="panel-block__meta" style="margin-top: 6px">اسحب على الصفحة للرسم أو التوقيع بحرية.</p>
            </div>

            <!-- Arabic Stamps Panel -->
            <div class="panel-block" data-edit-panel="stamp" hidden>
              <h3 class="panel-block__title">الأختام العربية</h3>
              <div class="edit-stamps-grid">
                <button type="button" class="edit-stamp-preset" data-stamp="معتمد" style="color: var(--danger, #E11D48)">معتمد</button>
                <button type="button" class="edit-stamp-preset" data-stamp="سري للغاية" style="color: var(--danger, #E11D48)">سري للغاية</button>
                <button type="button" class="edit-stamp-preset" data-stamp="مسودة" style="color: var(--accent, #4F46E5)">مسودة</button>
                <button type="button" class="edit-stamp-preset" data-stamp="ملغى" style="color: var(--danger, #E11D48)">ملغى</button>
                <button type="button" class="edit-stamp-preset" data-stamp="مدفوع" style="color: var(--success, #059669)">مدفوع</button>
                <button type="button" class="edit-stamp-preset" data-stamp="طبق الأصل" style="color: var(--accent, #4F46E5)">طبق الأصل</button>
              </div>
              <div class="field field--wide" style="margin-top: 6px">
                <label for="edit-stamp-custom">نص ختم مخصص</label>
                <div style="display: flex; gap: 4px; align-items: center">
                  <input id="edit-stamp-custom" type="text" placeholder="اكتب نص الختم..." style="flex: 1" />
                  <button id="edit-stamp-add" type="button" class="btn btn-secondary" style="height: 30px; padding: 0 10px; font-size: 0.75rem">${icon("icon-plus")} إضافة</button>
                </div>
              </div>
            </div>

            <!-- Image Panel -->
            <div class="panel-block" data-edit-panel="image" hidden>
              <h3 class="panel-block__title">الصورة</h3>
              <p class="panel-block__meta" id="edit-image-meta">PNG أو JPG أو WEBP — تُضاف في الوسط ويمكن سحب زواياها وتدويرها.</p>
              <button id="edit-image-browse" type="button" class="btn btn--wide" style="margin-top: 6px">
                ${icon("icon-upload")} اختيار صورة
              </button>
            </div>

            <!-- Layers Stack -->
            <div class="panel-block">
              <h3 class="panel-block__title">
                <span>طبقات الصفحة</span>
                <button id="edit-layers-clear" type="button" class="btn btn--compact" title="حذف كل طبقات الصفحة">${icon("icon-trash")}</button>
              </h3>
              <div id="edit-layers" class="edit-layers" aria-label="قائمة الطبقات"></div>
            </div>

            <!-- Document Actions -->
            <div class="panel-block panel-block--bare" style="margin-top: auto">
              <button id="edit-clear" type="button" class="btn btn--wide">
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

  const inspBtn = root.querySelector("#edit-inspector-btn");
  const inspToggle = root.querySelector("#edit-inspector-toggle");
  const toggleInspector = () => {
    root.querySelector("#edit-workspace")?.classList.toggle("inspector-collapsed");
  };
  if (inspBtn) inspBtn.onclick = toggleInspector;
  if (inspToggle) inspToggle.onclick = toggleInspector;

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
    inspector: root.querySelector("#edit-inspector"),
    inspectorToggle: root.querySelector("#edit-inspector-toggle"),
    inspectorBtn: root.querySelector("#edit-inspector-btn"),
    thumbs: root.querySelector("#edit-thumbs"),
    viewport: root.querySelector("#edit-wrap"),
    wrap: root.querySelector("#edit-wrap"),
    board: root.querySelector("#edit-board"),
    canvas: root.querySelector("#edit-page"),
    layer: root.querySelector("#edit-layer"),
    guides: root.querySelector("#edit-guides"),
    shapesWrap: root.querySelector("#edit-shapes-wrap"),
    shapesBtn: root.querySelector("#edit-shapes-btn"),
    shapesMenu: root.querySelector("#edit-shapes-menu"),
    shapesLabel: root.querySelector("#edit-shapes-label"),
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
    stampAdd: root.querySelector("#edit-stamp-add"),
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
