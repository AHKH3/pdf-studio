const CSS = `
.edit-root { display: flex; flex-direction: column; gap: 0; min-height: 0; }
.edit-root .view__head { margin-bottom: 12px; }

/* ——— hero drop ——— */
#edit-drop.intake {
  min-height: 280px;
  border: 1.5px dashed var(--border-strong);
  background: var(--surface-1);
  border-radius: var(--radius-xl);
}
#edit-drop .intake__title { font-size: 1.05rem; font-weight: 700; }
#edit-drop .intake__hint { max-width: 36ch; text-wrap: balance; line-height: 1.5; }

/* ——— layout: stage + panel ——— */
.edit-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) 320px;
  gap: 16px;
  align-items: start;
  min-height: 0;
}
.edit-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  padding: 12px;
  box-shadow: var(--shadow-soft);
}
.edit-stage__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.edit-stage__hint {
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-pill);
  padding: 6px 10px;
  line-height: 1.3;
}
.edit-stage__zoom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.edit-stage__zoom .btn { min-width: 32px; height: 32px; padding: 0 8px; }
.edit-board-wrap {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 420px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  overflow: auto;
  padding: 18px;
}
.edit-board {
  position: relative;
  display: inline-block;
  background: #fff;
  border: 1px solid rgba(15,23,42,0.12);
  box-shadow: 0 8px 28px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.08);
  border-radius: 6px;
  overflow: visible;
}
.edit-board canvas {
  display: block;
  max-width: none;
  height: auto;
  background: #fff;
  border-radius: 4px;
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
  font-family: "Noto Naskh Arabic", "Playfair Display", serif;
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
  padding: 6px 8px;
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
}
.edit-obj__text {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 6px 8px;
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

/* ——— panel ——— */
.edit-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  padding-right: 2px;
}
.edit-panel::-webkit-scrollbar { width: 6px; }
.edit-panel::-webkit-scrollbar-thumb { background: var(--border-soft); border-radius: 999px; }
.edit-toolbar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.edit-toolbar .choice span {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
}
.edit-toolbar .choice span .icon { width: 16px; height: 16px; }
.edit-toolbar .choice input:checked + span {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.edit-layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  padding: 8px;
  background: var(--surface-1);
}
.edit-layers:empty::before {
  content: "لا عناصر بعد — اضغط على الصفحة لإضافة نص أو شكل";
  font-size: 0.76rem;
  color: var(--text-muted);
  text-align: center;
  padding: 12px;
}
.edit-layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--surface-0, #fff);
  cursor: pointer;
  font-size: 0.78rem;
  transition: border-color .15s, background .15s;
}
.edit-layer-row.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.edit-layer-row .icon { width: 14px; height: 14px; flex: none; }
.edit-layer-row__name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: start; }
.edit-layer-row__del { width: 26px; height: 26px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-muted); border-radius: 6px; cursor: pointer; }
.edit-layer-row__del:hover { background: var(--danger-soft, rgba(220,38,38,0.10)); color: var(--danger, #dc2626); }

@media (max-width: 1080px) {
  .edit-workspace { grid-template-columns: 1fr; }
  .edit-panel { max-height: none; }
  .edit-board-wrap { min-height: 360px; }
}
@media (max-width: 640px) {
  .edit-stage { padding: 10px; }
  .edit-stage__bar { flex-direction: column; align-items: stretch; }
  .edit-toolbar { grid-template-columns: repeat(4, 1fr); }
  .edit-board-wrap { padding: 10px; min-height: 300px; }
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

function icon(href) {
  return `<svg class="icon" aria-hidden="true"><use href="#${href}"></use></svg>`;
}

function choice(name, value, label, iconHref, checked = false) {
  const ic = iconHref ? icon(iconHref) : "";
  return `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} /><span>${ic}<span>${label}</span></span></label>`;
}

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("edit-root");
  root.innerHTML = `
    <div class="view__head">
      <h2 class="view__title" id="edit-title" tabindex="-1">تحرير</h2>
      <p class="view__lede">أضف نصاً، قلماً، أشكالاً وصوراً فوق الصفحة. الناتج يُدمج محلياً — النص الأصلي لا يُعدَّل.</p>
    </div>

    <div class="view__body">
      <div id="edit-drop" class="intake" data-kind="pdf">
        ${icon("icon-file")}
        <span class="intake__title">أسقط ملف PDF هنا</span>
        <span class="intake__hint">ملف واحد · اسحب PDF ثم اضغط على الصفحة لإضافة عناصر. كل الإضافات طبقة فوق الصفحة الأصلية.</span>
        <button id="edit-browse" type="button" class="btn">تصفّح</button>
      </div>
      <input id="edit-input" type="file" accept="application/pdf,.pdf" hidden />
      <input id="edit-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />

      <div id="edit-workspace" class="edit-workspace" hidden>
        <div class="edit-stage">
          <div class="edit-stage__bar">
            <div class="scan__pager" style="margin:0">
              <button id="edit-prev" type="button" class="btn btn--compact">
                ${icon("icon-arrow")} السابقة
              </button>
              <span class="scan__count num" id="edit-count">1 / 1</span>
              <button id="edit-next" type="button" class="btn btn--compact">
                التالية <svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg>
              </button>
            </div>
            <div class="edit-stage__zoom">
              <button id="edit-zoom-out" type="button" class="btn btn--compact" aria-label="تصغير">${icon("icon-rotate")} -</button>
              <span class="num" id="edit-zoom-label" style="min-width:3.5ch;text-align:center;font-size:0.78rem">100%</span>
              <button id="edit-zoom-in" type="button" class="btn btn--compact" aria-label="تكبير">${icon("icon-plus")} +</button>
              <button id="edit-zoom-fit" type="button" class="btn btn--compact">${icon("icon-crop")} ملء</button>
            </div>
          </div>

          <div class="edit-board-wrap" id="edit-wrap">
            <div class="edit-board" id="edit-board">
              <canvas id="edit-page" width="794" height="1123" aria-label="معاينة الصفحة مع التحرير"></canvas>
              <div id="edit-layer" class="edit-layer" data-tool="select"></div>
            </div>
          </div>
          <div class="edit-stage__hint">💡 اضغط على الصفحة لإضافة العنصر المختار · اسحب الزوايا للحجم · المقبض العلوي للتدوير · <kbd>Delete</kbd> يحذف · <kbd>Ctrl+Z</kbd> تراجع</div>
        </div>

        <aside class="edit-panel">
          <div class="panel-block">
            <h3 class="panel-block__title">الأداة</h3>
            <div class="edit-toolbar" role="radiogroup" aria-label="أداة التحرير">
              ${choice("edit-tool", "select", "تحديد", "icon-quad", true)}
              ${choice("edit-tool", "text", "نص", "icon-file")}
              ${choice("edit-tool", "pen", "قلم", "icon-sign")}
              ${choice("edit-tool", "rect", "مربع", "icon-crop")}
              ${choice("edit-tool", "ellipse", "دائرة", "icon-contrast")}
              ${choice("edit-tool", "triangle", "مثلث", "icon-alert")}
              ${choice("edit-tool", "image", "صورة", "icon-images")}
            </div>
            <div class="btn-row" style="margin-top:10px">
              <button id="edit-undo" type="button" class="btn" style="flex:1">${icon("icon-rotate")} تراجع</button>
              <button id="edit-delete" type="button" class="btn" style="flex:1">${icon("icon-trash")} حذف</button>
            </div>
          </div>

          <div class="panel-block">
            <h3 class="panel-block__title">الطبقات</h3>
            <div id="edit-layers" class="edit-layers" aria-label="قائمة الطبقات"></div>
          </div>

          <div class="panel-block" data-edit-panel="text" hidden>
            <h3 class="panel-block__title">النص</h3>
            <div class="field field--wide">
              <label for="edit-text">المحتوى</label>
              <textarea id="edit-text" rows="3" maxlength="2000" placeholder="اكتب هنا — يظهر فوراً على الصفحة"></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div class="field">
                <label for="edit-text-size">الحجم</label>
                <input id="edit-text-size" type="number" min="10" max="96" value="18" />
              </div>
              <div class="field">
                <label for="edit-text-color">اللون</label>
                <input id="edit-text-color" type="color" value="#1E3A8A" />
              </div>
            </div>
            <label class="check" style="margin-top:6px">
              <input id="edit-text-bold" type="checkbox" />
              عريض
            </label>
            <div class="field field--wide" style="margin-top:8px">
              <span id="edit-align-label">المحاذاة</span>
              <div class="choice-grid" role="radiogroup" aria-labelledby="edit-align-label">
                ${choice("edit-align", "right", "يمين", null, true)}
                ${choice("edit-align", "center", "وسط", null, false)}
                ${choice("edit-align", "left", "يسار", null, false)}
              </div>
            </div>
          </div>

          <div class="panel-block" data-edit-panel="pen" hidden>
            <h3 class="panel-block__title">القلم الحر</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
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
            <p class="panel-block__meta" style="margin-top:8px">اسحب على الصفحة للرسم. كل شوط رسم يُحفظ كطبقة.</p>
          </div>

          <div class="panel-block" data-edit-panel="shape" hidden>
            <h3 class="panel-block__title">الشكل</h3>
            <label class="check">
              <input id="edit-fill-on" type="checkbox" checked />
              تعبئة
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
              <div class="field">
                <label for="edit-fill-color">لون التعبئة</label>
                <input id="edit-fill-color" type="color" value="#8AA4E0" />
              </div>
              <div class="field">
                <label for="edit-stroke-color">لون الحد</label>
                <input id="edit-stroke-color" type="color" value="#1E3A8A" />
              </div>
            </div>
            <div class="field" style="margin-top:8px">
              <label for="edit-stroke-width">سُمك الحد</label>
              <input id="edit-stroke-width" type="number" min="0" max="24" step="0.5" value="1.5" />
            </div>
          </div>

          <div class="panel-block" data-edit-panel="image" hidden>
            <h3 class="panel-block__title">الصورة</h3>
            <p class="panel-block__meta" id="edit-image-meta">PNG أو JPG أو WEBP — تُضاف في الوسط ويمكن سحب زواياها.</p>
            <button id="edit-image-browse" type="button" class="btn btn--wide">
              ${icon("icon-upload")} اختيار صورة
            </button>
          </div>

          <div class="panel-block" style="background:var(--surface-2);border-style:dashed">
            <p class="note" style="margin:0;background:transparent;border:0;padding:0;box-shadow:none">
              <strong>الناتج PDF مسطّح:</strong> العناصر تُرسم فوق الصفحة الأصلية. لا يُعدَّل النص داخل الملف نفسه — إن أردت تعديل نص موجود، غطّه بمستطيل أبيض ثم أضف نصاً جديداً فوقه.
            </p>
          </div>

          <div class="panel-block" style="padding:0;border:0;background:transparent;box-shadow:none">
            <button id="edit-save" type="button" class="btn btn--act btn--wide" style="height:44px;font-size:0.92rem">حفظ التحرير — دمج الطبقات</button>
            <button id="edit-clear" type="button" class="btn btn--wide" style="margin-top:8px">
              ${icon("icon-close")} إغلاق المستند
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
    wrap: root.querySelector("#edit-wrap"),
    prev: root.querySelector("#edit-prev"),
    next: root.querySelector("#edit-next"),
    count: root.querySelector("#edit-count"),
    zoomIn: root.querySelector("#edit-zoom-in"),
    zoomOut: root.querySelector("#edit-zoom-out"),
    zoomFit: root.querySelector("#edit-zoom-fit"),
    zoomLabel: root.querySelector("#edit-zoom-label"),
    layers: root.querySelector("#edit-layers"),
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
