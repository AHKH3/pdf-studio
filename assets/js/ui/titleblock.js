import { el } from "../dom.js";

/**
 * The title block is both the app's status line and its only primary action.
 * Tools describe what they will produce; nothing else writes to it.
 */

const STATE_TEXT = {
  idle: "جاهز",
  waiting: "بانتظار ملف",
  busy: "قيد التنفيذ",
  done: "تم",
  error: "توقف"
};

/** @type {null | (() => void | Promise<void>)} */
let runHandler = null;
let running = false;

/** مستمعون لإعادة رسم شريط التابات عند تغيّر حالة الأداة النشطة. */
const chromeListeners = new Set();

/** @param {() => void} fn */
export function onChromeChange(fn) {
  chromeListeners.add(fn);
  return () => chromeListeners.delete(fn);
}

function emitChromeChange() {
  for (const fn of chromeListeners) {
    try {
      fn();
    } catch (error) {
      console.error(error);
    }
  }
}

export function initTitleBlock() {
  const button = /** @type {HTMLButtonElement | null} */ (el("tb-run"));
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!runHandler || running) return;
    running = true;
    button.disabled = true;
    try {
      await runHandler();
    } finally {
      running = false;
      button.disabled = !runHandler || button.dataset.wantEnabled !== "true";
    }
  });
}

/**
 * @param {object} config
 * @param {string} config.op
 * @param {string} config.actionLabel
 * @param {string} [config.name]
 * @param {() => void | Promise<void>} [config.onRun]
 */
export function setOperation(config) {
  el("tb-op").textContent = config.op;
  el("tb-run-label").textContent = config.actionLabel;
  runHandler = config.onRun ?? null;

  const input = /** @type {HTMLInputElement} */ (el("tb-name"));
  input.value = config.name ?? "";
  input.disabled = !config.onRun;
  input.placeholder = config.onRun ? "" : "—";

  setSource({});
  setState(config.onRun ? "waiting" : "idle");
  setRunEnabled(false);
}

/**
 * @param {object} source
 * @param {string} [source.label]
 * @param {string} [source.pages]
 * @param {string} [source.size]
 */
export function setSource(source = {}) {
  el("tb-source").textContent = source.label || "—";
  el("tb-pages").textContent = source.pages || "—";
  el("tb-size").textContent = source.size || "—";
  emitChromeChange();
}

/**
 * @param {keyof typeof STATE_TEXT} state
 * @param {string} [text]
 */
export function setState(state, text) {
  el("tb-state-cell").dataset.state = state === "waiting" ? "idle" : state;
  el("tb-state").textContent = text || STATE_TEXT[state] || STATE_TEXT.idle;
  emitChromeChange();
}

/** @param {boolean} enabled */
export function setRunEnabled(enabled) {
  const button = /** @type {HTMLButtonElement} */ (el("tb-run"));
  button.dataset.wantEnabled = String(Boolean(enabled));
  button.disabled = running || !enabled;
  emitChromeChange();
}

/** @param {string} value */
export function setName(value) {
  /** @type {HTMLInputElement} */ (el("tb-name")).value = value;
}

export function getName() {
  return /** @type {HTMLInputElement} */ (el("tb-name")).value.trim();
}
