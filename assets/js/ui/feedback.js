import { el } from "../dom.js";
import { isDialogOpen } from "./dialog.js";

/** @type {{ cancelled: boolean; controller: AbortController | null; depth: number; focus: HTMLElement | null }} */
const run = { cancelled: false, controller: null, depth: 0, focus: null };

const MAX_TOASTS = 4;

export function initFeedback() {
  const cancel = el("progress-cancel");
  cancel?.addEventListener("click", requestCancel);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (isDialogOpen()) return;
    if (!el("progress")?.classList.contains("is-open")) return;
    event.preventDefault();
    requestCancel();
  });
}

function requestCancel() {
  run.cancelled = true;
  run.controller?.abort();
  updateProgress({ title: "جارٍ الإيقاف", desc: "نتوقف عند أقرب خطوة آمنة." });
  const cancel = /** @type {HTMLButtonElement | null} */ (el("progress-cancel"));
  if (cancel) cancel.disabled = true;
}

const TOAST_ICON = { done: "icon-check", error: "icon-alert", info: "icon-file" };

/**
 * @param {string} message
 * @param {"done" | "error" | "info"} [kind]
 */
export function toast(message, kind = "done") {
  const host = el("toasts");
  if (!host || !message) return;

  while (host.children.length >= MAX_TOASTS) host.firstElementChild?.remove();

  const node = document.createElement("div");
  node.className = `toast toast--${kind}`;
  node.setAttribute("role", kind === "error" ? "alert" : "status");
  node.style.pointerEvents = "auto";
  node.style.cursor = "pointer";
  node.title = "إخفاء";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${TOAST_ICON[kind]}`);
  svg.append(use);

  const text = document.createElement("span");
  text.textContent = message;
  node.append(svg, text);
  host.append(node);

  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 300);
  };
  node.addEventListener("click", dismiss);
  setTimeout(dismiss, kind === "error" ? 5600 : 3400);
}

export function isCancelled() {
  return run.cancelled || run.controller?.signal.aborted === true;
}

export function cancelledError() {
  const error = new Error("cancelled");
  error.name = "CancelledError";
  return error;
}

/** Throws when the user pressed stop, so callers can bail out of a loop. */
export function throwIfCancelled() {
  if (isCancelled()) throw cancelledError();
}

/** @param {unknown} error */
export function isCancellation(error) {
  return error instanceof Error && error.name === "CancelledError";
}

function trapProgressTab(event) {
  if (event.key !== "Tab") return;
  const host = el("progress");
  if (!host?.classList.contains("is-open")) return;
  const card = host.querySelector(".progress__card");
  if (!card) return;
  const list = Array.from(card.querySelectorAll("button")).filter((node) => !node.disabled && !node.hidden);
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
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.desc]
 * @param {boolean} [options.cancellable]
 */
export function startProgress(options = {}) {
  run.cancelled = false;
  run.controller = new AbortController();
  run.depth += 1;
  if (run.depth === 1) {
    run.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  const host = el("progress");
  if (!host) return run.controller.signal;

  host.classList.add("is-open");
  host.setAttribute("aria-hidden", "false");
  host.setAttribute("aria-busy", "true");
  host.setAttribute("aria-valuemin", "0");
  host.setAttribute("aria-valuemax", "100");
  host.setAttribute("aria-valuenow", "0");
  host.addEventListener("keydown", trapProgressTab);

  const cancel = /** @type {HTMLButtonElement | null} */ (el("progress-cancel"));
  if (cancel) {
    cancel.hidden = options.cancellable === false;
    cancel.disabled = false;
  }

  updateProgress({
    title: options.title || "قيد التنفيذ",
    desc: options.desc || "يرجى الانتظار.",
    percent: 0,
    detail: ""
  });

  requestAnimationFrame(() => {
    if (cancel && !cancel.hidden) cancel.focus({ preventScroll: true });
  });

  return run.controller.signal;
}

/**
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.desc]
 * @param {number} [options.percent]
 * @param {string} [options.detail]
 */
export function updateProgress(options = {}) {
  const titleEl = el("progress-title");
  if (titleEl && options.title != null) titleEl.textContent = options.title;
  const descEl = el("progress-desc");
  if (descEl && options.desc != null) descEl.textContent = options.desc;

  const detail = el("progress-detail");
  if (detail && options.detail !== undefined) {
    detail.textContent = options.detail || "";
    detail.hidden = !options.detail;
  }

  if (typeof options.percent === "number") {
    const pct = Math.max(0, Math.min(100, Math.round(options.percent)));
    const bar = el("progress-bar");
    if (bar) bar.style.width = `${pct}%`;
    const label = el("progress-pct");
    if (label) label.textContent = `${pct}%`;
    hostBusy(pct);
  }
}

function hostBusy(pct) {
  const host = el("progress");
  if (host) host.setAttribute("aria-valuenow", String(pct));
}

export function endProgress() {
  run.depth = Math.max(0, run.depth - 1);
  if (run.depth > 0) return;

  const host = el("progress");
  if (host) {
    host.classList.remove("is-open");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("aria-busy", "false");
    host.removeEventListener("keydown", trapProgressTab);
  }
  run.controller = null;
  run.cancelled = false;
  const restore = run.focus;
  run.focus = null;
  restore?.focus?.({ preventScroll: true });
}

/**
 * Runs a job behind the progress overlay and always tears it down.
 * @template T
 * @param {{ title: string; desc?: string; cancellable?: boolean }} options
 * @param {(report: (update: Parameters<typeof updateProgress>[0]) => void) => Promise<T>} job
 * @returns {Promise<T | undefined>}
 */
export async function withProgress(options, job) {
  startProgress(options);
  try {
    return await job(updateProgress);
  } finally {
    endProgress();
  }
}
