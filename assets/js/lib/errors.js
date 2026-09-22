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

/** Out-of-memory / oversized-buffer failures surface as these messages. */
export function isMemoryError(error) {
  if (!error || typeof error !== "object") return false;
  return /memory|allocation|out of memory|array buffer|maximum call stack/i.test(
    String(error.message || error || "")
  );
}

/** Malformed or truncated PDFs surface as these engine messages. */
export function isCorruptError(error) {
  if (!error || typeof error !== "object") return false;
  return /invalid pdf|not a pdf|format error|xref|trailer|startxref|missing pdf|corrupt|damaged|unexpected eof|bad header/i.test(
    String(error.message || error || "")
  );
}

/** OpenCV.js / scan-pipeline failures (AHK-63: map to Arabic, never crash). */
export function isScanError(error) {
  if (!error || typeof error !== "object") return false;
  return /opencv|\bcv\.|assertion failed|\bmat\b|imread|imwrite|cvtcolor|warpperspective/i.test(
    String((error && error.message) || error || "")
  );
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
  if (/wrong password|incorrect password|bad password/i.test(message)) {
    return "كلمة المرور غير صحيحة. حاول مرة أخرى.";
  }
  if (isCorruptError(error)) {
    return "الملف ليس PDF صالحاً أو أنه تالف.";
  }
  if (isScanError(error)) {
    return "تعذّر تحسين الصورة. جرّب صورة أوضح أو أعد المحاولة.";
  }
  if (isMemoryError(error)) {
    return "المستند أكبر من ذاكرة الجهاز. خفّض الدقة أو عالج قسماً أصغر.";
  }
  return fallback;
}
