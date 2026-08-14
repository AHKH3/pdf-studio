import { isPasswordError } from "../lib/errors.js";
import { promptPassword } from "../ui/dialog.js";
import { openDocument } from "./core.js";

/**
 * Opens with pdf.js (which can decrypt) and returns the password to reuse.
 * @param {Uint8Array} bytes
 * @param {string} [fileName]
 * @param {string} [known]
 * @returns {Promise<{ password: string; pages: number } | null>}
 */
export async function resolvePassword(bytes, fileName = "", known = "") {
  let password = known;
  let retry = false;
  for (;;) {
    try {
      const doc = await openDocument(bytes, password);
      const pages = doc.numPages;
      await doc.destroy();
      return { password: password || "", pages };
    } catch (error) {
      if (!isPasswordError(error)) throw error;
      const next = await promptPassword({ retry, fileName });
      if (next == null) return null;
      password = next;
      retry = true;
    }
  }
}
