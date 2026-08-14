/**
 * Modal confirm / password prompts built from the existing progress overlay
 * vocabulary. No new element ids — check-syntax only allows el() lookups that
 * already exist in index.html.
 */

let stack = 0;
let previousFocus = null;

export function isDialogOpen() {
  return stack > 0;
}

function trapFocus(root, event) {
  if (event.key !== "Tab") return;
  const focusable = root.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
  const list = Array.from(focusable).filter((node) => !node.disabled && node.offsetParent !== null);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} spec.desc
 * @param {HTMLElement[]} spec.body
 * @param {HTMLElement[]} spec.actions
 * @param {() => void} spec.onEscape
 * @param {HTMLElement} [spec.focus]
 */
function openOverlay(spec) {
  stack += 1;
  if (stack === 1) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement("div");
  host.className = "progress is-open";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  host.setAttribute("aria-labelledby", spec.titleId);
  host.setAttribute("aria-describedby", spec.descId);

  const card = document.createElement("div");
  card.className = "progress__card";

  const title = document.createElement("h2");
  title.className = "progress__title";
  title.id = spec.titleId;
  title.textContent = spec.title;

  const desc = document.createElement("p");
  desc.className = "progress__desc";
  desc.id = spec.descId;
  desc.textContent = spec.desc;

  const foot = document.createElement("div");
  foot.className = "progress__foot";
  for (const action of spec.actions) foot.append(action);

  card.append(title, desc, ...spec.body, foot);
  host.append(card);
  document.body.append(host);

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      spec.onEscape();
      return;
    }
    trapFocus(card, event);
  };
  host.addEventListener("keydown", onKey);
  host.addEventListener("click", (event) => {
    if (event.target === host) spec.onEscape();
  });

  requestAnimationFrame(() => (spec.focus ?? spec.actions[0])?.focus?.());

  return () => {
    host.removeEventListener("keydown", onKey);
    host.remove();
    stack = Math.max(0, stack - 1);
    if (stack === 0) {
      previousFocus?.focus?.({ preventScroll: true });
      previousFocus = null;
    }
  };
}

let dialogSeq = 0;
const nextId = (slot) => `dlg-${slot}-${(dialogSeq += 1)}`;

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.desc
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @returns {Promise<boolean>}
 */
export function confirmAction(options) {
  return new Promise((resolve) => {
    const titleId = nextId("t");
    const descId = nextId("d");
    let closed = false;

    const finish = (value) => {
      if (closed) return;
      closed = true;
      close();
      resolve(value);
    };

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--quiet";
    cancel.textContent = options.cancelLabel || "رجوع";
    cancel.addEventListener("click", () => finish(false));

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn--act";
    confirm.textContent = options.confirmLabel || "متابعة";
    confirm.addEventListener("click", () => finish(true));

    const close = openOverlay({
      titleId,
      descId,
      title: options.title,
      desc: options.desc,
      body: [],
      actions: [cancel, confirm],
      onEscape: () => finish(false),
      focus: confirm
    });
  });
}

export function confirmLeave(toolName) {
  return confirmAction({
    title: "عمل غير محفوظ",
    desc: `لم يُحفظ ناتج «${toolName}» بعد. المتابعة تُبقي الملفات في الأداة حتى تفرّغها.`,
    confirmLabel: "متابعة",
    cancelLabel: "البقاء هنا"
  });
}

export function confirmDiscard(toolName) {
  return confirmAction({
    title: "إغلاق العمل؟",
    desc: `سيتم إفراغ «${toolName}» والملفات المحمّلة. لم يُحفظ الناتج بعد.`,
    confirmLabel: "إغلاق",
    cancelLabel: "بقاء"
  });
}

export function confirmReplace(fileName) {
  return confirmAction({
    title: "استبدال الملف؟",
    desc: `سيتم إغلاق «${fileName}» واستبداله بالملف الجديد.`,
    confirmLabel: "استبدال",
    cancelLabel: "إبقاء"
  });
}

export async function confirmLargeDocument(pageCount, verb, threshold) {
  if (pageCount < threshold) return true;
  return confirmAction({
    title: "مستند كبير",
    desc: `هذا المستند فيه ${pageCount} صفحة. ${verb} قد يستغرق وقتاً ويستهلك ذاكرة الجهاز.`,
    confirmLabel: "متابعة",
    cancelLabel: "رجوع"
  });
}

/**
 * @param {{ retry?: boolean; fileName?: string }} [options]
 * @returns {Promise<string | null>}
 */
export function promptPassword(options = {}) {
  return new Promise((resolve) => {
    const titleId = nextId("t");
    const descId = nextId("d");
    let closed = false;

    const field = document.createElement("div");
    field.className = "field field--wide";
    field.style.marginTop = "14px";

    const label = document.createElement("label");
    const inputId = nextId("pw");
    label.setAttribute("for", inputId);
    label.textContent = "كلمة المرور";

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "password";
    input.autocomplete = "off";
    input.dir = "ltr";
    input.spellcheck = false;

    field.append(label, input);

    const finish = (value) => {
      if (closed) return;
      closed = true;
      close();
      resolve(value);
    };

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--quiet";
    cancel.textContent = "إلغاء";
    cancel.addEventListener("click", () => finish(null));

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn btn--act";
    submit.textContent = "فتح";
    submit.addEventListener("click", () => finish(input.value));

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value);
      }
    });

    const close = openOverlay({
      titleId,
      descId,
      title: "ملف محمي",
      desc: options.retry
        ? "كلمة المرور غير صحيحة. حاول مرة أخرى."
        : options.fileName
          ? `«${options.fileName}» محمي بكلمة مرور.`
          : "هذا الملف محمي بكلمة مرور.",
      body: [field],
      actions: [cancel, submit],
      onEscape: () => finish(null),
      focus: input
    });
  });
}
