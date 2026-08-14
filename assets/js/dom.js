/** @param {string} id */
export const el = (id) => document.getElementById(id);

/** @param {string} selector @param {ParentNode} [scope] */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** @param {string} selector @param {ParentNode} [scope] */
export const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** @param {string} id @param {string} event @param {(e: any) => void} handler */
export function on(id, event, handler) {
  const node = el(id);
  if (node) node.addEventListener(event, handler);
  return node;
}

/** @param {string} id @param {string} text */
export function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

/** @param {string} id @param {boolean} visible */
export function setVisible(id, visible) {
  const node = el(id);
  if (node) node.hidden = !visible;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Lets the browser paint between heavy steps. */
export function yieldToUi() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
