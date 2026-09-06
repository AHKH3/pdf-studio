import { el } from "../dom.js";
import { confirmDiscard, isDialogOpen } from "./dialog.js";
import { activeTool, getTool, onRouteChange, route, toneFor } from "./router.js";
import { onChromeChange } from "./titleblock.js";

/**
 * شريط التابات — المرحلة 1.
 * التاب يتذكّر الأداة فقط (`toolId`)؛ حالة الأداة singleton مشتركة،
 * فتابان لنفس الأداة يعرضان نفس الملفات حتى عزل الحالة (المرحلة 2).
 * - تاب جديدة (`+` أو Ctrl+T) تفتح دائمًا على الشاشة الرئيسية.
 * - الضغط على أداة ينقّل التاب الحالية إليها (لا يفتح تابًا تلقائيًا).
 * - إغلاق آخر تاب يفتح تاب بداية واحدة.
 */

let seq = 0;
/** @type {Array<{ key: number; toolId: string; title: string }>} */
let tabs = [];
let activeKey = 0;
let lastSnapshot = "";

function glyph(useId) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${useId}`);
  svg.append(use);
  return svg;
}

/** @param {{ key: number; toolId: string; title: string }} tab */
function resolveTitle(tab) {
  const tool = getTool(tab.toolId);
  return tool?.tabTitle?.() ?? tool?.name ?? tab.toolId;
}

function snapshot() {
  return `${activeKey}::${tabs.map((tab) => `${tab.toolId}|${tab.title}`).join(";;")}`;
}

export function renderTabs() {
  const host = el("tab-list");
  if (!host) return;
  for (const tab of tabs) tab.title = resolveTitle(tab);
  const snap = snapshot();
  if (snap === lastSnapshot) return;
  lastSnapshot = snap;

  // الزر + يعيش داخل القائمة نفسها — نلتقطه قبل المسح ثم نعيده بعد آخر تاب.
  const add = el("tab-new");
  host.replaceChildren();
  for (const tab of tabs) {
    const tool = getTool(tab.toolId);
    const selected = tab.key === activeKey;

    const node = document.createElement("div");
    node.className = "tabstrip__tab";
    node.setAttribute("role", "tab");
    node.tabIndex = 0;
    node.dataset.tone = toneFor(tab.toolId);
    node.setAttribute("aria-selected", String(selected));
    node.title = tab.title;
    node.setAttribute("aria-label", `تاب: ${tab.title}`);

    const icon = document.createElement("span");
    icon.className = "tabstrip__icon";
    icon.append(glyph(tool?.icon || "icon-file"));

    const label = document.createElement("span");
    label.className = "tabstrip__label";
    label.textContent = tab.title;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tabstrip__close";
    close.setAttribute("aria-label", `إغلاق تاب ${tab.title}`);
    close.title = "إغلاق (Ctrl+W)";
    close.append(glyph("icon-close"));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void closeTab(tab.key);
    });

    node.append(icon, label, close);
    node.addEventListener("click", () => void activateTab(tab.key));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void activateTab(tab.key);
      }
    });
    // كليك أوسط يغلق التاب
    node.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void closeTab(tab.key);
      }
    });
    host.append(node);
  }
  // زر + يلازم آخر تاب (مثل المتصفحات) بدل أقصى الطرف.
  if (add) host.append(add);
  host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** @param {number} key */
export async function activateTab(key) {
  const tab = tabs.find((item) => item.key === key);
  if (!tab) return;
  if (key === activeKey && tab.toolId === activeTool()?.id) {
    renderTabs();
    return;
  }
  if (tab.toolId === activeTool()?.id) {
    activeKey = key;
    renderTabs();
    return;
  }
  activeKey = key;
  renderTabs();
  const landed = await settleNavigation(key, tab.toolId);
  if (!landed) {
    // تعذّر الوصول للتاب (موجّه مشغول وانتهت المهلة) — التاب النشطة تعكس
    // الواقع الحالي بدل كسر التزامن مع العرض.
    const current = tabs.find((item) => item.key === key);
    if (current && activeKey === key) current.toolId = activeTool()?.id || current.toolId;
  }
  renderTabs();
}

export async function openTab() {
  const tab = { key: (seq += 1), toolId: "start", title: "" };
  tabs.push(tab);
  activeKey = tab.key;
  renderTabs();
  const landed = await settleNavigation(tab.key, "start");
  // تعذّر الوصول للبداية (نادر) — تُبقي التاب على الأداة المعروضة حاليًا بدل حذفها.
  if (!landed && activeKey === tab.key) {
    const current = tabs.find((item) => item.key === tab.key);
    if (current) current.toolId = activeTool()?.id || "start";
  }
  renderTabs();
}

/** @param {number} key */
export async function closeTab(key) {
  const index = tabs.findIndex((item) => item.key === key);
  if (index < 0) return;
  const tab = tabs[index];
  const tool = getTool(tab.toolId);
  if (tool?.isDirty?.()) {
    const ok = await confirmDiscard(tool.name);
    if (!ok) return;
  }
  tabs.splice(index, 1);
  if (!tabs.length) {
    const fresh = { key: (seq += 1), toolId: "start", title: "" };
    tabs.push(fresh);
    activeKey = fresh.key;
    renderTabs();
    const landed = await settleNavigation(fresh.key, "start");
    if (!landed && activeKey === fresh.key) fresh.toolId = activeTool()?.id || "start";
    renderTabs();
    return;
  }
  if (key === activeKey) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    activeKey = next.key;
    renderTabs();
    if (next.toolId !== activeTool()?.id) {
      const landed = await settleNavigation(next.key, next.toolId);
      if (!landed && activeKey === next.key) next.toolId = activeTool()?.id || "start";
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

export function closeActiveTab() {
  return closeTab(activeKey);
}

/** @param {1 | -1} dir */
export function cycleTabs(dir) {
  if (tabs.length < 2) return;
  const index = tabs.findIndex((item) => item.key === activeKey);
  const next = tabs[(index + dir + tabs.length) % tabs.length];
  void activateTab(next.key);
}

/**
 * @param {string} id
 * @param {{ navigation: boolean }} [meta]
 */
function syncFromRoute(id, meta) {
  // التنقّل الحقيقي فقط يتبنّاه التاب النشط؛ إشعارات التحديث (تحميل تدريجي) تُحدّث العناوين فقط.
  if (meta?.navigation !== false) {
    const tab = tabs.find((item) => item.key === activeKey);
    if (tab && tab.toolId !== id) tab.toolId = id;
  }
  renderTabs();
}

function routerBusy() {
  return isDialogOpen() || el("progress")?.classList.contains("is-open");
}

/**
 * ينقّل للتاب المطلوبة؛ إن كان الموجّه مشغولًا (تقدّم/حوار) تُنشأ التاب
 * فورًا ويُستكمل التنقل عند أول فرصة بدل الفشل الصامت.
 * @param {number} wantKey التاب التي طلب المستخدم الوصول لها
 * @param {string} id الأداة المستهدفة
 * @returns {Promise<boolean>} true إن استقر العرض على الأداة المطلوبة
 */
async function settleNavigation(wantKey, id) {
  await route(id, { skipConfirm: true });
  if (activeTool()?.id === id) return true;
  const fromId = activeTool()?.id;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (activeKey !== wantKey || activeTool()?.id !== fromId) return false;
    if (!routerBusy()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (activeKey !== wantKey || activeTool()?.id !== fromId || routerBusy()) return false;
  await route(id, { skipConfirm: true });
  return activeTool()?.id === id;
}

export function initTabs() {
  const current = activeTool()?.id || "start";
  tabs = [{ key: (seq += 1), toolId: current, title: "" }];
  activeKey = tabs[0].key;
  onRouteChange(syncFromRoute);
  // أي تغيّر في شريط الحالة قد يعني ملفات جديدة → حدّث العناوين.
  onChromeChange(() => renderTabs());
  el("tab-new")?.addEventListener("click", () => void openTab());
  renderTabs();
}
