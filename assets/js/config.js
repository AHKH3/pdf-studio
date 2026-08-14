/** PDF user-space units are 1/72 inch. */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 }
};

export const MM_TO_PT = 72 / 25.4;

export const PDFJS_WORKER_SRC = new URL("../vendor/pdf.worker.js", import.meta.url).href;

export const THEME_STORAGE_KEY = "pdf-studio-theme";

/** Above this the page grid renders thumbnails lazily and warns before bulk work. */
export const LARGE_DOCUMENT_PAGES = 120;

/** Rendered page thumbnails held in memory at once, per open document. */
export const THUMB_CACHE_LIMIT = 140;

/** Longest edge of a list thumbnail, in device pixels. */
export const THUMB_MAX_PX = 150;

export const COMPRESS_LEVELS = {
  light: { dpi: 150, quality: 0.82 },
  balanced: { dpi: 120, quality: 0.72 },
  strong: { dpi: 96, quality: 0.62 },
  extreme: { dpi: 72, quality: 0.5 }
};
