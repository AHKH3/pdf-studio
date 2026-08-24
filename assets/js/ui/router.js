import { el, qsa } from "../dom.js";
import { actionIds, captureFiles, filesForAction, hasCapture, onCaptureChange } from "./capture.js";
import { confirmLeave, isDialogOpen } from "./dialog.js";
import { toast } from "./feedback.js";
import { onToolPrefsChange, recordOrder, sortToolIds, isPinned, isHidden } from "./toolprefs.js";
import { setOperation } from "./titleblock.js";

/**
 * @typedef {object} Tool
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} input     short label for the legend's input column
 * @property {string} [op]      title-block operation name, defaults to name
 * @property {string} [actionLabel]
 * @property {boolean} [hidden] kept out of the legend
 * @property {() => void} [setup]
 * @property {() => void} [enter]
 * @property {() => void} [leave]
 * @property {() => boolean} [isDirty]
 * @property {() => void | Promise<void>} [run]
 * @property {() => string} [outputName]
 * @property {(files: File[]) => void | Promise<void>} [acceptFiles]
 */

/** @type {Map<string, Tool>} */
const tools = new Map();
let activeId = "";
let sweepTimer = 0;
let routing = false;

const ACTION_FLOW = {
  scan: ["صور", "PDF"],
  images: ["صور", "PDF"],
  merge: ["PDF+", "PDF"],
  split: ["PDF", "ملفات"],
  rasterize: ["PDF", "صور"],
  "extract-images": ["PDF", "صور"]
};

const HUB_TONE = {
  scan: "scan",
  images: "scan",
  rasterize: "rasterize",
  "extract-images": "extract",
  merge: "merge",
  organize: "organize",
  split: "split",
  compress: "compress",
  watermark: "watermark",
  numbers: "numbers",
  crop: "crop",
  protect: "protect",
  ocr: "ocr",
  sign: "sign",
  edit: "edit"
};

function glyph(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

function flowChip(tool) {
  const parts = ACTION_FLOW[tool.id];
  // نعتمد الآن ← هو اتجاه التقدم في RTL — نتحقق من كلا السهمين
  const hasArrow = String(tool.name).includes("→") || String(tool.name).includes("←");
  if (parts && !hasArrow) {
    const flow = document.createElement("span");
    flow.className = "legend__flow";
    const from = document.createElement("span");
    from.textContent = parts[0];
    const to = document.createElement("span");
    to.textContent = parts[1];
    flow.append(from, glyph("icon-arrow", "icon legend__chevron"), to);
    return flow;
  }
  if (tool.input && !hasArrow) {
    const input = document.createElement("span");
    input.className = "legend__input";
    input.textContent = tool.input;
    return input;
  }
  return null;
}

function hubFlowChip(tool) { return null; }

/** زر أداة واحد بتصميم الزر الرئيسي بألوان مختلفة. */
function buildToolButton(tool, { pinned = false } = {}) {
  const tone = HUB_TONE[tool.id] || tool.id;
  const displayName = tool.name.replace("→", "←");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "hub-tool";
  button.dataset.route = tool.id;
  button.dataset.tone = tone;
  button.setAttribute("role", "listitem");
  button.setAttribute("aria-label", pinned ? `${displayName} (مثبّتة — كليك يمين للخيارات)` : `${displayName} (كليك يمين للخيارات)`);
  button.title = pinned ? `${displayName} — مثبّتة` : displayName;
  if (tool.id === activeId) {
    button.classList.add("hub-tool--active");
    button.setAttribute("aria-current", "page");
  }

  const iconWrap = document.createElement("span");
  iconWrap.className = "hub-tool__icon";
  iconWrap.append(glyph(tool.icon || "icon-file", "icon"));

  const nameRow = document.createElement("span");
  nameRow.className = "hub-tool__name";
  nameRow.textContent = displayName;

  button.append(iconWrap, nameRow);

  if (pinned) {
    const mark = document.createElement("span");
    mark.className = "hub-tool__pinned-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.append(glyph("icon-pin", "icon"));
    button.append(mark);
  }

  return button;
}

/** @param {Tool[]} list */
export function registerTools(list) {
  for (const tool of list) tools.set(tool.id, tool);
}

export function activeTool() {
  return tools.get(activeId) ?? null;
}

export function allTools() {
  return Array.from(tools.values());
}

function syncLegendChrome() {
  const title = el("legend-title");
  const lede = el("legend-lede");
  if (title) title.textContent = "الإجراءات";
  if (lede) lede.textContent = hasCapture() ? `${captureFiles().length} ملف` : "أسقط ملفات أولاً";
}

function buildLegend() {
  const host = el("legend-list");
  syncLegendChrome();

  const allowed = new Set(actionIds());
  if (activeId && activeId !== "start") allowed.add(activeId);
  for (const tool of tools.values()) {
    if (tool.isDirty?.()) allowed.add(tool.id);
  }

  // الهيدر المخفي — يبقى للتوافق لكنه مخفي بـ CSS
  if (host) {
    host.replaceChildren();
    for (const tool of tools.values()) {
      if (tool.hidden) continue;
      const enabled = allowed.has(tool.id);
      if (!enabled) continue;
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn legend__row";
      button.dataset.route = tool.id;
      if (tool.id === activeId) {
        button.classList.add("btn--act");
        button.setAttribute("aria-current", "page");
      }
      const label = document.createElement("span");
      label.className = "legend__name";
      label.textContent = tool.name;
      label.title = tool.name;
      button.append(label);
      item.append(button);
      host.append(item);
    }
  }

  // الحاوية الجانبية في صفحة البداية — ثلاثة أقسام: مثبّتة / أدوات / مخفية
  const hubHost = el("hub-legend");
  const hubPinned = el("hub-legend-pinned");
  const hubHidden = el("hub-legend-hidden");
  const pinnedSection = el("hub-tools-pinned-section");
  const hiddenCount = el("hub-hidden-count");
  const hubEmpty = el("hub-empty-tools");

  // الأدوات المؤهلة حسب المزيج الحالي
  const eligible = [];
  for (const tool of tools.values()) {
    if (tool.hidden) continue;
    if (!allowed.has(tool.id)) continue;
    eligible.push(tool);
  }
  // ترتيب المستخدم المحفوظ
  const sortedIds = sortToolIds(eligible.map((tool) => tool.id));
  const byId = new Map(eligible.map((tool) => [tool.id, tool]));
  const sorted = sortedIds.map((id) => byId.get(id)).filter(Boolean);
  recordOrder(sortedIds);

  const pinnedTools = sorted.filter((tool) => isPinned(tool.id));
  const mainTools = sorted.filter((tool) => !isPinned(tool.id) && !isHidden(tool.id));
  const hiddenTools = sorted.filter((tool) => isHidden(tool.id));

  if (hubPinned) {
    hubPinned.replaceChildren();
    for (const tool of pinnedTools) hubPinned.append(buildToolButton(tool, { pinned: true }));
  }
  if (pinnedSection) pinnedSection.hidden = pinnedTools.length === 0;

  if (hubHost) {
    hubHost.replaceChildren();
    for (const tool of mainTools) hubHost.append(buildToolButton(tool));
  }

  if (hubHidden) {
    hubHidden.replaceChildren();
    for (const tool of hiddenTools) hubHidden.append(buildToolButton(tool));
  }
  if (hiddenCount) hiddenCount.textContent = hiddenTools.length ? String(hiddenTools.length) : "";

  let shown = pinnedTools.length + mainTools.length;
  if (hubEmpty) hubEmpty.hidden = shown > 0;
  const mainSection = el("hub-tools-main-section");
  if (mainSection) mainSection.hidden = mainTools.length === 0 && hiddenTools.length > 0;
  if (shown === 0 && hubHost) {
    hubHost.setAttribute("aria-hidden", "true");
  } else if (hubHost) {
    hubHost.removeAttribute("aria-hidden");
  }
}

function showRoute(id) {
  const tool = tools.get(id);
  if (!tool) return;

  const previous = tools.get(activeId);
  previous?.leave?.();

  for (const section of qsa(".view")) {
    const match = section.id === `view-${id}`;
    section.classList.toggle("view--active", match);
    /** @type {HTMLElement} */ (section).hidden = !match;
  }

  activeId = id;
  buildLegend();

  setOperation({
    op: tool.op ?? tool.name,
    actionLabel: tool.actionLabel ?? "تنفيذ",
    name: tool.outputName?.() ?? "",
    onRun: tool.run ? () => tool.run() : undefined
  });

  const work = el("work");
  if (work) {
    work.style.setProperty("--sweep", `${work.clientWidth}px`);
    work.classList.remove("is-changing");
    void work.offsetWidth;
    work.classList.add("is-changing");
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(() => work.classList.remove("is-changing"), 400);
  }
}

async function deliverAndEnter(id) {
  const tool = tools.get(id);
  if (!tool) return;
  const files = filesForAction(id);
  if (files.length) await tool.acceptFiles?.(files);
  tool.enter?.();

  const heading = el(`view-${id}`)?.querySelector(".view__title, .start__title");
  if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  el("work")?.scrollTo({ top: 0 });
}

/** @param {string} id */
export async function route(id) {
  const tool = tools.get(id);
  if (!tool || id === activeId || routing) return;
  if (isDialogOpen()) return;
  if (el("progress")?.classList.contains("is-open")) return;

  const previous = tools.get(activeId);
  if (previous?.isDirty?.()) {
    routing = true;
    const ok = await confirmLeave(previous.name);
    routing = false;
    if (!ok) return;
  }

  showRoute(id);
  await deliverAndEnter(id);
}

export function initRouter() {
  onCaptureChange(buildLegend);
  buildLegend();
  for (const tool of tools.values()) {
    try {
      tool.setup?.();
    } catch (error) {
      console.error(`تعذّر تهيئة الأداة ${tool.id}`, error);
    }
  }

  // أي تغيير في التثبيت/الإخفاء يعيد بناء الأقسام
  onToolPrefsChange(() => buildLegend());

  document.addEventListener("click", (event) => {
    const trigger = /** @type {HTMLElement} */ (event.target).closest("[data-route]");
    if (!(trigger instanceof HTMLElement)) return;
    event.preventDefault();
    if (trigger.getAttribute("aria-disabled") === "true") {
      toast("أسقط الملفات أولاً، ثم اختر الإجراء.", "info");
      route("start");
      return;
    }
    route(trigger.dataset.route);
  });

  window.addEventListener("beforeunload", (event) => {
    for (const tool of tools.values()) {
      if (!tool.isDirty?.()) continue;
      event.preventDefault();
      event.returnValue = "";
      return;
    }
  });

  showRoute("start");
  void deliverAndEnter("start");
}
