/** Maps engine exceptions to short Arabic copy. Pure: no DOM. */

export function isPasswordError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.name === "PasswordException") return true;
  return /password/i.test(String(error.message || ""));
}

export function isEncryptedError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.name === "EncryptedPdfError") return true;
  return /is encrypted/i.test(String(error.message || ""));
}

export function encryptedError() {
  const error = new Error("encrypted");
  error.name = "EncryptedPdfError";
  return error;
}

/**
 * @param {unknown} error
 * @param {string} fallback
 * @returns {string | null} null when the caller should stay silent
 */
export function friendlyMessage(error, fallback) {
  if (!error) return fallback;
  if (error instanceof Error && error.name === "CancelledError") return null;
  if (isPasswordError(error)) {
    return "هذا الملف محمي بكلمة مرور. أدخل الكلمة الصحيحة أو اختر ملفاً آخر.";
  }
  if (isEncryptedError(error)) {
    return "الملف مشفّر ولا يمكن تعديل صفحاته الأصلية. حوّله إلى صور أو اضغطه لإعادة رسم الصفحات.";
  }
  const message = String((error && error.message) || error);
  if (/invalid pdf|not a pdf|format error|xref|missing pdf/i.test(message)) {
    return "الملف ليس PDF صالحاً أو أنه تالف.";
  }
  if (/memory|allocation|out of memory/i.test(message)) {
    return "المستند أكبر من ذاكرة الجهاز. خفّض الدقة أو عالج قسماً أصغر.";
  }
  return fallback;
}
