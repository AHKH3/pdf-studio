import { el } from "../dom.js";
import { isDialogOpen } from "./dialog.js";
import { closeActiveTab, cycleTabs, openTab } from "./tabs.js";

/**
 * Global shortcuts that must work the same in every tool:
 * Ctrl/Cmd+Enter or Ctrl/Cmd+S runs the current operation.
 * Ctrl/Cmd+T opens a new tab, Ctrl/Cmd+W closes the active tab,
 * Ctrl/Cmd+Tab cycles tabs. Escape is handled by the progress
 * overlay and dialogs themselves.
 */
export function initKeys() {
  document.addEventListener("keydown", (event) => {
    if (isDialogOpen()) return;
    const meta = event.ctrlKey || event.metaKey;
    if (!meta) return;
    const key = event.key.toLowerCase();
    // إنشاء تاب آمن دائمًا: لا يمس حالة الأدوات، والتنقل يستقر عند أول فرصة.
    if (key === "t") {
      event.preventDefault();
      void openTab();
      return;
    }
    if (el("progress")?.classList.contains("is-open")) return;
    if (key === "w") {
      event.preventDefault();
      void closeActiveTab();
      return;
    }
    if (key === "tab") {
      event.preventDefault();
      cycleTabs(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Enter" && key !== "s") return;
    const run = /** @type {HTMLButtonElement | null} */ (el("tb-run"));
    if (!run || run.disabled) return;
    event.preventDefault();
    run.click();
  });
}
