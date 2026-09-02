import { el } from "../dom.js";
import { isDialogOpen } from "./dialog.js";
import { closeCurrentTab, createTab, nextTab, prevTab, switchToIndex, switchToLast } from "./tabs.js";

/**
 * Global shortcuts:
 * - Ctrl/Cmd+Enter or Ctrl/Cmd+S runs the current operation.
 * - Ctrl/Cmd+T opens a new tab.
 * - Ctrl/Cmd+W closes the active tab.
 * - Ctrl/Cmd+Tab or Ctrl/Cmd+Shift+Tab cycles through tabs.
 * - Ctrl/Cmd+1..8 switches to tab 1..8, Ctrl/Cmd+9 switches to last tab.
 */
export function initKeys() {
  document.addEventListener("keydown", (event) => {
    if (isDialogOpen()) return;
    if (el("progress")?.classList.contains("is-open")) return;
    const meta = event.ctrlKey || event.metaKey;
    if (!meta) return;

    const key = event.key.toLowerCase();

    // New Tab: Ctrl/Cmd + T
    if (key === "t") {
      event.preventDefault();
      void createTab({ activate: true });
      return;
    }

    // Close Tab: Ctrl/Cmd + W
    if (key === "w") {
      event.preventDefault();
      void closeCurrentTab();
      return;
    }

    // Cycle Tabs: Ctrl/Cmd + Tab or Ctrl/Cmd + Shift + Tab
    if (key === "tab") {
      event.preventDefault();
      if (event.shiftKey) {
        void prevTab();
      } else {
        void nextTab();
      }
      return;
    }

    // Direct tab indexing: Ctrl/Cmd + 1..9
    if (/^[1-9]$/.test(key)) {
      event.preventDefault();
      const num = parseInt(key, 10);
      if (num === 9) {
        void switchToLast();
      } else {
        void switchToIndex(num - 1);
      }
      return;
    }

    // Run operation: Ctrl/Cmd + Enter or Ctrl/Cmd + S
    if (event.key === "Enter" || key === "s") {
      const run = /** @type {HTMLButtonElement | null} */ (el("tb-run"));
      if (!run || run.disabled) return;
      event.preventDefault();
      run.click();
    }
  });
}
