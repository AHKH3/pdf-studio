const CSS = `
.edit-root { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.edit-root .view__body { display: flex; flex-direction: column; min-height: 0; flex: 1; }

/* ——— hero drop ——— */
#edit-drop.intake {
  min-height: 280px;
  border: 1.5px dashed var(--border-strong);
  background: var(--surface-1);
  border-radius: var(--radius-xl);
}
#edit-drop .intake__title { font-size: 1.05rem; font-weight: 700; }

/* ——— workspace: flat, no cards ——— */
.edit {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

/* toolbar under the header: tools only, centered */
.edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.edit-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 3px;
}
.edit-tools .choice span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1;
  border-radius: var(--radius-pill);
  border-color: transparent;
}
.edit-tools .choice span .icon { width: 15px; height: 15px; }
.edit-tools .choice input:checked + span {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.edit-tools .choice input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
.edit-toolbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1;
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
}
.edit-toolbtn:hover { color: var(--accent); }
.edit-toolbtn .icon { width: 15px; height: 15px; }

/* contextual options bar under the toolbar */
.edit-optbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-1);
  min-height: 52px;
}
.edit-optbar [data-edit-panel] {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.edit-optbar [data-edit-panel][hidden] { display: none; }
.edit-optbar .field { min-width: 0; }
.edit-optbar select { height: 32px; max-width: 130px; }
.edit-optbar input[type="number"] { width: 60px; height: 32px; }
.edit-optbar textarea {
  flex: 1;
  min-width: 140px;
  min-height: 34px;
  max-height: 68px;
  resize: vertical;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface-0, #fff);
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  line-height: 1.5;
}
.edit-selcount { font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; }
.edit-kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 3px;
}
.edit-kind .choice span {
  padding: 5px 12px;
  font-size: 0.76rem;
  font-weight: 600;
  border-radius: var(--radius-pill);
}
.edit-kind .choice input:checked + span { background: var(--accent); color: #fff; border-color: var(--accent); }

/* color well + popover */
.edit-pop { position: relative; display: inline-flex; }
.edit-well {
  width: 32px; height: 32px; padding: 3px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  cursor: pointer;
  display: inline-flex;
}
.edit-well i { flex: 1; border-radius: 7px; background: var(--well, #1E3A8A); border: 1px solid rgba(15,23,42,0.18); }
.edit-well:hover { border-color: var(--accent); }
.edit-pop__panel {
  position: absolute;
  top: calc(100% + 8px);
  inset-inline-start: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--surface-0, #fff);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-soft);
  min-width: 172px;
}
.edit-pop__panel[hidden] { display: none; }
.edit-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.edit-swatch {
  width: 24px; height: 24px; padding: 0;
  border-radius: 50%;
  border: 2px solid rgba(15,23,42,0.14);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.edit-swatch:hover { transform: scale(1.15); }
.edit-swatch.is-active { box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px var(--accent-soft); }
.edit-custom { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.74rem; color: var(--text-muted); }
.edit-custom input[type="color"] { width: 40px; height: 28px; padding: 2px; }

/* ——— main: layers | preview | pages ——— */
.edit-main {
  direction: ltr;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) 196px;
  gap: var(--space-3);
  flex: 1;
  min-height: 0;
}
.edit-main > * { direction: rtl; min-width: 0; min-height: 0; }
.edit-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-1);
}
.edit-side__head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--border-soft);
  flex: none;
}
.edit-side__title { font-size: 0.8rem; font-weight: 700; margin: 0; padding-inline-start: 6px; }
.edit-side__count { font-size: 0.74rem; color: var(--text-muted); }
.edit-side__spacer { flex: 1; }
.edit-iconbtn {
  width: 28px; height: 28px;
  display: inline-grid; place-items: center;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--text-muted);
  cursor: pointer;
}
.edit-iconbtn:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
.edit-iconbtn:disabled { opacity: 0.35; cursor: default; }
.edit-iconbtn .icon { width: 15px; height: 15px; }
.edit-side__pager { display: flex; align-items: center; gap: 6px; width: 100%; }
.edit-side__pager .btn { flex: none; min-width: 0; padding: 0 8px; }
.edit-side__pager .scan__count { flex: 1; text-align: center; }

/* layers */
.edit-layers { overflow-y: auto; padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.edit-layers:empty::before {
  content: "لا عناصر";
  font-size: 0.78rem;
  color: var(--text-muted);
  text-align: center;
  padding: 16px 8px;
}
.edit-layers__page {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  padding: 6px 4px 2px;
}
.edit-layers__page.is-current { color: var(--accent); }
.edit-layer-row {
  display: grid;
  grid-template-columns: auto auto minmax(0,1fr) auto auto;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-0, #fff);
  cursor: pointer;
  font-size: 0.78rem;
  transition: border-color .15s, background .15s;
  user-select: none;
}
.edit-layer-row.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.edit-layer-row .icon { width: 14px; height: 14px; flex: none; }
.edit-layer-row__grip { cursor: grab; color: var(--text-muted); display: inline-flex; }
.edit-layer-row__name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: start; }
.edit-layer-row__btn { width: 26px; height: 26px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-muted); border-radius: 6px; cursor: pointer; }
.edit-layer-row__btn:hover { background: var(--surface-2); color: var(--ink); }
.edit-layer-row__btn--del:hover { background: var(--danger-soft, rgba(220,38,38,0.10)); color: var(--danger, #dc2626); }

/* center preview */
.edit-center {
  position: relative;
  display: flex;
  min-height: 0;
  min-width: 0;
  background: var(--surface-2);
  border-radius: 12px;
  overflow: hidden;
}
.edit-board-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  scrollbar-gutter: stable;
  padding: var(--space-4);
}
.edit-board {
  position: relative;
  display: inline-block;
  background: #fff;
  border: 1px solid rgba(15,23,42,0.12);
  box-shadow: 0 8px 28px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.08);
  border-radius: 6px;
  margin: auto;
}
.edit-board canvas {
  display: block;
  max-width: none;
  height: auto;
  background: #fff;
  border-radius: 4px;
  direction: ltr;
}
.edit-layer {
  position: absolute;
  inset: 0;
  direction: ltr;
  touch-action: none;
}
.edit-obj {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
  outline: 1px solid transparent;
  transform-origin: center center;
  font-family: "Noto Naskh Arabic", "Amiri", "Playfair Display", serif;
  line-height: 1.45;
  border-radius: 2px;
}
.edit-obj.is-selected {
  outline: 2px solid var(--accent);
  outline-offset: 0;
  z-index: 2;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.edit-obj:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.edit-obj img,
.edit-obj svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  border-radius: 2px;
}
.edit-obj textarea {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: var(--space-2) var(--space-2);
  resize: none;
  border: 0;
  background: color-mix(in srgb, #fff 88%, transparent);
  color: inherit;
  font: inherit;
  line-height: 1.45;
  direction: rtl;
  white-space: pre-wrap;
  overflow: hidden;
  border-radius: 2px;
  touch-action: none;
}
.edit-obj__text {
  display: flex;
  width: 100%;
  height: 100%;
  padding: var(--space-2) var(--space-2);
  box-sizing: border-box;
  white-space: pre-wrap;
  overflow: hidden;
  line-height: 1.45;
  pointer-events: none;
  word-break: break-word;
}
.edit-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  background: var(--accent);
  border: 2px solid #fff;
  border-radius: 3px;
  z-index: 3;
  box-sizing: border-box;
  box-shadow: 0 1px 4px rgba(15,23,42,0.20);
}
.edit-handle[data-handle="nw"] { top: -7px; left: -7px; cursor: nwse-resize; }
.edit-handle[data-handle="n"]  { top: -7px; left: 50%; margin-left: -7px; cursor: ns-resize; }
.edit-handle[data-handle="ne"] { top: -7px; right: -7px; cursor: nesw-resize; }
.edit-handle[data-handle="e"]  { top: 50%; right: -7px; margin-top: -7px; cursor: ew-resize; }
.edit-handle[data-handle="se"] { bottom: -7px; right: -7px; cursor: nwse-resize; }
.edit-handle[data-handle="s"]  { bottom: -7px; left: 50%; margin-left: -7px; cursor: ns-resize; }
.edit-handle[data-handle="sw"] { bottom: -7px; left: -7px; cursor: nesw-resize; }
.edit-handle[data-handle="w"]  { top: 50%; left: -7px; margin-top: -7px; cursor: ew-resize; }
.edit-rotate {
  position: absolute;
  left: 50%;
  top: -30px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: #fff;
  border: 2px solid var(--accent);
  border-radius: 50%;
  cursor: grab;
  z-index: 3;
  box-sizing: border-box;
  box-shadow: 0 1px 4px rgba(15,23,42,0.18);
}
.edit-rotate::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 14px;
  width: 2px;
  height: 12px;
  background: var(--accent);
  border-radius: 1px;
}
.edit-obj:not(.is-selected) .edit-handle,
.edit-obj:not(.is-selected) .edit-rotate { display: none; }
.edit-ghost {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  pointer-events: none;
  border-radius: 3px;
}
.edit-marquee {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  pointer-events: none;
  border-radius: 2px;
  z-index: 5;
}
.edit-ink-live {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.edit-layer[data-tool="pen"] { cursor: crosshair; }
.edit-layer[data-tool="text"] { cursor: text; }
.edit-layer[data-tool="rect"],
.edit-layer[data-tool="ellipse"],
.edit-layer[data-tool="triangle"] { cursor: crosshair; }

/* pages rail */
.edit-pages { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.edit-page {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-0, #fff);
  cursor: pointer;
}
.edit-page.is-active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.edit-page__img {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #fff;
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 0.72rem;
}
.edit-page__img canvas { width: 100%; height: 100%; object-fit: contain; display: block; }
.edit-page__num { font-size: 0.72rem; color: var(--text-muted); }
.edit-page.is-active .edit-page__num { color: var(--accent); font-weight: 700; }
.edit-pages__foot {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-2);
  border-top: 1px solid var(--border-soft);
}
.edit-zoomrow { display: flex; align-items: center; gap: 4px; }
.edit-zoomrow .btn { flex: 1; min-width: 0; padding: 0 4px; }
.edit-zoom-label { font-size: 0.74rem; min-width: 44px; text-align: center; }
.edit-fit {
  display: flex;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 2px;
  gap: 2px;
}
.edit-fit .choice { flex: 1; }
.edit-fit .choice span {
  display: block;
  text-align: center;
  padding: 4px 6px;
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: var(--radius-pill);
}
.edit-fit .choice input:checked + span { background: var(--accent); color: #fff; border-color: var(--accent); }

@media (max-width: 1080px) {
  .edit-main { grid-template-columns: 1fr; grid-template-rows: minmax(320px, 1fr) auto auto; overflow-y: auto; }
  .edit-side { max-height: 190px; border: 0; border-top: 1px solid var(--border-soft); }
  .edit-pages { flex-direction: row; overflow-x: auto; }
  .edit-page { flex: 0 0 108px; }
  .edit-center { min-height: 340px; }
}
@media (prefers-reduced-motion: reduce) {
  .edit-obj { transition: none; }
}
`;

export const STYLE_ID = "pdf-studio-edit-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
}

function icon(href, flip = false) {
  return `<svg class="icon${flip ? " flip" : ""}" aria-hidden="true"><use href="#${href}"></use></svg>`;
}

export const INK_COLORS = ["#111827", "#1E3A8A", "#DC2626", "#059669", "#D97706", "#7C3AED"];
export const FILL_COLORS = ["#FDE68A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FECACA", "#FFFFFF"];
export const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48];

function colorPop(id, value, colors, label) {
  return `<span class="edit-pop" data-pop="${id}">
    <button type="button" class="edit-well" data-well="${id}" aria-label="${label}" aria-haspopup="true"><i></i></button>
    <span class="edit-pop__panel" data-pop-panel="${id}" hidden>
      <span class="edit-swatches">${colors
        .map((c) => `<button type="button" class="edit-swatch" data-swatch="${c}" data-for="${id}" style="background:${c}" aria-label="لون ${c}"></button>`)
        .join("")}</span>
      <label class="edit-custom">مخصص<input id="${id}" type="color" value="${value}" /></label>
    </span>
  </span>`;
}

function choice(name, value, label, iconHref, checked = false) {
  const ic = iconHref ? icon(iconHref) : "";
  return `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} /><span>${ic}<span>${label}</span></span></label>`;
}

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("edit-root");
  root.innerHTML = `
      <h2 class="view__title sr-only" id="edit-title" tabindex="-1">تعديل PDF</h2>

    <div class="view__body">
      <div id="edit-drop" class="intake" data-kind="pdf">
        ${icon("icon-file")}
        <span class="intake__title">أسقط ملف PDF هنا</span>
        <button id="edit-browse" type="button" class="btn">تصفّح</button>
      </div>
      <input id="edit-input" type="file" accept="application/pdf,.pdf" hidden />
      <input id="edit-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />

      <div id="edit-workspace" class="edit" hidden>
        <div class="edit-toolbar">
          <div class="edit-tools" role="radiogroup" aria-label="أداة التعديل">
            ${choice("edit-tool", "select", "تحديد", "icon-quad")}
            ${choice("edit-tool", "text", "نص", "icon-file", true)}
            ${choice("edit-tool", "pen", "رسم", "icon-sign")}
            ${choice("edit-tool", "shapes", "الأشكال", "icon-crop")}
            <button id="edit-image-add" type="button" class="edit-toolbtn">${icon("icon-images")}<span>صورة</span></button>
          </div>
        </div>

        <div class="edit-optbar" id="edit-optbar">
          <div data-edit-panel="select">
            <span class="edit-selcount num" id="edit-sel-count"></span>
            <button id="edit-dup" type="button" class="btn btn--compact">${icon("icon-plus")} مضاعفة</button>
            <button id="edit-scale-down" type="button" class="btn btn--compact" aria-label="تصغير المحدد">−</button>
            <button id="edit-scale-up" type="button" class="btn btn--compact" aria-label="تكبير المحدد">+</button>
            <button id="edit-front" type="button" class="btn btn--compact">للأمام</button>
            <button id="edit-back" type="button" class="btn btn--compact">للخلف</button>
            <button id="edit-delete" type="button" class="btn btn--compact">${icon("icon-trash")} حذف</button>
            <button id="edit-clear-sel" type="button" class="btn btn--compact btn--ghost">إلغاء التحديد</button>
          </div>

          <div data-edit-panel="text" hidden>
            <textarea id="edit-text" rows="2" maxlength="2000" aria-label="نص العنصر"></textarea>
            <select id="edit-text-size" aria-label="حجم الخط">
              ${TEXT_SIZES.map((s) => `<option value="${s}"${s === 18 ? " selected" : ""}>${s}</option>`).join("")}
            </select>
            <label class="check"><input id="edit-text-bold" type="checkbox" />عريض</label>
            <label class="check"><input id="edit-text-italic" type="checkbox" />مائل</label>
            <label class="check"><input id="edit-text-underline" type="checkbox" />تسطير</label>
            <span class="choice-grid" role="radiogroup" aria-label="المحاذاة">
              ${choice("edit-align", "right", "يمين", null, true)}
              ${choice("edit-align", "center", "وسط", null, false)}
              ${choice("edit-align", "left", "يسار", null, false)}
            </span>
            ${colorPop("edit-text-color", "#1E3A8A", INK_COLORS, "لون النص")}
          </div>

          <div data-edit-panel="pen" hidden>
            ${colorPop("edit-pen-color", "#1E3A8A", INK_COLORS, "لون القلم")}
            <select id="edit-pen-weight" aria-label="سمك القلم">
              <option value="1.2">رفيع</option>
              <option value="2.2" selected>متوسط</option>
              <option value="4">سميك</option>
              <option value="7">عريض</option>
            </select>
          </div>

          <div data-edit-panel="shapes" hidden>
            <span class="edit-kind" role="radiogroup" aria-label="نوع الشكل">
              ${choice("edit-shape", "rect", "مستطيل", null, true)}
              ${choice("edit-shape", "ellipse", "دائرة", null, false)}
              ${choice("edit-shape", "triangle", "مثلث", null, false)}
            </span>
            <select id="edit-shape-preset" aria-label="نمط الشكل">
              <option value="custom" selected>مخصص</option>
              <option value="highlight">تظليل</option>
              <option value="frame">إطار</option>
              <option value="fill">تعبئة</option>
              <option value="cover">تغطية</option>
            </select>
            <label class="check"><input id="edit-fill-on" type="checkbox" checked />تعبئة</label>
            ${colorPop("edit-fill-color", "#8AA4E0", FILL_COLORS, "لون التعبئة")}
            ${colorPop("edit-stroke-color", "#1E3A8A", INK_COLORS, "لون الحد")}
            <input id="edit-stroke-width" type="number" min="0" max="24" step="0.5" value="1.5" aria-label="سمك الحد" />
          </div>
        </div>

        <div class="edit-main">
          <aside class="edit-side edit-side--layers" aria-label="الطبقات">
            <div class="edit-side__head">
              <h3 class="edit-side__title">الطبقات</h3>
              <span class="edit-side__count num" id="edit-layers-count"></span>
              <span class="edit-side__spacer"></span>
              <button id="edit-undo" type="button" class="edit-iconbtn" aria-label="تراجع" title="تراجع">${icon("icon-rotate")}</button>
              <button id="edit-redo" type="button" class="edit-iconbtn" aria-label="إعادة" title="إعادة">${icon("icon-rotate", true)}</button>
              <button id="edit-clear" type="button" class="edit-iconbtn" aria-label="إغلاق المستند" title="إغلاق">${icon("icon-close")}</button>
            </div>
            <div id="edit-layers" class="edit-layers" aria-label="قائمة الطبقات"></div>
          </aside>

          <div class="edit-center">
            <div class="edit-board-wrap" id="edit-wrap">
              <div class="edit-board" id="edit-board">
                <canvas id="edit-page" width="794" height="1123" aria-label="صفحة PDF"></canvas>
                <div id="edit-layer" class="edit-layer" data-tool="text"></div>
              </div>
            </div>
          </div>

          <aside class="edit-side edit-side--pages" aria-label="الصفحات">
            <div class="edit-side__head">
              <div class="edit-side__pager">
                <button id="edit-prev" type="button" class="btn btn--compact" aria-label="السابقة">${icon("icon-arrow", true)}</button>
                <span class="scan__count num" id="edit-count">1 / 1</span>
                <button id="edit-next" type="button" class="btn btn--compact" aria-label="التالية">${icon("icon-arrow")}</button>
              </div>
            </div>
            <div id="edit-pages" class="edit-pages" role="list" aria-label="صفحات المستند"></div>
            <div class="edit-pages__foot">
              <div class="edit-zoomrow">
                <button id="edit-zoom-out" type="button" class="btn btn--compact" aria-label="تصغير">−</button>
                <span class="num edit-zoom-label" id="edit-zoom-label">100%</span>
                <button id="edit-zoom-in" type="button" class="btn btn--compact" aria-label="تكبير">+</button>
              </div>
              <div class="edit-fit" role="radiogroup" aria-label="ملاءمة الصفحة">
                ${choice("edit-fit", "width", "العرض", null, true)}
                ${choice("edit-fit", "page", "صفحة", null, false)}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;

  const intakeGlyph = root.querySelector("#edit-drop .icon");
  if (intakeGlyph) intakeGlyph.classList.add("intake__glyph");

  return {
    drop: root.querySelector("#edit-drop"),
    browse: root.querySelector("#edit-browse"),
    input: root.querySelector("#edit-input"),
    imageInput: root.querySelector("#edit-image-input"),
    imageAdd: root.querySelector("#edit-image-add"),
    workspace: root.querySelector("#edit-workspace"),
    optbar: root.querySelector("#edit-optbar"),
    canvas: root.querySelector("#edit-page"),
    layer: root.querySelector("#edit-layer"),
    wrap: root.querySelector("#edit-wrap"),
    prev: root.querySelector("#edit-prev"),
    next: root.querySelector("#edit-next"),
    count: root.querySelector("#edit-count"),
    pages: root.querySelector("#edit-pages"),
    zoomIn: root.querySelector("#edit-zoom-in"),
    zoomOut: root.querySelector("#edit-zoom-out"),
    zoomLabel: root.querySelector("#edit-zoom-label"),
    layers: root.querySelector("#edit-layers"),
    layersCount: root.querySelector("#edit-layers-count"),
    selCount: root.querySelector("#edit-sel-count"),
    text: root.querySelector("#edit-text"),
    textSize: root.querySelector("#edit-text-size"),
    textColor: root.querySelector("#edit-text-color"),
    textBold: root.querySelector("#edit-text-bold"),
    textItalic: root.querySelector("#edit-text-italic"),
    textUnderline: root.querySelector("#edit-text-underline"),
    penColor: root.querySelector("#edit-pen-color"),
    penWeight: root.querySelector("#edit-pen-weight"),
    shapePreset: root.querySelector("#edit-shape-preset"),
    fillOn: root.querySelector("#edit-fill-on"),
    fillColor: root.querySelector("#edit-fill-color"),
    strokeColor: root.querySelector("#edit-stroke-color"),
    strokeWidth: root.querySelector("#edit-stroke-width"),
    undo: root.querySelector("#edit-undo"),
    redo: root.querySelector("#edit-redo"),
    dup: root.querySelector("#edit-dup"),
    scaleDown: root.querySelector("#edit-scale-down"),
    scaleUp: root.querySelector("#edit-scale-up"),
    front: root.querySelector("#edit-front"),
    back: root.querySelector("#edit-back"),
    clearSel: root.querySelector("#edit-clear-sel"),
    remove: root.querySelector("#edit-delete"),
    clear: root.querySelector("#edit-clear")
  };
}
