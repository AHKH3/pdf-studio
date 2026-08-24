import { isHeicFile } from "./files.js";

/**
 * يحول ملف HEIC/HEIF إلى JPEG قابل للاستخدام في المتصفح.
 * يستخدم heic2any إن توفر عبر vendor، وإلا يحاول فكًا محليًا بسيطًا.
 * @param {File} file
 * @returns {Promise<File>} ملف JPEG جديد (أو نفس الملف إن لم يكن HEIC)
 */
export async function ensureDecodableImage(file) {
  if (!isHeicFile(file)) return file;

  // حاول استخدام heic2any المحلي (إن وُجد)
  try {
    const heic2any = await loadHeic2Any();
    if (heic2any) {
      const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      const outBlob = Array.isArray(blob) ? blob[0] : blob;
      const name = file.name.replace(/\.(heic|heif)$/i, ".jpg");
      return new File([outBlob], name, { type: "image/jpeg", lastModified: file.lastModified });
    }
  } catch (error) {
    console.warn("HEIC decode via heic2any failed:", error);
  }

  // محاولة أخيرة: هل المتصفح يدعم HEIC أصلاً (نادر)؟
  try {
    const url = URL.createObjectURL(file);
    const ok = await canDecodeViaImage(url);
    URL.revokeObjectURL(url);
    if (ok) return file;
  } catch {
    /* ignore */
  }

  throw new Error(
    "صورة HEIC/HEIF من الآيفون — المتصفح لا يفكّها مباشرة. حوّلها إلى JPG أولاً (افتحها في الصور ثم احفظ كـ JPG) أو ثبّت heic2any محليًا."
  );
}

/**
 * يحوّل قائمة ملفات، ويُبقي غير-HEIC كما هي. يرمي أول خطأ HEIC غير قابل للفك.
 * @param {File[]} files
 * @returns {Promise<File[]>}
 */
export async function ensureDecodableImages(files) {
  const out = [];
  for (const file of files || []) {
    out.push(await ensureDecodableImage(file));
  }
  return out;
}

async function loadHeic2Any() {
  // vendor/heic2any.min.js يصدّر globalThis.heic2any أو ESM
  if (globalThis.heic2any) return globalThis.heic2any;
  try {
    const mod = await import("../../vendor/heic2any.js");
    return mod.default || mod.heic2any || globalThis.heic2any || null;
  } catch {
    return null;
  }
}

function canDecodeViaImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    // مهلة 2 ثانية
    setTimeout(() => resolve(false), 2000);
  });
}
