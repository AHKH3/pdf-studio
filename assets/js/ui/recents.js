import { el } from "../dom.js";
import { isImageFile, isPdfFile, humanSize } from "../lib/files.js";
import { probeDocument } from "../pdf/core.js";
import {
  captureFiles,
  hasCapture,
  onCaptureChange,
  setCapture
} from "./capture.js";
import { confirmDiscard } from "./dialog.js";
import { toast } from "./feedback.js";
import { activeTool, getTool, onRouteChange, route } from "./router.js";

/**
 * الملفات الأخيرة — تفتح مباشرة بضغطة واحدة.
 * التخزين IndexedDB محلي فقط (لا سيرفر، لا telemetry): bytes الملف + مصغرة
 * صغيرة + الاسم والحجم وعدد الصفحات وآخر أداة. سقف 8 ملفات و100 م.ب إجمالي
 * مع حذف الأقدم تلقائيًا (LRU)، وملفات +50 م.ب لا تُحفظ أصلًا.
 */

const DB_NAME = "pdf-studio";
const DB_VERSION = 1;
const STORE = "recents";
const MAX_ITEMS = 8;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const THUMB_EDGE = 192;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) {
        reject(new Error("no-indexeddb"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * @param {"readonly" | "readwrite"} mode
 * @param {(store: IDBObjectStore) => IDBRequest} work
 */
async function withStore(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const dbAll = () => withStore("readonly", (store) => store.getAll());
const dbGet = (id) => withStore("readonly", (store) => store.get(id));
const dbPut = (record) => withStore("readwrite", (store) => store.put(record));
const dbDelete = (id) => withStore("readwrite", (store) => store.delete(id));
const dbClear = () => withStore("readwrite", (store) => store.clear());

/** @param {File} file */
function idOf(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** @param {File} file */
function kindOf(file) {
  return isPdfFile(file) ? "pdf" : "image";
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * مصغرة صغيرة dataURL بأفضل جهد — أي فشل يعني «لا مصغرة» لا «لا حفظ».
 * @param {File} file
 * @param {"pdf" | "image"} kind
 */
async function makeThumb(file, kind) {
  /** @type {string[]} */
  const revoke = [];
  try {
    let src = "";
    if (kind === "pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const probe = await probeDocument(bytes);
      src = probe.thumbUrl;
    } else {
      src = URL.createObjectURL(file);
    }
    revoke.push(src);
    const img = await loadImage(src);
    const scale = Math.min(1, THUMB_EDGE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  } finally {
    for (const url of revoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* تجاهل */
      }
    }
  }
}

/** حذف الأقدم عند تجاوز السقفين (عدد + حجم). */
async function evict() {
  const all = await dbAll();
  all.sort((a, b) => b.at - a.at);
  let total = 0;
  for (let index = 0; index < all.length; index += 1) {
    const record = all[index];
    total += record.size || 0;
    if (index >= MAX_ITEMS || total > MAX_TOTAL_BYTES) {
      await dbDelete(record.id);
    }
  }
}

/**
 * @param {File} file
 * @param {string} toolId
 */
async function recordFile(file, toolId) {
  if (file.size > MAX_FILE_BYTES) return; // كبير جدًا — لا نحفظه أصلًا
  const id = idOf(file);
  const kind = kindOf(file);
  const existing = await dbGet(id).catch(() => null);
  if (existing) {
    existing.at = Date.now();
    existing.toolId = toolId;
    await dbPut(existing).catch(() => null);
    return;
  }
  const [bytes, thumb] = await Promise.all([
    file.arrayBuffer().catch(() => null),
    makeThumb(file, kind)
  ]);
  if (!bytes) return;
  let pages = null;
  if (kind === "pdf") {
    try {
      const probe = await probeDocument(new Uint8Array(bytes.slice(0)));
      pages = probe.pages;
    } catch {
      pages = null;
    }
  }
  await dbPut({
    id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type,
    kind,
    bytes,
    thumb,
    pages,
    toolId,
    at: Date.now()
  }).catch(() => null);
  await evict().catch(() => null);
}

/** @param {File[]} files */
function recordMany(files) {
  const toolId = activeTool()?.id ?? "start";
  void (async () => {
    for (const file of files) {
      try {
        await recordFile(file, toolId);
      } catch {
        /* ملف واحد فاشل لا يوقف الباقي */
      }
    }
    render();
  })();
}

/** تحديث آخر أداة للملفات الملتقطة حاليًا (عند التنقل بين الأدوات). */
function touchMany(files, toolId) {
  void (async () => {
    let changed = false;
    for (const file of files) {
      try {
        const record = await dbGet(idOf(file));
        if (record && record.toolId !== toolId) {
          record.toolId = toolId;
          record.at = Date.now();
          await dbPut(record);
          changed = true;
        }
      } catch {
        /* تجاهل */
      }
    }
    if (changed) render();
  })();
}

/** @param {number} at */
function relTime(at) {
  const diff = Date.now() - at;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "الآن";
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    if (n === 1) return "منذ دقيقة";
    if (n === 2) return "منذ دقيقتين";
    if (n <= 10) return `منذ ${n} دقائق`;
    return `منذ ${n} دقيقة`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    if (n === 1) return "منذ ساعة";
    if (n === 2) return "منذ ساعتين";
    if (n <= 10) return `منذ ${n} ساعات`;
    return `منذ ${n} ساعة`;
  }
  if (diff < 7 * day) {
    const n = Math.floor(diff / day);
    if (n === 1) return "منذ يوم";
    if (n === 2) return "منذ يومين";
    if (n <= 10) return `منذ ${n} أيام`;
    return `منذ ${n} يوم`;
  }
  try {
    return new Date(at).toLocaleDateString("ar", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function glyph(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** @param {string} toolId */
function toolName(toolId) {
  if (!toolId || toolId === "start") return "";
  return getTool(toolId)?.name?.replace("→", "←") || "";
}

async function openRecent(id) {
  const record = await dbGet(id).catch(() => null);
  if (!record?.bytes) {
    toast("انتهت نسخة هذا الملف من الأخيرة — أعد فتحه من مكانه.", "info");
    render();
    return;
  }
  if (captureFiles().length) {
    if (!(await confirmDiscard("الملفات الحالية"))) return;
  }
  const file = new File([record.bytes], record.name, {
    type: record.type || (record.kind === "pdf" ? "application/pdf" : "image/png"),
    lastModified: record.lastModified || Date.now()
  });
  setCapture([file]);
  record.at = Date.now();
  await dbPut(record).catch(() => null);
  const target = record.toolId && getTool(record.toolId) ? record.toolId : "start";
  route(target);
  render();
}

async function render() {
  const section = el("home-recents");
  const list = el("home-recents-list");
  if (!section || !list) return;
  let all = [];
  try {
    all = await dbAll();
  } catch {
    section.hidden = true; // لا IndexedDB — القسم يختفي بصمت
    return;
  }
  all.sort((a, b) => b.at - a.at);
  // الشريط لحالة البداية فقط — مع وجود ملفات، قائمة hub الحالية تتولى المهمة
  section.hidden = all.length === 0 || hasCapture();
  if (section.hidden) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren();
  for (const record of all) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "recent-card";
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `فتح ${record.name} مباشرة`);
    card.title = record.name;

    const thumb = document.createElement("span");
    thumb.className = "recent-card__thumb";
    if (record.thumb) {
      const img = document.createElement("img");
      img.src = record.thumb;
      img.alt = "";
      img.loading = "lazy";
      thumb.append(img);
    } else {
      thumb.append(glyph(record.kind === "pdf" ? "icon-file" : "icon-images"));
      thumb.classList.add("is-icon");
    }

    const body = document.createElement("span");
    body.className = "recent-card__body";
    const name = document.createElement("span");
    name.className = "recent-card__name";
    name.textContent = record.name;
    const meta = document.createElement("span");
    meta.className = "recent-card__meta";
    const parts = [record.kind === "pdf" ? "PDF" : "صورة"];
    if (record.kind === "pdf" && record.pages) parts.push(`${record.pages} صفحة`);
    const size = document.createElement("span");
    size.className = "num";
    size.textContent = humanSize(record.size);
    meta.append(parts.join(" • "), " • ", size, " • ", relTime(record.at));
    body.append(name, meta);

    const tool = toolName(record.toolId);
    if (tool) {
      const chip = document.createElement("span");
      chip.className = "recent-card__tool";
      chip.textContent = `آخر أداة: ${tool}`;
      body.append(chip);
    }

    card.append(thumb, body);
    card.addEventListener("click", () => void openRecent(record.id));
    list.append(card);
  }
}

/** نتتبع آخر حقيبة لنُسجّل الملفات المضافة فقط (لا الترتيب/الحذف). */
/** @type {Set<string>} */
let lastIds = new Set();

function onBag() {
  const files = captureFiles().filter((file) => isPdfFile(file) || isImageFile(file));
  const ids = new Set(files.map(idOf));
  const added = files.filter((file) => !lastIds.has(idOf(file)));
  lastIds = ids;
  if (added.length) recordMany(added);
}

export function initRecents() {
  el("home-recents-clear")?.addEventListener("click", async () => {
    try {
      await dbClear();
    } catch {
      /* تجاهل */
    }
    lastIds = new Set();
    toast("مُسحت الملفات الأخيرة.", "info");
    render();
  });
  onCaptureChange(onBag);
  onCaptureChange(() => {
    if (!hasCapture()) render(); // تفريغ الحقيبة يعيد الشريط إن وُجدت عناصر
  });
  onRouteChange((id) => {
    if (id === "start") return;
    const files = captureFiles().filter((file) => isPdfFile(file) || isImageFile(file));
    if (files.length) touchMany(files, id);
  });
  render();
}
