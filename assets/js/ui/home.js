import { el } from "../dom.js";
import { hasCapture, onCaptureChange } from "./capture.js";
import { allTools, onToolsChanged, toneFor } from "./router.js";
import { isHidden, isPinned, onToolPrefsChange, sortToolIds } from "./toolprefs.js";

/**
 * شبكة «كل الأدوات» في الصفحة الرئيسية — ظاهرة دائمًا تحت منطقة الرفع.
 * كل البطاقات مفعّلة: الضغط يوجّه للأداة (التوجيه العام عبر data-route)،
 * وإن وُجدت ملفات ملتقطة تُسلَّم للأداة تلقائيًا عبر deliverAndEnter.
 * التثبيت/الإخفاء بالكليك يمين يعمل هنا كما في حاوية hub (toolprefs).
 */

/** أسماء عرض تُميّز البطاقتين المتشابهتين (scan/images اسمهما واحد في السجل). */
const NAME_OVERRIDES = {
  scan: "مسح ضوئي"
};

/** أوصاف بطاقات الأدوات — فارغة حاليًا (أُضيفت لأن غيابها كان يكسر عرض الشبكة). */
const DESCRIPTIONS = {};

const GROUPS = [
  { title: "إنشاء وتجميع", ids: ["scan", "images", "merge"] },
  { title: "تنظيم وتحسين", ids: ["organize", "split", "compress", "crop"] },
  { title: "لمسات", ids: ["numbers", "edit"] },
  { title: "إخراج", ids: ["rasterize", "extract-images"] }
];

function glyph(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

/** @param {import("./router.js").Tool} tool */
function buildHomeCard(tool, { pinned = false } = {}) {
  const displayName = (NAME_OVERRIDES[tool.id] || tool.name || "").replace("→", "←");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "home-tool";
  button.dataset.route = tool.id;
  button.dataset.tone = toneFor(tool.id);
  button.setAttribute("role", "listitem");
  button.setAttribute(
    "aria-label",
    pinned ? `${displayName} (مثبّتة — كليك يمين للخيارات)` : `${displayName} (كليك يمين للخيارات)`
  );
  button.title = displayName;

  const iconWrap = document.createElement("span");
  iconWrap.className = "home-tool__icon";
  iconWrap.append(glyph(tool.icon || "icon-file"));

  const name = document.createElement("span");
  name.className = "home-tool__name";
  name.textContent = displayName;

  button.append(iconWrap, name);

  if (pinned) {
    const mark = document.createElement("span");
    mark.className = "home-tool__pinned-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.append(glyph("icon-pin"));
    button.append(mark);
  }
  return button;
}

function render() {
  const section = el("home-tools");
  const body = el("home-tools-body");
  const count = el("home-tools-count");
  const hiddenDetails = el("home-tools-hidden-details");
  const hiddenHost = el("home-legend-hidden");
  const hiddenCount = el("home-hidden-count");
  if (!body) return;

  // الشبكة لحالة البداية فقط — مع وجود ملفات، حاوية hub الجانبية تتولى المهمة
  if (section) section.hidden = hasCapture();
  if (hasCapture()) return;

  const known = new Map(allTools().filter((tool) => tool?.id && !tool.hidden).map((tool) => [tool.id, tool]));
  if (!known.size) return; // الأدوات تُحمَّل تدريجيًا — نُبقي رسالة التحميل

  const ordered = sortToolIds(Array.from(known.keys()));
  const pinned = ordered.filter((id) => isPinned(id)).map((id) => known.get(id));
  const hidden = ordered.filter((id) => isHidden(id)).map((id) => known.get(id));
  const rest = new Map(ordered.filter((id) => !isPinned(id) && !isHidden(id)).map((id) => [id, known.get(id)]));

  body.replaceChildren();
  let shown = 0;

  if (pinned.length) {
    const group = document.createElement("div");
    group.className = "home-tools__group";
    const title = document.createElement("h3");
    title.className = "home-tools__group-title";
    title.append(glyph("icon-pin"));
    title.append("مثبّتة");
    const grid = document.createElement("div");
    grid.className = "home-tools__grid";
    grid.setAttribute("role", "list");
    grid.setAttribute("aria-label", "الأدوات المثبتة");
    for (const tool of pinned) grid.append(buildHomeCard(tool, { pinned: true }));
    group.append(title, grid);
    body.append(group);
    shown += pinned.length;
  }

  for (const groupDef of GROUPS) {
    const tools = groupDef.ids.map((id) => rest.get(id)).filter(Boolean);
    if (!tools.length) continue;
    const group = document.createElement("div");
    group.className = "home-tools__group";
    const title = document.createElement("h3");
    title.className = "home-tools__group-title";
    title.textContent = groupDef.title;
    const grid = document.createElement("div");
    grid.className = "home-tools__grid";
    grid.setAttribute("role", "list");
    grid.setAttribute("aria-label", groupDef.title);
    for (const tool of tools) grid.append(buildHomeCard(tool));
    group.append(title, grid);
    body.append(group);
    shown += tools.length;
  }

  // أدوات جديدة غير مصنّفة في المجموعات (أمان مستقبلي) — لا تضيع بصمت
  const grouped = new Set(GROUPS.flatMap((group) => group.ids));
  const ungrouped = Array.from(rest.values()).filter((tool) => tool && !grouped.has(tool.id));
  if (ungrouped.length) {
    const group = document.createElement("div");
    group.className = "home-tools__group";
    const title = document.createElement("h3");
    title.className = "home-tools__group-title";
    title.textContent = "أدوات أخرى";
    const grid = document.createElement("div");
    grid.className = "home-tools__grid";
    grid.setAttribute("role", "list");
    for (const tool of ungrouped) grid.append(buildHomeCard(tool));
    group.append(title, grid);
    body.append(group);
    shown += ungrouped.length;
  }

  if (count) count.textContent = shown ? `${shown} أداة` : "";

  if (hiddenHost) {
    hiddenHost.replaceChildren();
    for (const tool of hidden) {
      if (tool) hiddenHost.append(buildHomeCard(tool));
    }
  }
  if (hiddenDetails) hiddenDetails.hidden = hidden.length === 0;
  if (hiddenCount) hiddenCount.textContent = hidden.length ? String(hidden.length) : "";
}

export function initHome() {
  render();
  onToolsChanged(() => render());
  onToolPrefsChange(() => render());
  onCaptureChange(() => render());
}
