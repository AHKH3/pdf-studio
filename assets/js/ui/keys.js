import { el } from "../dom.js";
import { isDialogOpen } from "./dialog.js";

/**
 * Global shortcuts that must work the same in every tool:
 * Ctrl/Cmd+Enter or Ctrl/Cmd+S runs the current operation.
 * Escape is handled by the progress overlay and dialogs themselves.
 */
export function initKeys() {
  document.addEventListener("keydown", (event) => {
    if (isDialogOpen()) return;
    if (el("progress")?.classList.contains("is-open")) return;
    const meta = event.ctrlKey || event.metaKey;
    if (!meta) return;
    if (event.key !== "Enter" && event.key.toLowerCase() !== "s") return;
    const run = /** @type {HTMLButtonElement | null} */ (el("tb-run"));
    if (!run || run.disabled) return;
    event.preventDefault();
    run.click();
  });
}
