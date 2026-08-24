const CSS = `
.edit-root { max-width: 100%; }
.edit-board-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.edit-board {
  position: relative;
  display: inline-block;
  max-width: 100%;
  padding: 10px;
  background: var(--sheet-2);
  border: 1px solid var(--rule);
}
.edit-board canvas {
  display: block;
  max-width: 100%;
  height: auto;
  background: var(--sheet);
  border: 1px solid var(--rule-strong);
}
.edit-layer {
  position: absolute;
  inset: 10px;
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
  font-family: "Noto Naskh Arabic", "Playfair Display", serif;
  line-height: 1.45;
}
.edit-obj.is-selected {
  outline: 1.5px solid var(--act);
  outline-offset: 1px;
  z-index: 2;
}
.edit-obj:focus-visible {
  outline: 2px solid var(--act);
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
}
.edit-obj textarea {
  display: block;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  resize: none;
  border: 0;
  background: color-mix(in srgb, var(--sheet) 82%, transparent);
  color: inherit;
  font: inherit;
  line-height: 1.45;
  direction: rtl;
  white-space: pre-wrap;
  overflow: hidden;
}
.edit-obj__text {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  white-space: pre-wrap;
  overflow: hidden;
  line-height: 1.45;
  pointer-events: none;
}
.edit-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  background: var(--act);
  border: 1px solid var(--sheet);
  z-index: 3;
  box-sizing: border-box;
}
.edit-handle[data-handle="nw"] { top: -6px; left: -6px; cursor: nwse-resize; }
.edit-handle[data-handle="n"]  { top: -6px; left: 50%; margin-left: -5px; cursor: ns-resize; }
.edit-handle[data-handle="ne"] { top: -6px; right: -6px; cursor: nesw-resize; }
.edit-handle[data-handle="e"]  { top: 50%; right: -6px; margin-top: -5px; cursor: ew-resize; }
.edit-handle[data-handle="se"] { bottom: -6px; right: -6px; cursor: nwse-resize; }
.edit-handle[data-handle="s"]  { bottom: -6px; left: 50%; margin-left: -5px; cursor: ns-resize; }
.edit-handle[data-handle="sw"] { bottom: -6px; left: -6px; cursor: nesw-resize; }
.edit-handle[data-handle="w"]  { top: 50%; left: -6px; margin-top: -5px; cursor: ew-resize; }
.edit-rotate {
  position: absolute;
  left: 50%;
  top: -28px;
  width: 11px;
  height: 11px;
  margin-left: -5px;
  background: var(--sheet);
  border: 2px solid var(--act);
  cursor: grab;
  z-index: 3;
  box-sizing: border-box;
}
.edit-rotate::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 11px;
  width: 1px;
  height: 14px;
  background: var(--act);
}
.edit-obj:not(.is-selected) .edit-handle,
.edit-obj:not(.is-selected) .edit-rotate { display: none; }
.edit-ghost {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px dashed var(--act);
  background: color-mix(in srgb, var(--act) 12%, transparent);
  pointer-events: none;
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

function icon(href) {
  return `<svg class="icon" aria-hidden="true"><use href="#${href}"></use></svg>`;
}

function choice(name, value, label, checked = false) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} /><span>${label}</span></label>`;
}

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("edit-root");
  root.innerHTML = `
    <div class="view__head">
      <h2 class="view__title" id="edit-title" tabindex="-1">تحرير</h2>
      <p class="view__lede">نص وقلم وصور وأشكال فوق الصفحة. يُدمج محلياً.</p>
    </div>

    <div class="view__body">
      <div id="edit-drop" class="intake" data-kind="pdf">
        ${icon("icon-edit")}
        <span class="intake__title">أسقط ملف PDF هنا</span>
        <span class="intake__hint">ملف واحد · الإضافات تُرسم فوق الصفحة ولا تغيّر النص الأصلي</span>
        <button id="edit-browse" type="button" class="btn">تصفّح</button>
      </div>
      <input id="edit-input" type="file" accept="application/pdf,.pdf" hidden />
      <input id="edit-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />

      <div id="edit-workspace" class="scan" hidden>
        <div class="scan__stage">
          <div class="scan__pager">
            <button id="edit-prev" type="button" class="btn btn--compact">
              ${icon("icon-arrow")} السابقة
            </button>
            <span class="scan__count num" id="edit-count">1 / 1</span>
            <button id="edit-next" type="button" class="btn btn--compact">
              التالية <svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg>
            </button>
          </div>
          <span class="preview__label">اضغط على الصفحة للإضافة · الزوايا للحجم · المقبض العلوي للتدوير · Delete يحذف</span>
          <div class="edit-board-wrap">
            <div class="edit-board" id="edit-board">
              <canvas id="edit-page" width="360" height="509" aria-label="معاينة الصفحة مع التحرير"></canvas>
              <div id="edit-layer" class="edit-layer" data-tool="select"></div>
            </div>
          </div>
        </div>

        <aside class="scan__panel">
          <div class="panel-block">
            <h3 class="panel-block__title">الأداة</h3>
            <div class="choice-grid" role="radiogroup" aria-label="أداة التحرير">
              ${choice("edit-tool", "select", "تحديد", true)}
              ${choice("edit-tool", "text", "نص")}
              ${choice("edit-tool", "pen", "قلم")}
              ${choice("edit-tool", "rect", "مربع")}
              ${choice("edit-tool", "ellipse", "دائرة")}
              ${choice("edit-tool", "triangle", "مثلث")}
              ${choice("edit-tool", "image", "صورة")}
            </div>
          </div>

          <div class="panel-block" data-edit-panel="text" hidden>
            <h3 class="panel-block__title">النص</h3>
            <div class="field field--wide">
              <label for="edit-text">المحتوى</label>
              <textarea id="edit-text" rows="3" maxlength="2000" placeholder="اكتب هنا"></textarea>
            </div>
            <div class="field">
              <label for="edit-text-size">الحجم</label>
              <input id="edit-text-size" type="number" min="10" max="96" value="18" />
            </div>
            <div class="field">
              <label for="edit-text-color">اللون</label>
              <input id="edit-text-color" type="color" value="#1E3A8A" />
            </div>
            <label class="check">
              <input id="edit-text-bold" type="checkbox" />
              عريض
            </label>
            <div class="field field--wide">
              <span id="edit-align-label">المحاذاة</span>
              <div class="choice-grid" role="radiogroup" aria-labelledby="edit-align-label">
                ${choice("edit-align", "right", "يمين", true)}
                ${choice("edit-align", "center", "وسط")}
                ${choice("edit-align", "left", "يسار")}
              </div>
            </div>
          </div>

          <div class="panel-block" data-edit-panel="pen" hidden>
            <h3 class="panel-block__title">القلم</h3>
            <div class="field">
              <label for="edit-pen-color">اللون</label>
              <input id="edit-pen-color" type="color" value="#1E3A8A" />
            </div>
            <div class="field">
              <label for="edit-pen-weight">السُمك</label>
              <select id="edit-pen-weight">
                <option value="1.2">رفيع</option>
                <option value="2.2" selected>متوسط</option>
                <option value="4">سميك</option>
                <option value="7">عريض</option>
              </select>
            </div>
          </div>

          <div class="panel-block" data-edit-panel="shape" hidden>
            <h3 class="panel-block__title">الشكل</h3>
            <label class="check">
              <input id="edit-fill-on" type="checkbox" checked />
              تعبئة
            </label>
            <div class="field">
              <label for="edit-fill-color">لون التعبئة</label>
              <input id="edit-fill-color" type="color" value="#8AA4E0" />
            </div>
            <div class="field">
              <label for="edit-stroke-color">لون الحد</label>
              <input id="edit-stroke-color" type="color" value="#1E3A8A" />
            </div>
            <div class="field">
              <label for="edit-stroke-width">سُمك الحد</label>
              <input id="edit-stroke-width" type="number" min="0" max="24" step="0.5" value="1.5" />
            </div>
          </div>

          <div class="panel-block" data-edit-panel="image" hidden>
            <h3 class="panel-block__title">الصورة</h3>
            <p class="panel-block__meta" id="edit-image-meta">PNG أو JPG أو WEBP. اسحب لتدوير الحجم.</p>
            <button id="edit-image-browse" type="button" class="btn btn--wide">
              ${icon("icon-upload")} اختيار صورة
            </button>
          </div>

          <div class="panel-block">
            <div class="btn-row">
              <button id="edit-undo" type="button" class="btn">تراجع</button>
              <button id="edit-delete" type="button" class="btn">حذف</button>
            </div>
          </div>

          <div class="panel-block">
            <p class="note" style="margin-bottom:12px">
              الناتج PDF مسطّح: العناصر تُرسم فوق الصفحة. النص الأصلي داخل الملف لا يُعدَّل.
            </p>
            <button id="edit-save" type="button" class="btn btn--act btn--wide">حفظ التحرير</button>
            <button id="edit-clear" type="button" class="btn btn--wide" style="margin-top:8px">
              ${icon("icon-close")} إغلاق
            </button>
          </div>
        </aside>
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
    imageBrowse: root.querySelector("#edit-image-browse"),
    imageMeta: root.querySelector("#edit-image-meta"),
    workspace: root.querySelector("#edit-workspace"),
    canvas: root.querySelector("#edit-page"),
    layer: root.querySelector("#edit-layer"),
    prev: root.querySelector("#edit-prev"),
    next: root.querySelector("#edit-next"),
    count: root.querySelector("#edit-count"),
    text: root.querySelector("#edit-text"),
    textSize: root.querySelector("#edit-text-size"),
    textColor: root.querySelector("#edit-text-color"),
    textBold: root.querySelector("#edit-text-bold"),
    penColor: root.querySelector("#edit-pen-color"),
    penWeight: root.querySelector("#edit-pen-weight"),
    fillOn: root.querySelector("#edit-fill-on"),
    fillColor: root.querySelector("#edit-fill-color"),
    strokeColor: root.querySelector("#edit-stroke-color"),
    strokeWidth: root.querySelector("#edit-stroke-width"),
    undo: root.querySelector("#edit-undo"),
    remove: root.querySelector("#edit-delete"),
    save: root.querySelector("#edit-save"),
    clear: root.querySelector("#edit-clear")
  };
}
