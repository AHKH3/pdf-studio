import { createZip } from "./zip.js";

const desktop = /** @type {any} */ (globalThis).pdfStudioDesktop;

export const isDesktop = Boolean(desktop?.isDesktop);

const MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  zip: "application/zip"
};

/** @param {File} file */
export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** @param {File} file */
export function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** @param {File} file */
export function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

/**
 * @param {File[]} files
 * @returns {{ images: File[]; pdfs: File[]; other: File[] }}
 */
export function classifyFiles(files) {
  const images = [];
  const pdfs = [];
  const other = [];
  for (const file of files || []) {
    if (isPdfFile(file)) pdfs.push(file);
    else if (isImageFile(file)) images.push(file);
    else other.push(file);
  }
  return { images, pdfs, other };
}

/** Stable identity for a file list (handoff de-dupe). */
export function filesKey(files) {
  return (files || []).map((file) => `${file.name}:${file.size}:${file.lastModified}`).join("|");
}

/** @param {File} file */
export function imageMime(file) {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

/** @param {string} name */
export function baseName(name) {
  return String(name || "").replace(/\.[^.]+$/, "") || "مستند";
}

/**
 * @param {string} name
 * @param {string} extension without the dot
 */
export function withExtension(name, extension) {
  const trimmed = String(name || "").trim() || "مستند";
  const suffix = `.${extension}`;
  return trimmed.toLowerCase().endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

function browserDownload(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/**
 * Asks the user where to put one file. Returns false when they cancel.
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @param {"pdf"|"png"|"jpeg"|"zip"} kind
 * @returns {Promise<boolean>}
 */
export async function saveFile(bytes, filename, kind) {
  if (desktop?.saveFile) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = await desktop.saveFile({ suggestedName: filename, kind }, buffer);
    return Boolean(result?.saved);
  }
  browserDownload(bytes, filename, MIME[kind] || "application/octet-stream");
  return true;
}

/**
 * Writes many files into a folder the user picks. Falls back to a single ZIP
 * wherever a folder picker is not available.
 * @param {Array<{ name: string; data: Uint8Array }>} files
 * @param {string} folderName
 * @returns {Promise<boolean>}
 */
export async function saveFolder(files, folderName) {
  if (desktop?.saveFolder) {
    const payload = files.map((file) => ({
      name: file.name,
      data: file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength)
    }));
    const result = await desktop.saveFolder({ suggestedName: folderName }, payload);
    return Boolean(result?.saved);
  }
  return saveFile(createZip(files), withExtension(folderName, "zip"), "zip");
}

/**
 * @param {Array<{ name: string; data: Uint8Array }>} files
 * @param {string} zipName
 */
export function saveZip(files, zipName) {
  return saveFile(createZip(files), withExtension(zipName, "zip"), "zip");
}

/** @param {number} bytes */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
