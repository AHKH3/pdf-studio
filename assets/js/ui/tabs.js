import { el } from "../dom.js";
import { confirmDiscard, isDialogOpen } from "./dialog.js";
import { activeTool, getTool, navEpoch, onRouteChange, onRouteLeaving, route, toneFor } from "./router.js";
import { getName, onChromeChange, setName } from "./titleblock.js";

/**
 * شريط التابات — عزل كامل لكل تاب (المرحلة 2).
 * كل تاب تحمل مخزن لقطات `stores` (أداة → {state, name})؛ عند مغادرة أداة
 * تُلتقط حالتها، وعند العودة تُستعاد (أو تُفرَّغ لتاب جديدة). تسليم ملفات
 * الـ hub يُتخطّى للتاب العائدة حتى لا يلوّث عملها المحفوظ.
 */

let seq = 0;
/** @type {Array<{ key: number; toolId: string; title: string; dirty: boolean; stores: Map<string, { state: any; name: string }> }>} */
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

/** @param {{ key: number; toolId: string; title: string; dirty: boolean; stores: Map<string, any> }} tab */
function resolveTitle(tab) {
  const tool = getTool(tab.toolId);
  return tool?.tabTitle?.() ?? tool?.name ?? tab.toolId;
}

function snapshot() {
  return `${activeKey}::${tabs.map((tab) => `${tab.toolId}|${tab.title}|${tab.dirty ? 1 : 0}`).join(";;")}`;
}

/** هل التاب تحمل عملًا محفوظًا لهذه الأداة (لتخطي تسليم ملفات الـ hub)؟ */
function storedStateFor(tab, toolId) {
  const env = tab?.stores.get(toolId);
  return env && env.state != null ? env : null;
}

/** يلتقط عمل أداة في تابها (مراجع + اسم المخرج) ويجمّد dirty. */
function captureInto(tab, tool) {
  if (!tab || !tool) return;
  if (typeof tool.captureState === "function" && typeof tool.restoreState === "function") {
    tab.stores.set(tool.id, { state: tool.captureState(), name: getName() });
  }
  if (tab.key === activeKey) syncActiveDirty();
}

/** يحدّث dirty للتاب النشطة من الأداة المعروضة حاليًا. */
function syncActiveDirty() {
  const tab = tabs.find((item) => item.key === activeKey);
  const tool = activeTool();
  if (!tab || !tool) return;
  tab.dirty = tool.isDirty?.() ?? tool.captureState?.() != null;
}

/**
 * يستعيد عمل التاب للأداة المستهدفة (أو يفرّغها لتاب جديدة) + اسم المخرج.
 * @param {{ key: number; toolId: string; title: string; dirty: boolean; stores: Map<string, any> }} tab
 */
async function restoreInto(tab) {
  const tool = getTool(tab.toolId);
  if (!tool) return;
  const env = storedStateFor(tab, tool.id);
  if (env) {
    await tool.restoreState?.(env.state);
    if (env.name) setName(env.name);
  } else if (typeof tool.restoreState === "function") {
    await tool.restoreState(null);
  }
  syncActiveDirty();
  renderTabs();
}

export function renderTabs() {
  const host = el("tab-list");
  if (!host) return;
  syncActiveDirty();
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
  // الالتقاط الصريح أولًا — قبل تبديل activeKey حتى لا يلتقط خطاف المغادرة في التاب الخطأ.
  const outgoing = tabs.find((item) => item.key === activeKey);
  captureInto(outgoing, activeTool());
  if (tab.toolId === activeTool()?.id) {
    // نفس الأداة في تاب أخرى: استعد عمل هذه التاب (أو فرّغها) بلا تنقّل.
    activeKey = key;
    await restoreInto(tab);
    return;
  }
  activeKey = key;
  renderTabs();
  const skipFiles = storedStateFor(tab, tab.toolId) != null;
  const landed = await settleNavigation(key, tab.toolId, skipFiles);
  const live = tabs.find((item) => item.key === key);
  if (live && activeKey === key) {
    if (landed) await restoreInto(live);
    else adoptReality(live);
    return;
  }
  renderTabs();
}

export async function openTab() {
  // التقاط عمل التاب الحالية قبل إنشاء الجديدة (خطاف المغادرة سيتجاوز لاحقًا لاختلاف الأداة).
  const outgoing = tabs.find((item) => item.key === activeKey);
  captureInto(outgoing, activeTool());
  const tab = { key: (seq += 1), toolId: "start", title: "", dirty: false, stores: new Map() };
  tabs.push(tab);
  activeKey = tab.key;
  renderTabs();
  const landed = await settleNavigation(tab.key, "start", false);
  const live = tabs.find((item) => item.key === tab.key);
  if (live && activeKey === tab.key) {
    // التاب الجديدة تبدأ فارغة عند الوصول (restore null يفرّغ بقايا التاب السابقة)؛
    // وعند التعذّر تعتمد الواقع الحالي وتمتلكه.
    if (landed) await restoreInto(live);
    else adoptReality(live);
    return;
  }
  renderTabs();
}

/** @param {number} key */
export async function closeTab(key) {
  const index = tabs.findIndex((item) => item.key === key);
  if (index < 0) return;
  const tab = tabs[index];
  const tool = getTool(tab.toolId);
  // التحذير من dirty التاب نفسها (مجمّد عند آخر نشاط)، لا من حالة الأداة الحية.
  if (tab.dirty) {
    const ok = await confirmDiscard(tool?.name ?? tab.title);
    if (!ok) return;
  }
  tabs.splice(index, 1);
  // أثناء إغلاق تاب نشطة: خطاف المغادرة لا يلتقط العمل المحذوف في تاب الجار.
  closingKey = key;
  try {
    if (!tabs.length) {
      const fresh = { key: (seq += 1), toolId: "start", title: "", dirty: false, stores: new Map() };
      tabs.push(fresh);
      activeKey = fresh.key;
      renderTabs();
      const landed = await settleNavigation(fresh.key, "start", false);
      const live = tabs.find((item) => item.key === fresh.key);
      if (live && activeKey === fresh.key) {
        // الإغلاق قرار حذف: نستعيد عمل التاب الجديدة (أو نفرّغ) ولا نلتقط بقايا المحذوف.
        if (!landed) live.toolId = activeTool()?.id || "start";
        await restoreInto(live);
        return;
      }
      renderTabs();
      return;
    }
    if (key === activeKey) {
      const next = tabs[Math.min(index, tabs.length - 1)];
      activeKey = next.key;
      renderTabs();
      if (next.toolId !== activeTool()?.id) {
        const skipFiles = storedStateFor(next, next.toolId) != null;
        const landed = await settleNavigation(next.key, next.toolId, skipFiles);
        const live = tabs.find((item) => item.key === next.key);
        if (live && activeKey === next.key) {
          if (!landed) live.toolId = activeTool()?.id || live.toolId;
          await restoreInto(live);
          return;
        }
      }
      renderTabs();
    } else {
      renderTabs();
    }
  } finally {
    if (closingKey === key) closingKey = null;
  }
}

/** مفتاح تاب قيد الإغلاق — خطاف المغادرة يتجاوزه حتى لا يُحيي عملًا محذوفًا في تاب الجار. */
/** @type {number | null} */
let closingKey = null;

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
function syncFromRoute() {
  // التبنّي يتم ذريًا في onRouteLeaving؛ هنا تحديث عناوين فقط.
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
 * @param {boolean} [skipFiles] تخطي تسليم ملفات الـ hub (التاب العائدة لعمل محفوظ)
 * @returns {Promise<boolean>} true إن استقر العرض على الأداة المطلوبة
 */
async function settleNavigation(wantKey, id, skipFiles = false) {
  const epoch0 = navEpoch();
  await route(id, { skipConfirm: true, skipDeliver: skipFiles });
  if (activeTool()?.id === id) return true;
  const fromId = activeTool()?.id;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    // تنقّل أحدث من جهة أخرى يُلغي هذه النية المتقادمة فورًا.
    if (activeKey !== wantKey || activeTool()?.id !== fromId || navEpoch() !== epoch0) return false;
    if (!routerBusy()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (activeKey !== wantKey || activeTool()?.id !== fromId || navEpoch() !== epoch0 || routerBusy()) return false;
  await route(id, { skipConfirm: true, skipDeliver: skipFiles });
  return activeTool()?.id === id;
}

/**
 * عند تعذّر/إلغاء التنقل: التاب تعتمد الواقع الحالي وتمتلكه (التقاط الحي)
 * بدل تدميره باستعادة قديمة — ما يُرى هو ما تحفظه التاب.
 * @param {{ key: number; toolId: string; title: string; dirty: boolean; stores: Map<string, any> }} tab
 */
function adoptReality(tab) {
  tab.toolId = activeTool()?.id || tab.toolId;
  captureInto(tab, getTool(tab.toolId), "adopt");
  renderTabs();
}

export function hasDirtyTabs() {
  return tabs.some((tab) => tab.dirty);
}

export function initTabs() {
  const current = activeTool()?.id || "start";
  tabs = [{ key: (seq += 1), toolId: current, title: "", dirty: false, stores: new Map() }];
  activeKey = tabs[0].key;
  onRouteChange(syncFromRoute);
  // أي تنقّل حقيقي يلتقط عمل التاب المغادَرة ويتبنّى الوجهة ذريًا (قبل أي فجوة آجلة).
  // يُتجاوز أثناء الإغلاق (عمل محذوف بقرار المستخدم) وعندما لا تطابق التاب الأداة المغادَرة
  // (التدفقات التقطت صراحةً قبل تبديل activeKey).
  onRouteLeaving((leavingId, targetId) => {
    if (closingKey != null) return;
    const tab = tabs.find((item) => item.key === activeKey);
    if (!tab || tab.toolId !== leavingId) return;
    captureInto(tab, getTool(leavingId));
    tab.toolId = targetId;
    // فتح لتاب بلا عمل محفوظ = بداية نظيفة: صفّر الأداة (تشمل الإعدادات
    // الافتراضية) قبل تسليم ملفات الـ hub، وإلا ورثت إعدادات تاب أخرى عبر DOM المشترك.
    if (!storedStateFor(tab, targetId)) {
      try {
        void getTool(targetId)?.restoreState?.(null);
      } catch (error) {
        console.error(error);
      }
    }
  });
  // أي تغيّر في شريط الحالة قد يعني ملفات جديدة → حدّث العناوين.
  onChromeChange(() => renderTabs());
  el("tab-new")?.addEventListener("click", () => void openTab());
  // إغلاق التطبيق يسأل عن تابات dirty أيضًا، لا الأداة الحية وحدها.
  const prev = globalThis.__pdfStudioHasUnsavedWork;
  globalThis.__pdfStudioHasUnsavedWork =
    () => (typeof prev === "function" ? prev() : false) || hasDirtyTabs();
  renderTabs();
}
