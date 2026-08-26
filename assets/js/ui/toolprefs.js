import { el } from "../dom.js";
import { toast } from "./feedback.js";

/**
 * تفضيلات الأدوات في حاوية hub: ترتيب + تثبيت + إخفاء — محفوظة محلياً.
 * قائمة كليك يمين على أي أداة: تثبيت في الأعلى / إخفاء.
 */

const KEY = "pdfstudio.toolprefs.v1";

/** @type {{ order: string[]; pinned: string[]; hidden: string[] }} */
let prefs = { order: [], pinned: [], hidden: [] };

/** @type {Array<(toolId: string, action: string) => void>} */
const listeners = [];

export function onToolPrefsChange(fn) {
  listeners.push(fn);
}

function emit(toolId, action) {
  for (const fn of listeners) fn(toolId, action);
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      prefs = {
        order: Array.isArray(parsed.order) ? parsed.order : [],
        pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : []
      };
    }
  } catch {
    prefs = { order: [], pinned: [], hidden: [] };
  }
  return prefs;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* التخزين غير متاح — نتجاهل */
  }
}

export function getPrefs() {
  return prefs;
}

export function isPinned(toolId) {
  return prefs.pinned.includes(toolId);
}

export function isHidden(toolId) {
  return prefs.hidden.includes(toolId);
}

export function pinTool(toolId) {
  prefs.hidden = prefs.hidden.filter((id) => id !== toolId);
  if (!prefs.pinned.includes(toolId)) prefs.pinned.push(toolId);
  save();
  emit(toolId, "pin");
}

export function unpinTool(toolId) {
  prefs.pinned = prefs.pinned.filter((id) => id !== toolId);
  save();
  emit(toolId, "unpin");
}

export function hideTool(toolId) {
  prefs.pinned = prefs.pinned.filter((id) => id !== toolId);
  if (!prefs.hidden.includes(toolId)) prefs.hidden.push(toolId);
  save();
  emit(toolId, "hide");
}

export function showTool(toolId) {
  prefs.hidden = prefs.hidden.filter((id) => id !== toolId);
  save();
  emit(toolId, "show");
}

/** يرتب قائمة معرفات الأدوات حسب التفضيل المحفوظ. */
export function sortToolIds(ids) {
  const rank = new Map(prefs.order.map((id, index) => [id, index]));
  return ids.slice().sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

export function recordOrder(ids) {
  // نحفظ الترتيب الكامل: المعروف أولاً ثم الجديد في نهايته
  const known = sortToolIds(ids);
  prefs.order = [...known, ...ids.filter((id) => !known.includes(id))];
  save();
}

/* ------------------------------------------------------------------ *
 * قائمة كليك يمين
 * ------------------------------------------------------------------ */

let menuFor = "";

function menu() {
  return el("tool-ctxmenu");
}

function closeMenu() {
  const node = menu();
  if (node) node.hidden = true;
  menuFor = "";
}

/** Updates the pin item copy. Exported so tests can catch a doubled phrase. */
export function setPinButtonLabel(pinBtn, pinned) {
  const text = pinned ? "إلغاء التثبيت" : "تثبيت في الأعلى";
  // HTML fallback used to be a raw text node; leaving it would double the phrase.
  for (const child of [...pinBtn.childNodes]) {
    if (child.nodeType === 3) child.remove();
  }
  let label = pinBtn.querySelector(".ctxmenu__label");
  if (!label) {
    pinBtn.querySelector("span")?.remove();
    label = document.createElement("span");
    label.className = "ctxmenu__label";
    pinBtn.append(label);
  }
  label.textContent = text;
}

function openMenu(x, y, toolId) {
  const node = menu();
  if (!node) return;
  menuFor = toolId;
  const pinBtn = node.querySelector('[data-ctx="pin"]');
  const hideBtn = node.querySelector('[data-ctx="hide"]');
  if (pinBtn) setPinButtonLabel(pinBtn, isPinned(toolId));
  if (hideBtn) hideBtn.hidden = isHidden(toolId);
  node.hidden = false;
  const rect = node.getBoundingClientRect();
  const px = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const py = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  node.style.left = `${px}px`;
  node.style.top = `${py}px`;
}

export function initToolMenu() {
  loadPrefs();

  document.addEventListener("contextmenu", (event) => {
    const trigger = /** @type {HTMLElement} */ (event.target).closest(".hub-tool");
    if (!(trigger instanceof HTMLElement) || !trigger.dataset.route) return;
    event.preventDefault();
    openMenu(event.clientX, event.clientY, trigger.dataset.route);
  });

  document.addEventListener("click", (event) => {
    const node = menu();
    if (!node || node.hidden) return;
    const item = /** @type {HTMLElement} */ (event.target).closest("[data-ctx]");
    if (item instanceof HTMLElement && menuFor) {
      const action = item.dataset.ctx;
      if (action === "pin") {
        if (isPinned(menuFor)) {
          unpinTool(menuFor);
          toast("أُلغي التثبيت.", "info");
        } else {
          pinTool(menuFor);
          toast("ثُبّتت الأداة في الأعلى.", "done");
        }
      } else if (action === "hide") {
        hideTool(menuFor);
        toast("أُخفيت الأداة — تجدها في قسم «مخفية» بالأسفل.", "info");
      }
    }
    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("scroll", closeMenu, true);
}
