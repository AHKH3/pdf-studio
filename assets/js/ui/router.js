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
  scan: ["صورة", "PDF"],
  images: ["صور", "PDF"],
  merge: ["PDF+", "PDF"],
  split: ["PDF", "ملفات"],
  rasterize: ["PDF", "صور"],
  "extract-images": ["PDF", "صور"]
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
  if (parts && !String(tool.name).includes("→")) {
    const flow = document.createElement("span");
    flow.className = "legend__flow";
    const from = document.createElement("span");
    from.textContent = parts[0];
    const to = document.createElement("span");
    to.textContent = parts[1];
    flow.append(from, glyph("icon-arrow", "icon legend__chevron"), to);
    return flow;
  }
  if (tool.input && !String(tool.name).includes("→")) {
    const input = document.createElement("span");
    input.className = "legend__input";
    input.textContent = tool.input;
    return input;
  }
  return null;
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
  if (lede) lede.textContent = hasCapture() ? `${captureFiles().length} ملف` : "ارفع ملفات أولاً";
}

function buildLegend() {
  const host = el("legend-list");
  if (!host) return;
  host.replaceChildren();
  syncLegendChrome();

  const allowed = new Set(actionIds());
  if (activeId && activeId !== "start") allowed.add(activeId);
  for (const tool of tools.values()) {
    if (tool.isDirty?.()) allowed.add(tool.id);
  }

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
    if (!enabled) {
      button.setAttribute("aria-disabled", "true");
      button.classList.add("is-disabled");
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
      toast("ارفع الملفات أولاً، ثم اختر الإجراء.", "info");
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
