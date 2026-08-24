import { el, qsa } from "../dom.js";
import { actionIds, captureFiles, filesForAction, hasCapture, onCaptureChange } from "./capture.js";
import { confirmLeave, isDialogOpen } from "./dialog.js";
import { toast } from "./feedback.js";
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

const HUB_HINTS = {
  scan: "قص تلقائي وتصحيح منظور — حوّل صورك إلى PDF نظيف",
  merge: "اجمع ملفات PDF متعددة في مستند واحد بالترتيب",
  organize: "رتّب الصفحات، أدرها، احذف أو أضف صفحات جديدة",
  split: "قسّم الملف إلى أجزاء حسب النطاقات التي تحددها",
  compress: "قلّل الحجم بإعادة ضغط الصفحات كصور",
  watermark: "اطبع نصاً شفافاً فوق كل الصفحات",
  numbers: "أضف ترقيماً نصياً حقيقياً قابلاً للبحث",
  rasterize: "صدّر كل صفحة كصورة PNG أو JPG",
  crop: "قص الهوامش بسحب مربع على المعاينة",
  protect: "احمِ الملف بكلمة سر أو أزل الحماية",
  "extract-images": "استخرج الصور الأصلية كما خُزّنت داخل PDF",
  ocr: "أضف طبقة نص مخفية (OCR عربي+إنجليزي) للبحث",
  sign: "أضف توقيعاً أو ختماً على الصفحات",
  edit: "حرّر النص والعناصر داخل الصفحات"
};

const HUB_TONE = {
  scan: "convert",
  images: "convert",
  rasterize: "convert",
  "extract-images": "convert",
  merge: "organize",
  organize: "organize",
  split: "organize",
  compress: "enhance",
  watermark: "enhance",
  numbers: "enhance",
  crop: "enhance",
  protect: "enhance",
  ocr: "enhance",
  sign: "enhance",
  edit: "enhance"
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

function hubFlowChip(tool) {
  const parts = ACTION_FLOW[tool.id];
  if (!parts) return null;
  const flow = document.createElement("span");
  flow.className = "hub-tool__flow";
  flow.setAttribute("aria-hidden", "true");
  const from = document.createElement("span");
  from.className = "hub-tool__flow-from";
  from.textContent = parts[0];
  const to = document.createElement("span");
  to.className = "hub-tool__flow-to";
  to.textContent = parts[1];
  const arrow = document.createElement("span");
  arrow.className = "hub-tool__flow-arrow";
  arrow.append(glyph("icon-arrow", "icon"));
  flow.append(from, arrow, to);
  return flow;
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

  // الحاوية الجانبية الجديدة في صفحة البداية — بطاقات مميزة بأيقونة ونص وسهم صحيح
  const hubHost = el("hub-legend");
  const hubEmpty = el("hub-empty-tools");
  if (!hubHost) return;
  hubHost.replaceChildren();

  let shown = 0;
  for (const tool of tools.values()) {
    if (tool.hidden) continue;
    const enabled = allowed.has(tool.id);
    if (!enabled) continue;

    const tone = HUB_TONE[tool.id] || "enhance";
    const hint = HUB_HINTS[tool.id] || "";
    const flow = hubFlowChip(tool);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "hub-tool";
    button.dataset.route = tool.id;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `${tool.name} — ${hint}`);
    if (tool.id === activeId) {
      button.classList.add("hub-tool--active");
      button.setAttribute("aria-current", "page");
    }

    const head = document.createElement("div");
    head.className = "hub-tool__head";

    const iconWrap = document.createElement("span");
    iconWrap.className = "hub-tool__icon";
    iconWrap.dataset.tone = tone;
    iconWrap.append(glyph(tool.icon || "icon-file", "icon"));

    const titles = document.createElement("div");
    titles.className = "hub-tool__titles";

    const nameRow = document.createElement("span");
    nameRow.className = "hub-tool__name";
    // نستخدم الاسم كما هو لكن نضمن أن السهم يتجه يساراً (←) للتقدم في RTL
    // إذا كان الاسم يحتوي → نستبدله بصرياً بـ ← عبر النص
    const displayName = tool.name.replace("→", "←");
    nameRow.textContent = displayName;

    titles.append(nameRow);
    if (flow) titles.append(flow);

    head.append(iconWrap, titles);

    const hintEl = document.createElement("p");
    hintEl.className = "hub-tool__hint";
    hintEl.textContent = hint;

    const meta = document.createElement("div");
    meta.className = "hub-tool__meta";
    if (tool.input) {
      const badge = document.createElement("span");
      badge.className = "hub-tool__badge hub-tool__badge--needs";
      badge.textContent = `يحتاج: ${tool.input}`;
      meta.append(badge);
    }
    if (tool.actionLabel) {
      const act = document.createElement("span");
      act.className = "hub-tool__badge";
      act.textContent = tool.actionLabel;
      meta.append(act);
    }

    button.append(head, hintEl, meta);
    hubHost.append(button);
    shown += 1;
  }

  if (hubEmpty) hubEmpty.hidden = shown > 0;
  if (shown === 0) {
    hubHost.setAttribute("aria-hidden", "true");
  } else {
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
