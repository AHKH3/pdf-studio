import { THEME_STORAGE_KEY } from "../config.js";

const SHEET = "sheet";
const BLUEPRINT = "blueprint";

function desktop() {
  return /** @type {any} */ (globalThis).pdfStudioDesktop;
}

function read() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === SHEET || saved === BLUEPRINT) return saved;
  } catch {
    /* private mode */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? BLUEPRINT : SHEET;
}

function syncWindowChrome() {
  const api = desktop();
  if (!api?.setWindowChrome) return;
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue("--surface-1").trim() || "#F5F1E7";
  const symbol = styles.getPropertyValue("--text-secondary").trim() || "#4E4A3E";
  api.setWindowChrome({ bg, symbol });
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  requestAnimationFrame(syncWindowChrome);
}

function markDesktopShell() {
  const api = desktop();
  if (!api?.isDesktop) return;
  const root = document.documentElement;
  root.classList.add("is-desktop");
  root.dataset.platform = api.platform || "";
}

function wireWindowControls() {
  const api = desktop();
  if (!api?.isDesktop || api.platform === "win32" || api.platform === "darwin") return;
  const min = document.getElementById("win-min");
  const max = document.getElementById("win-max");
  const close = document.getElementById("win-close");
  min?.addEventListener("click", () => api.minimize?.());
  max?.addEventListener("click", () => api.toggleMaximize?.());
  close?.addEventListener("click", () => api.close?.());
}

/** @param {HTMLButtonElement | null} [toggle] */
export function initTheme(toggle) {
  markDesktopShell();
  let current = read();
  apply(current);
  wireWindowControls();
  if (!(toggle instanceof HTMLElement)) return;

  toggle.addEventListener("click", () => {
    current = current === BLUEPRINT ? SHEET : BLUEPRINT;
    apply(current);
    toggle.setAttribute("aria-label", current === BLUEPRINT ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, current);
    } catch {
      /* private mode */
    }
  });
}
