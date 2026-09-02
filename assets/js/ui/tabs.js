import { el } from "../dom.js";
import { captureFiles, clearCapture, setCapture } from "./capture.js";
import { confirmDiscard, confirmLeave } from "./dialog.js";
import { toast } from "./feedback.js";

/**
 * @typedef {object} TabItem
 * @property {string} id
 * @property {string} title
 * @property {string} icon
 * @property {string} route
 * @property {File[]} captureFiles
 * @property {Record<string, any>} toolData
 * @property {boolean} isDirty
 * @property {boolean} isBusy
 * @property {number} progress
 * @property {string} [taskTitle]
 * @property {string} [outputName]
 */

/** @type {TabItem[]} */
let tabs = [];
let activeTabId = "";
let tabSeq = 0;
let routerNavigate = null;

// Concurrency Queue Configuration
const MAX_CONCURRENT_TASKS = 2;
let activeRunningTasks = 0;
/** @type {Array<{ tabId: string; taskFn: () => Promise<any>; resolve: (v: any) => void; reject: (e: any) => void }>} */
const taskQueue = [];

function uid() {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

function svgIcon(iconId, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${iconId}`);
  svg.append(use);
  return svg;
}

/**
 * Get Tab by ID.
 * @param {string} id
 */
export function getTab(id) {
  return tabs.find((t) => t.id === id) || null;
}

/**
 * Get current active tab.
 */
export function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

/**
 * Get all tabs.
 */
export function getAllTabs() {
  return tabs.slice();
}

/**
 * Set the router bridge navigation function.
 * @param {(routeId: string) => Promise<void>} fn
 */
export function setRouterBridge(fn) {
  routerNavigate = fn;
}

/**
 * Create DOM element for a tab.
 * @param {TabItem} tab
 */
function renderTabElement(tab) {
  const tabEl = document.createElement("div");
  tabEl.className = "tab-item" + (tab.id === activeTabId ? " tab-item--active" : "");
  tabEl.id = `tab-el-${tab.id}`;
  tabEl.dataset.tabId = tab.id;
  tabEl.setAttribute("role", "tab");
  tabEl.setAttribute("aria-selected", String(tab.id === activeTabId));
  tabEl.setAttribute("tabindex", tab.id === activeTabId ? "0" : "-1");
  tabEl.draggable = true;

  // Icon wrap (holds icon + spinner)
  const iconWrap = document.createElement("span");
  iconWrap.className = "tab-item__icon-wrap";
  iconWrap.setAttribute("aria-hidden", "true");

  const iconEl = svgIcon(tab.icon || "icon-app", "icon tab-item__icon");
  iconWrap.append(iconEl);

  const spinner = document.createElement("span");
  spinner.className = "tab-item__spinner";
  spinner.hidden = !tab.isBusy;
  iconWrap.append(spinner);

  tabEl.append(iconWrap);

  // Title
  const titleEl = document.createElement("span");
  titleEl.className = "tab-item__title";
  titleEl.textContent = tab.title || "الرئيسية";
  tabEl.append(titleEl);

  // Status/Progress Badge
  const badgeEl = document.createElement("span");
  badgeEl.className = "tab-item__badge";
  if (tab.isBusy) {
    badgeEl.textContent = tab.progress > 0 ? `${Math.round(tab.progress)}%` : "جاري...";
    badgeEl.hidden = false;
  } else {
    badgeEl.hidden = true;
  }
  tabEl.append(badgeEl);

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tab-item__close";
  closeBtn.setAttribute("aria-label", `إغلاق تابة ${tab.title}`);
  closeBtn.title = "إغلاق التابة (Ctrl+W)";
  closeBtn.append(svgIcon("icon-close", "icon"));

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void closeTab(tab.id);
  });

  tabEl.append(closeBtn);

  // Tab activation click
  tabEl.addEventListener("click", () => {
    if (tab.id !== activeTabId) {
      void switchTab(tab.id);
    }
  });

  // Middle click (wheel click) closes tab
  tabEl.addEventListener("auxclick", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      void closeTab(tab.id);
    }
  });

  // Drag and drop reordering
  setupTabDrag(tabEl, tab);

  return tabEl;
}

/**
 * Setup drag and drop for tab reordering.
 * @param {HTMLElement} tabEl
 * @param {TabItem} tab
 */
function setupTabDrag(tabEl, tab) {
  tabEl.addEventListener("dragstart", (e) => {
    e.dataTransfer?.setData("text/plain", tab.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    tabEl.classList.add("is-dragging");
  });

  tabEl.addEventListener("dragend", () => {
    tabEl.classList.remove("is-dragging");
    for (const el of document.querySelectorAll(".tab-item")) {
      el.classList.remove("is-dragover-before", "is-dragover-after");
    }
  });

  tabEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = tabEl.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl";
    const midX = rect.left + rect.width / 2;
    const isBefore = isRtl ? e.clientX > midX : e.clientX < midX;

    tabEl.classList.toggle("is-dragover-before", isBefore);
    tabEl.classList.toggle("is-dragover-after", !isBefore);
  });

  tabEl.addEventListener("dragleave", () => {
    tabEl.classList.remove("is-dragover-before", "is-dragover-after");
  });

  tabEl.addEventListener("drop", (e) => {
    e.preventDefault();
    tabEl.classList.remove("is-dragover-before", "is-dragover-after");
    const sourceId = e.dataTransfer?.getData("text/plain");
    if (!sourceId || sourceId === tab.id) return;

    const sourceIndex = tabs.findIndex((t) => t.id === sourceId);
    let targetIndex = tabs.findIndex((t) => t.id === tab.id);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const rect = tabEl.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl";
    const midX = rect.left + rect.width / 2;
    const isBefore = isRtl ? e.clientX > midX : e.clientX < midX;

    const [removed] = tabs.splice(sourceIndex, 1);
    const newTargetIndex = tabs.findIndex((t) => t.id === tab.id);
    const insertIndex = isBefore ? newTargetIndex : newTargetIndex + 1;
    tabs.splice(insertIndex, 0, removed);

    renderTabsList();
  });
}

/**
 * Re-render the entire tabs strip list DOM.
 */
export function renderTabsList() {
  const host = el("tabs-list");
  if (!host) return;

  host.replaceChildren();
  for (const tab of tabs) {
    host.append(renderTabElement(tab));
  }

  // Ensure active tab is scrolled into view smoothly
  const activeEl = document.getElementById(`tab-el-${activeTabId}`);
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
}

/**
 * Update a specific tab element without full re-render.
 * @param {string} tabId
 */
export function updateTabElement(tabId) {
  const tab = getTab(tabId);
  if (!tab) return;
  const tabEl = document.getElementById(`tab-el-${tabId}`);
  if (!tabEl) {
    renderTabsList();
    return;
  }

  // Update active class & attributes
  const isActive = tab.id === activeTabId;
  tabEl.classList.toggle("tab-item--active", isActive);
  tabEl.setAttribute("aria-selected", String(isActive));
  tabEl.setAttribute("tabindex", isActive ? "0" : "-1");

  // Update icon
  const iconWrap = tabEl.querySelector(".tab-item__icon-wrap");
  if (iconWrap) {
    const iconEl = iconWrap.querySelector(".tab-item__icon");
    if (iconEl) {
      const use = iconEl.querySelector("use");
      if (use) use.setAttribute("href", `#${tab.icon || "icon-app"}`);
    }
    const spinner = iconWrap.querySelector(".tab-item__spinner");
    if (spinner instanceof HTMLElement) {
      spinner.hidden = !tab.isBusy;
    }
  }

  // Update title
  const titleEl = tabEl.querySelector(".tab-item__title");
  if (titleEl) {
    titleEl.textContent = tab.title || "الرئيسية";
  }

  // Update badge
  const badgeEl = tabEl.querySelector(".tab-item__badge");
  if (badgeEl instanceof HTMLElement) {
    if (tab.isBusy) {
      badgeEl.textContent = tab.progress > 0 ? `${Math.round(tab.progress)}%` : "جاري...";
      badgeEl.hidden = false;
      badgeEl.classList.remove("tab-item__badge--done");
    } else if (tab.progress === 100) {
      badgeEl.textContent = "تم";
      badgeEl.hidden = false;
      badgeEl.classList.add("tab-item__badge--done");
    } else {
      badgeEl.hidden = true;
    }
  }
}

/**
 * Create a new tab.
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.icon]
 * @param {string} [options.route]
 * @param {File[]} [options.files]
 * @param {boolean} [options.activate]
 */
export async function createTab(options = {}) {
  const newId = uid();
  /** @type {TabItem} */
  const tab = {
    id: newId,
    title: options.title || "الرئيسية",
    icon: options.icon || "icon-app",
    route: options.route || "start",
    captureFiles: options.files ? Array.from(options.files) : [],
    toolData: {},
    isDirty: false,
    isBusy: false,
    progress: 0
  };

  tabs.push(tab);

  if (options.activate !== false) {
    await switchTab(newId, { isNew: true });
  } else {
    renderTabsList();
  }

  return tab;
}

/**
 * Snapshot current active tab state before switching.
 */
function snapshotActiveTab() {
  const current = getActiveTab();
  if (!current) return;

  current.captureFiles = captureFiles();
}

/**
 * Switch active tab.
 * @param {string} tabId
 * @param {object} [options]
 * @param {boolean} [options.isNew]
 */
export async function switchTab(tabId, options = {}) {
  const target = getTab(tabId);
  if (!target) return;

  if (activeTabId && activeTabId !== tabId && !options.isNew) {
    snapshotActiveTab();
  }

  activeTabId = tabId;
  renderTabsList();

  // Restore capture files
  setCapture(target.captureFiles);

  // Restore route
  const targetRoute = target.route || "start";
  if (routerNavigate) {
    await routerNavigate(targetRoute);
  }

  updateTabElement(tabId);
}

/**
 * Close a tab.
 * @param {string} tabId
 */
export async function closeTab(tabId) {
  const targetIndex = tabs.findIndex((t) => t.id === tabId);
  if (targetIndex === -1) return;

  const target = tabs[targetIndex];

  // Check if tab is busy running a task
  if (target.isBusy) {
    const ok = await confirmLeave(`التابة "${target.title}" تعمل حالياً على معالجة ملفات.`);
    if (!ok) return;
  } else if (target.isDirty) {
    const ok = await confirmDiscard(target.title);
    if (!ok) return;
  }

  // Remove tab
  tabs.splice(targetIndex, 1);

  // If closing active tab, switch to adjacent or create new
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const nextIndex = Math.min(targetIndex, tabs.length - 1);
      await switchTab(tabs[nextIndex].id);
    } else {
      // Last tab closed -> automatically open a fresh "الرئيسية" tab
      await createTab({ activate: true });
    }
  } else {
    renderTabsList();
  }
}

/**
 * Close the current active tab.
 */
export async function closeCurrentTab() {
  if (activeTabId) {
    await closeTab(activeTabId);
  }
}

/**
 * Cycle to the next tab.
 */
export async function nextTab() {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  const nextIndex = (currentIndex + 1) % tabs.length;
  await switchTab(tabs[nextIndex].id);
}

/**
 * Cycle to the previous tab.
 */
export async function prevTab() {
  if (tabs.length <= 1) return;
  const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
  const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  await switchTab(tabs[prevIndex].id);
}

/**
 * Switch directly to tab at given 0-based index.
 * @param {number} index
 */
export async function switchToIndex(index) {
  if (index >= 0 && index < tabs.length) {
    await switchTab(tabs[index].id);
  }
}

/**
 * Switch to the last tab.
 */
export async function switchToLast() {
  if (tabs.length > 0) {
    await switchTab(tabs[tabs.length - 1].id);
  }
}

/**
 * Dynamically update metadata for the active tab (called by router / tools).
 * @param {object} meta
 * @param {string} [meta.title]
 * @param {string} [meta.icon]
 * @param {string} [meta.route]
 * @param {boolean} [meta.isDirty]
 * @param {string} [meta.outputName]
 */
export function updateActiveTabMeta(meta = {}) {
  const current = getActiveTab();
  if (!current) return;

  let changed = false;
  if (meta.title && current.title !== meta.title) {
    current.title = meta.title;
    changed = true;
  }
  if (meta.icon && current.icon !== meta.icon) {
    current.icon = meta.icon;
    changed = true;
  }
  if (meta.route && current.route !== meta.route) {
    current.route = meta.route;
    changed = true;
  }
  if (typeof meta.isDirty === "boolean" && current.isDirty !== meta.isDirty) {
    current.isDirty = meta.isDirty;
    changed = true;
  }
  if (meta.outputName !== undefined) {
    current.outputName = meta.outputName;
  }

  if (changed) {
    updateTabElement(current.id);
  }
}

// ---------------------------------------------------------------------------
// Concurrency Task Queue (Max 1-2 concurrent background tasks)
// ---------------------------------------------------------------------------

function pumpTaskQueue() {
  while (activeRunningTasks < MAX_CONCURRENT_TASKS && taskQueue.length > 0) {
    const next = taskQueue.shift();
    if (!next) break;

    const tab = getTab(next.tabId);
    if (!tab) {
      next.reject(new Error("Tab closed"));
      continue;
    }

    activeRunningTasks += 1;
    tab.isBusy = true;
    tab.progress = 0;
    updateTabElement(tab.id);

    next.taskFn()
      .then((res) => {
        tab.isBusy = false;
        tab.progress = 100;
        updateTabElement(tab.id);
        setTimeout(() => {
          if (!tab.isBusy && tab.progress === 100) {
            tab.progress = 0;
            updateTabElement(tab.id);
          }
        }, 2500);
        next.resolve(res);
      })
      .catch((err) => {
        tab.isBusy = false;
        tab.progress = 0;
        updateTabElement(tab.id);
        next.reject(err);
      })
      .finally(() => {
        activeRunningTasks -= 1;
        pumpTaskQueue();
      });
  }
}

/**
 * Enqueue a heavy operation on a specific tab with bounded concurrency.
 * @param {string} tabId
 * @param {() => Promise<any>} taskFn
 */
export function enqueueTabTask(tabId, taskFn) {
  return new Promise((resolve, reject) => {
    const tab = getTab(tabId);
    if (tab) {
      tab.isBusy = true;
      updateTabElement(tab.id);
    }
    taskQueue.push({ tabId, taskFn, resolve, reject });
    pumpTaskQueue();
  });
}

/**
 * Update task progress on a tab.
 * @param {string} tabId
 * @param {number} percent
 * @param {string} [detail]
 */
export function updateTabProgress(tabId, percent, detail = "") {
  const tab = getTab(tabId);
  if (!tab) return;
  tab.progress = percent;
  updateTabElement(tabId);
}

/**
 * Check if any tab has unsaved changes.
 */
export function hasAnyUnsavedWork() {
  return tabs.some((t) => t.isDirty);
}

/**
 * Initialize the tabs bar system.
 */
export function initTabs() {
  const addBtn = el("tab-add");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      void createTab({ activate: true });
    });
  }

  // Create initial first tab ("الرئيسية")
  if (tabs.length === 0) {
    void createTab({ title: "الرئيسية", icon: "icon-app", route: "start", activate: true });
  }
}
