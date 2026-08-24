import { el } from "../dom.js";
import { isImageFile, isPdfFile } from "../lib/files.js";
import { toast } from "./feedback.js";

const FILTERS = {
  pdf: isPdfFile,
  image: isImageFile,
  any: (file) => isPdfFile(file) || isImageFile(file)
};
const REJECTION = {
  pdf: "تم تجاهل ملفات ليست PDF.",
  image: "تم تجاهل ملفات ليست صوراً.",
  any: "تم تجاهل ملفات ليست صوراً أو PDF."
};

/**
 * Wires a drop zone, its browse button, and its hidden file input to one handler.
 * @param {object} config
 * @param {string} config.dropId
 * @param {string} config.inputId
 * @param {string} [config.browseId]
 * @param {"pdf" | "image" | "any"} config.accept
 * @param {(files: File[]) => void | Promise<void>} config.onFiles
 */
export function wireIntake(config) {
  const drop = el(config.dropId);
  const input = /** @type {HTMLInputElement | null} */ (el(config.inputId));
  const browse = config.browseId ? el(config.browseId) : null;
  if (!drop || !input) return;

  const accept = FILTERS[config.accept];
  const view = drop.closest(".view");
  if (!drop.getAttribute("aria-label")) {
    const title =
      drop.querySelector(".intake__title") ||
      drop.querySelector(".start__title");
    if (title) drop.setAttribute("aria-label", title.textContent || "");
  }

  const handle = async (fileList) => {
    const all = Array.from(fileList || []);
    const good = all.filter(accept);
    if (good.length < all.length) {
      const skipped = all.length - good.length;
      toast(skipped > 1 ? `${REJECTION[config.accept]} (${skipped})` : REJECTION[config.accept], "info");
    }
    if (!good.length) return;
    await config.onFiles(good);
  };

  const open = () => input.click();
  browse?.addEventListener("click", (event) => {
    event.stopPropagation();
    open();
  });
  drop.addEventListener("click", open);
  drop.addEventListener("keydown", (event) => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      open();
    }
  });
  drop.setAttribute("tabindex", "0");
  drop.setAttribute("role", "button");

  input.addEventListener("change", async () => {
    await handle(input.files);
    input.value = "";
  });

  let depth = 0;
  drop.addEventListener("dragenter", (event) => {
    event.preventDefault();
    depth += 1;
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    /** @type {DragEvent} */ (event).dataTransfer.dropEffect = "copy";
  });
  drop.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    await handle(/** @type {DragEvent} */ (event).dataTransfer?.files);
  });

  document.addEventListener("paste", async (event) => {
    if (view && !view.classList.contains("view--active")) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    await handle(files);
  });
}

/** Adds an extra file input that only opens on demand (insert buttons). */
export function wirePicker(inputId, buttonId, onFiles) {
  const input = /** @type {HTMLInputElement | null} */ (el(inputId));
  const button = el(buttonId);
  if (!input || !button) return;
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (files.length) await onFiles(files);
    input.value = "";
  });
}

/** Stops the window from navigating away when a file is dropped outside a zone. */
export function guardWindowDrops() {
  for (const type of ["dragover", "drop"]) {
    window.addEventListener(type, (event) => {
      if (!/** @type {HTMLElement} */ (event.target).closest(".intake")) event.preventDefault();
    });
  }
}
