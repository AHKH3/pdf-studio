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

/**
 * Lets the browser paint between heavy steps.
 * في وضع الاختبار الخلفي (نافذة مخفية) قد لا يطلق requestAnimationFrame
 * أبدًا، فنتسلح بمهلة احتياطية حتى لا يعلق التحميل — وفي الوضع المرئي
 * يفوز rAF كالمعتاد ولا يتغير أي سلوك.
 */
export function yieldToUi() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    } catch {
      finish();
    }
    setTimeout(finish, 100);
  });
}

/**
 * Frees a canvas' GPU bitmap immediately (AHK-63 memory guard).
 * Setting width/height releases the backing store; removing the node
 * drops the last reference so long sessions do not leak.
 * @param {HTMLCanvasElement | null | undefined} canvas
 */
export function disposeCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
  } catch {
    /* never throw from cleanup */
  }
}
