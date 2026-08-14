import { LARGE_DOCUMENT_PAGES } from "../config.js";
import { yieldToUi } from "../dom.js";
import { friendlyMessage } from "../lib/errors.js";
import { readBytes } from "../lib/files.js";
import { pad, parseRanges, rangesToIndexes } from "../lib/ranges.js";
import { resolvePassword } from "../pdf/unlock.js";
import { confirmDiscard, confirmLargeDocument, confirmReplace } from "../ui/dialog.js";
import { isCancellation, toast } from "../ui/feedback.js";
import { setState } from "../ui/titleblock.js";

export { pad, parseRanges, rangesToIndexes, confirmDiscard, confirmReplace };

let counter = 0;
export const uid = (prefix = "id") => `${prefix}-${(counter += 1)}-${Date.now().toString(36)}`;

/** @param {unknown} error @param {string} fallbackMessage */
export function reportFailure(error, fallbackMessage) {
  if (isCancellation(error)) {
    setState("idle", "أُوقفت");
    toast("تم إيقاف العملية.", "info");
    return;
  }
  console.error(error);
  setState("error");
  toast(friendlyMessage(error, fallbackMessage) || fallbackMessage, "error");
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
