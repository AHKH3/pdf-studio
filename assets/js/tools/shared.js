import { LARGE_DOCUMENT_PAGES, LARGE_FILE_BYTES, shouldWarnLargeFile } from "../config.js";
import { yieldToUi } from "../dom.js";
import { friendlyMessage, isCorruptError, isMemoryError } from "../lib/errors.js";
import { readBytes } from "../lib/files.js";
import { pad, parseRanges, rangesToIndexes } from "../lib/ranges.js";
import { resolvePassword } from "../pdf/unlock.js";
import { confirmDiscard, confirmLargeDocument, confirmLargeFile, confirmReplace, showError } from "../ui/dialog.js";
import { isCancellation, toast } from "../ui/feedback.js";
import { setState } from "../ui/titleblock.js";

export { pad, parseRanges, rangesToIndexes, confirmDiscard, confirmReplace };

let counter = 0;
export const uid = (prefix = "id") => `${prefix}-${(counter += 1)}-${Date.now().toString(36)}`;

/**
 * Toast for every failure; modal with retry/home when the caller opts in
 * or the error is severe (corrupt input / out of memory). Never throws.
 * @param {unknown} error @param {string} fallbackMessage
 * @param {{ retry?: () => unknown; showDialog?: boolean; title?: string }} [opts]
 */
export function reportFailure(error, fallbackMessage, opts = {}) {
  if (isCancellation(error)) {
    setState("idle", "أُوقفت");
    toast("تم إيقاف العملية.", "info");
    return;
  }
  console.error(error);
  setState("error");
  const message = friendlyMessage(error, fallbackMessage) || fallbackMessage;
  toast(message, "error");
  const severe = isMemoryError(error) || isCorruptError(error);
  if (typeof opts.retry !== "function" && !opts.showDialog && !severe) return;
  void (async () => {
    try {
      const action = await showError({
        title: opts.title || "تعذّر إتمام العملية",
        desc: message,
        showRetry: typeof opts.retry === "function",
        showHome: true
      });
      if (action === "retry" && typeof opts.retry === "function") {
        await opts.retry();
      } else if (action === "home") {
        const { route } = await import("../ui/router.js");
        await route("start", { skipConfirm: true }).catch(() => {});
      }
    } catch (dialogError) {
      console.error(dialogError);
    }
  })();
}

/** @param {boolean} saved @param {string} message */
export function reportSave(saved, message) {
  if (saved) {
    setState("done");
    toast(message, "done");
  } else {
    setState("idle", "أُلغي الحفظ");
    toast("أُلغي الحفظ.", "info");
  }
}

/**
 * @param {File} file
 * @returns {Promise<{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null>}
 */
export async function readPdfFile(file) {
  // Size gate only: page-count warnings stay at run time (confirmLarge in each
  // run()), otherwise a big document would prompt twice for one operation.
  if (shouldWarnLargeFile(file?.size, 0)) {
    const go = await confirmLargeFile(file.size, LARGE_FILE_BYTES, file.name);
    if (!go) return null;
  }
  const bytes = await readBytes(file);
  const unlocked = await resolvePassword(bytes, file.name);
  if (!unlocked) return null;
  return { name: file.name, bytes, pages: unlocked.pages, size: file.size, password: unlocked.password };
}

/** @param {number} pageCount @param {string} verb */
export function confirmLarge(pageCount, verb) {
  return confirmLargeDocument(pageCount, verb, LARGE_DOCUMENT_PAGES);
}

/**
 * Size gate for inputs known before any byte is read (AHK-63).
 * @param {number} sizeBytes @param {string} [label]
 */
export function confirmHeavyFile(sizeBytes, label = "") {
  return confirmLargeFile(sizeBytes, LARGE_FILE_BYTES, label);
}

/**
 * عنوان التاب: اسم الأداة + أول ملف، أو اسم الأداة وحده بلا ملفات.
 * @param {string} toolName
 * @param {string} [firstName]
 */
export function tabTitle(toolName, firstName) {
  return firstName ? `${toolName} — ${firstName}` : toolName;
}

/**
 * يقرأ قيم مدخلات الإعدادات (value للنص/الرقم/القوائم، checked للاختيار).
 * @param {string[]} ids
 * @returns {Record<string, string | boolean>}
 */
export function readInputValues(ids) {
  const out = {};
  for (const id of ids || []) {
    const node = document.getElementById(id);
    if (!node) continue;
    if (node instanceof HTMLInputElement && node.type === "checkbox") out[id] = node.checked;
    else if ("value" in node) out[id] = /** @type {HTMLInputElement} */ (node).value;
  }
  return out;
}

/**
 * يكتب قيم الإعدادات المحفوظة ويطلق change/input لتلحق الواجهات التابعة (مثل حقول التقسيم).
 * @param {Record<string, string | boolean>} map
 */
export function writeInputValues(map) {
  for (const [id, stored] of Object.entries(map || {})) {
    const node = document.getElementById(id);
    if (!node) continue;
    if (node instanceof HTMLInputElement && node.type === "checkbox" && typeof stored === "boolean") {
      if (node.checked !== stored) {
        node.checked = stored;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if ("value" in node && typeof stored === "string") {
      const input = /** @type {HTMLInputElement} */ (node);
      if (input.value !== stored) {
        input.value = stored;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
}

/**
 * Yield to the UI every `every` steps so long PDF walks stay responsive.
 * @param {number} [index]
 * @param {number} [every]
 */
export function tick(index = 0, every = 1) {
  if (every > 1 && Number(index) % every !== 0) return Promise.resolve();
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return yieldToUi();
}
