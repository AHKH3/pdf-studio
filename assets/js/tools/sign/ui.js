const CSS = `
.sign-root { max-width: 100%; }
.sign-board-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.sign-board {
  position: relative;
  display: inline-block;
  max-width: 100%;
  padding: var(--space-3);
  background: var(--sheet-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-pad);
}
.sign-board canvas {
  display: block;
  max-width: 100%;
  height: auto;
  background: var(--sheet);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
}
.sign-layer {
  position: absolute;
  inset: 12px;
  direction: ltr;
  touch-action: none;
}
.sign-stamp {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
  outline: 1px solid transparent;
  transition: outline 0.15s ease;
}
.sign-stamp.is-selected {
  outline: 2px solid var(--act);
  outline-offset: 1px;
  z-index: 2;
}
.sign-stamp:focus-visible {
  outline: 2px solid var(--act);
  outline-offset: 2px;
}
.sign-stamp img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}
.sign-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--act);
  border: 2px solid var(--sheet);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  z-index: 3;
}
.sign-handle[data-handle="nw"] { top: -6px; left: -6px; cursor: nwse-resize; }
.sign-handle[data-handle="ne"] { top: -6px; right: -6px; cursor: nesw-resize; }
.sign-handle[data-handle="sw"] { bottom: -6px; left: -6px; cursor: nesw-resize; }
.sign-handle[data-handle="se"] { bottom: -6px; right: -6px; cursor: nwse-resize; }
.sign-stamp:not(.is-selected) .sign-handle { display: none; }
.sign-pad {
  display: block;
  width: 100%;
  height: 156px;
  touch-action: none;
  cursor: crosshair;
  background: var(--sheet);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
}
.sign-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 180px;
  overflow: auto;
}
.sign-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font: inherit;
  color: var(--ink);
  background: var(--sheet);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: start;
  transition: all var(--motion-fast) var(--ease-smooth);
}
.sign-list__item:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}
.sign-list__item.is-current {
  border-color: var(--act);
  background: var(--act-soft);
  color: var(--act);
}
.sign-list__empty {
  margin: 0;
  font-size: var(--t-sm);
  color: var(--ink-3);
}
.sign-color-dot {
  width: 12px;
  height: 12px;
  display: inline-block;
  border-radius: 50%;
  margin-inline-start: 6px;
  border: 1px solid var(--rule);
  vertical-align: middle;
}
@media (prefers-reduced-motion: reduce) {
  .sign-stamp { transition: none; }
}
`;

export const STYLE_ID = "pdf-studio-sign-styles";

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

/** @param {HTMLElement} root */
export function buildUi(root) {
  root.classList.add("sign-root");
  root.innerHTML = `
    <div class="view__head">
      <h2 class="view__title" id="sign-title" tabindex="-1">توقيع</h2>
      <p class="view__lede">ارسم أو اكتب أو ضع صورة/تاريخ. مسطّح محلي.</p>
    </div>

    <div class="view__body">
      <div id="sign-drop" class="intake" data-kind="pdf">
        ${icon("icon-file")}
        <span class="intake__title">أسقط ملف PDF هنا</span>
        <span class="intake__hint">ملف واحد · التوقيع يُدمج في الصفحة ولا يملأ حقول الاستمارات</span>
        <button id="sign-browse" type="button" class="btn">تصفّح</button>
      </div>
      <input id="sign-input" type="file" accept="application/pdf,.pdf" hidden />

      <div id="sign-workspace" class="scan" hidden>
        <div class="scan__stage">
          <div class="scan__pager">
            <button id="sign-prev" type="button" class="btn btn--compact">
              ${icon("icon-arrow")} السابقة
            </button>
            <span class="scan__count num" id="sign-count">1 / 1</span>
            <button id="sign-next" type="button" class="btn btn--compact">
              التالية <svg class="icon flip" aria-hidden="true"><use href="#icon-arrow"></use></svg>
            </button>
          </div>
          <span class="preview__label">اسحب الختم لنقله · الزوايا تغيّر الحجم · Delete يحذف المحدد</span>
          <div class="sign-board-wrap">
            <div class="sign-board" id="sign-board">
              <canvas id="sign-page" width="360" height="509" aria-label="معاينة الصفحة مع الأختام"></canvas>
              <div id="sign-layer" class="sign-layer"></div>
            </div>
          </div>
        </div>

        <aside class="scan__panel">
          <div class="panel-block">
            <h3 class="panel-block__title">الأداة</h3>
            <div class="choice-grid" role="radiogroup" aria-label="نوع الختم">
              <label class="choice"><input type="radio" name="sign-tool" value="draw" checked /><span>رسم</span></label>
              <label class="choice"><input type="radio" name="sign-tool" value="name" /><span>اسم</span></label>
              <label class="choice"><input type="radio" name="sign-tool" value="image" /><span>صورة</span></label>
              <label class="choice"><input type="radio" name="sign-tool" value="date" /><span>التاريخ</span></label>
            </div>
          </div>

          <div class="panel-block" data-sign-panel="draw">
            <h3 class="panel-block__title">لوحة الرسم</h3>
            <p class="panel-block__meta">ارسم بإصبعك أو بالفأرة. الخلفية شفافة عند الحفظ.</p>
            <canvas id="sign-pad" class="sign-pad" width="268" height="156" aria-label="لوحة رسم التوقيع"></canvas>
            <div class="choice-grid" role="radiogroup" aria-label="لون الحبر" style="margin-top:10px">
              <label class="choice"><input type="radio" name="sign-ink" value="#141c17" checked /><span>أسود</span></label>
              <label class="choice"><input type="radio" name="sign-ink" value="#1d3f8f" /><span>أزرق</span></label>
              <label class="choice"><input type="radio" name="sign-ink" value="#c33418" /><span>أحمر</span></label>
            </div>
            <div class="field" style="margin-top:10px">
              <label for="sign-weight">سُمك الخط</label>
              <select id="sign-weight">
                <option value="1.6">رفيع</option>
                <option value="2.4" selected>متوسط</option>
                <option value="3.6">سميك</option>
              </select>
            </div>
            <button id="sign-pad-clear" type="button" class="btn btn--wide" style="margin-top:8px">
              ${icon("icon-close")} امسح
            </button>
          </div>

          <div class="panel-block" data-sign-panel="name" hidden>
            <h3 class="panel-block__title">الاسم أو النص</h3>
            <div class="field field--wide">
              <label for="sign-name">النص</label>
              <input id="sign-name" type="text" maxlength="80" placeholder="الاسم الثلاثي" autocomplete="name" />
            </div>
            <div class="field">
              <label for="sign-name-color">اللون</label>
              <input id="sign-name-color" type="color" value="#141c17" />
            </div>
            <div class="field">
              <label for="sign-name-size">الحجم</label>
              <input id="sign-name-size" type="number" min="14" max="72" value="28" />
            </div>
          </div>

          <div class="panel-block" data-sign-panel="image" hidden>
            <h3 class="panel-block__title">صورة أو شعار</h3>
            <p class="panel-block__meta" id="sign-image-meta">PNG أو JPG بخلفية شفافة أفضل للختم.</p>
            <button id="sign-image-browse" type="button" class="btn btn--wide">
              ${icon("icon-upload")} صورة
            </button>
            <input id="sign-image-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden />
          </div>

          <div class="panel-block" data-sign-panel="date" hidden>
            <h3 class="panel-block__title">ختم التاريخ</h3>
            <div class="field">
              <label for="sign-date">اليوم</label>
              <input id="sign-date" type="date" />
            </div>
            <div class="field">
              <label for="sign-date-format">الشكل</label>
              <select id="sign-date-format">
                <option value="ar" selected>عربي طويل</option>
                <option value="iso">سنة/شهر/يوم</option>
                <option value="eu">يوم-شهر-سنة</option>
              </select>
            </div>
            <div class="field">
              <label for="sign-date-color">اللون</label>
              <input id="sign-date-color" type="color" value="#453391" />
            </div>
          </div>

          <div class="panel-block">
            <h3 class="panel-block__title">الوضع على الصفحة</h3>
            <label class="check">
              <input id="sign-all-pages" type="checkbox" />
              ضعها على كل الصفحات
            </label>
            <button id="sign-place" type="button" class="btn btn--wide">
              ${icon("icon-plus")} ضع
            </button>
          </div>

          <div class="panel-block">
            <h3 class="panel-block__title">أختام هذه الصفحة</h3>
            <div id="sign-list" class="sign-list"></div>
            <div class="btn-row" style="margin-top:10px">
              <button id="sign-copy-all" type="button" class="btn">نسخ</button>
              <button id="sign-delete" type="button" class="btn">حذف</button>
            </div>
          </div>

          <div class="panel-block">
            <p class="note" style="margin-bottom:12px">
              الناتج PDF مسطّح: الأختام تُرسم فوق الصفحة. هذه الأداة لا تملأ حقول AcroForm.
              مجانية، بلا حد صفحات، والملف لا يغادر الجهاز.
            </p>
            <button id="sign-save" type="button" class="btn btn--act btn--wide">توقيع</button>
            <button id="sign-clear" type="button" class="btn btn--wide" style="margin-top:8px">
              ${icon("icon-close")} إغلاق
            </button>
          </div>
        </aside>
      </div>
    </div>
  `;

  const intakeGlyph = root.querySelector("#sign-drop .icon");
  if (intakeGlyph) intakeGlyph.classList.add("intake__glyph");

  return {
    drop: root.querySelector("#sign-drop"),
    browse: root.querySelector("#sign-browse"),
    input: root.querySelector("#sign-input"),
    workspace: root.querySelector("#sign-workspace"),
    canvas: root.querySelector("#sign-page"),
    layer: root.querySelector("#sign-layer"),
    prev: root.querySelector("#sign-prev"),
    next: root.querySelector("#sign-next"),
    count: root.querySelector("#sign-count"),
    pad: root.querySelector("#sign-pad"),
    padClear: root.querySelector("#sign-pad-clear"),
    name: root.querySelector("#sign-name"),
    nameColor: root.querySelector("#sign-name-color"),
    nameSize: root.querySelector("#sign-name-size"),
    imageBrowse: root.querySelector("#sign-image-browse"),
    imageInput: root.querySelector("#sign-image-input"),
    imageMeta: root.querySelector("#sign-image-meta"),
    date: root.querySelector("#sign-date"),
    dateFormat: root.querySelector("#sign-date-format"),
    dateColor: root.querySelector("#sign-date-color"),
    allPages: root.querySelector("#sign-all-pages"),
    place: root.querySelector("#sign-place"),
    list: root.querySelector("#sign-list"),
    copyAll: root.querySelector("#sign-copy-all"),
    remove: root.querySelector("#sign-delete"),
    save: root.querySelector("#sign-save"),
    clear: root.querySelector("#sign-clear"),
    weight: root.querySelector("#sign-weight")
  };
}

export function todayInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * @param {string} iso
 * @param {"ar" | "iso" | "eu"} format
 */
export function formatStampDate(iso, format) {
  const date = iso ? new Date(`${iso}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  if (format === "iso") {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  }
  if (format === "eu") {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${d}-${m}-${y}`;
  }
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}
