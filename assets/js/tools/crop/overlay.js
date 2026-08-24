import { clampBox, DEFAULT_BOX, FULL_PAGE } from "./geometry.js";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const STYLE_ID = "pdf-studio-crop-styles";

const STYLE_TEXT = `
#view-crop .crop-stage {
  position: relative;
  display: inline-block;
  direction: ltr;
  max-width: 100%;
  line-height: 0;
  user-select: none;
}
#view-crop .crop-stage canvas {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--rule-strong);
  background: #fff;
}
#view-crop .crop-veil {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
#view-crop .crop-shade {
  position: absolute;
  background: color-mix(in srgb, var(--ink) 46%, transparent);
  pointer-events: auto;
  cursor: crosshair;
  touch-action: none;
}
#view-crop .crop-rect {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--act);
  outline: 1px solid color-mix(in srgb, var(--sheet) 70%, transparent);
  outline-offset: -3px;
  cursor: move;
  pointer-events: auto;
  touch-action: none;
}
#view-crop .crop-rect:focus {
  outline: 2px solid var(--act);
  outline-offset: 3px;
}
#view-crop .crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--sheet);
  border: 2px solid var(--act);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  box-sizing: border-box;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  touch-action: none;
}
#view-crop .crop-handle::after {
  content: "";
  position: absolute;
  inset: -8px;
}
#view-crop .crop-handle[data-handle="nw"] { left: 0; top: 0; cursor: nwse-resize; }
#view-crop .crop-handle[data-handle="n"]  { left: 50%; top: 0; cursor: ns-resize; }
#view-crop .crop-handle[data-handle="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
#view-crop .crop-handle[data-handle="e"]  { left: 100%; top: 50%; cursor: ew-resize; }
#view-crop .crop-handle[data-handle="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
#view-crop .crop-handle[data-handle="s"]  { left: 50%; top: 100%; cursor: ns-resize; }
#view-crop .crop-handle[data-handle="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
#view-crop .crop-handle[data-handle="w"]  { left: 0; top: 50%; cursor: ew-resize; }
#view-crop .btn-row { margin-bottom: 16px; }
@media (prefers-reduced-motion: reduce) {
  #view-crop .crop-rect,
  #view-crop .crop-shade {
    transition: none;
  }
}
`;

export function injectCropStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.append(style);
}

/**
 * Interactive crop rectangle over a page canvas. Coordinates are fractions of
 * the displayed page (origin top-left of the paper, not flipped for RTL).
 */
export class CropOverlay {
  /**
   * @param {HTMLElement} stage
   * @param {{ onChange?: () => void }} [options]
   */
  constructor(stage, options = {}) {
    this.stage = stage;
    this.onChange = options.onChange;
    /** @type {import("./geometry.js").NormBox} */
    this.box = { ...DEFAULT_BOX };
    /** @type {null | { mode: string; handle?: string; startX: number; startY: number; origin: import("./geometry.js").NormBox }} */
    this.drag = null;
    this.listeners = [];

    this.veil = /** @type {HTMLElement} */ (stage.querySelector(".crop-veil"));
    this.rect = /** @type {HTMLElement} */ (stage.querySelector(".crop-rect"));
    this.shades = {
      t: /** @type {HTMLElement} */ (stage.querySelector('[data-shade="t"]')),
      l: /** @type {HTMLElement} */ (stage.querySelector('[data-shade="l"]')),
      r: /** @type {HTMLElement} */ (stage.querySelector('[data-shade="r"]')),
      b: /** @type {HTMLElement} */ (stage.querySelector('[data-shade="b"]'))
    };

    this.ensureHandles();
    this.bind();
    this.render();
  }

  ensureHandles() {
    if (!this.rect) return;
    if (this.rect.querySelector("[data-handle]")) return;
    for (const handle of HANDLES) {
      const node = document.createElement("span");
      node.className = "crop-handle";
      node.dataset.handle = handle;
      node.setAttribute("aria-hidden", "true");
      this.rect.append(node);
    }
  }

  /**
   * @param {string} type
   * @param {EventTarget} target
   * @param {EventListener} handler
   * @param {AddEventListenerOptions} [options]
   */
  listen(type, target, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  bind() {
    if (!this.veil || !this.rect) return;

    this.listen("pointerdown", this.stage, (event) => this.onPointerDown(/** @type {PointerEvent} */ (event)));
    this.listen("pointermove", window, (event) => this.onPointerMove(/** @type {PointerEvent} */ (event)));
    this.listen("pointerup", window, (event) => this.onPointerUp(/** @type {PointerEvent} */ (event)));
    this.listen("pointercancel", window, (event) => this.onPointerUp(/** @type {PointerEvent} */ (event)));
    this.listen("keydown", this.rect, (event) => this.onKey(/** @type {KeyboardEvent} */ (event)));
  }

  /** @param {PointerEvent} event */
  localPoint(event) {
    const bounds = this.stage.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    return {
      x: (event.clientX - bounds.left) / width,
      y: (event.clientY - bounds.top) / height
    };
  }

  /** @param {PointerEvent} event */
  onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.closest?.(".crop-rect, .crop-shade, .crop-handle")) return;
    const handle = target.closest?.("[data-handle]")?.getAttribute("data-handle");
    const onRect = Boolean(target.closest?.(".crop-rect"));
    const point = this.localPoint(event);

    this.drag = {
      mode: handle ? "resize" : onRect ? "move" : "draw",
      handle: handle || undefined,
      startX: point.x,
      startY: point.y,
      origin: { ...this.box }
    };

    this.stage.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  /** @param {PointerEvent} event */
  onPointerMove(event) {
    if (!this.drag) return;
    const point = this.localPoint(event);
    const { mode, handle, startX, startY, origin } = this.drag;
    const dx = point.x - startX;
    const dy = point.y - startY;

    if (mode === "draw") {
      this.box = clampBox({
        left: Math.min(startX, point.x),
        top: Math.min(startY, point.y),
        right: Math.max(startX, point.x),
        bottom: Math.max(startY, point.y)
      });
    } else if (mode === "move") {
      const width = origin.right - origin.left;
      const height = origin.bottom - origin.top;
      let left = origin.left + dx;
      let top = origin.top + dy;
      left = Math.min(Math.max(0, left), 1 - width);
      top = Math.min(Math.max(0, top), 1 - height);
      this.box = { left, top, right: left + width, bottom: top + height };
    } else if (mode === "resize" && handle) {
      this.box = resizeBox(origin, handle, dx, dy);
    }

    this.render();
    this.onChange?.();
  }

  /** @param {PointerEvent} event */
  onPointerUp(event) {
    if (!this.drag) return;
    if (this.stage.hasPointerCapture?.(event.pointerId)) {
      this.stage.releasePointerCapture(event.pointerId);
    }
    if (this.drag.mode === "draw") {
      const width = this.box.right - this.box.left;
      const height = this.box.bottom - this.box.top;
      if (width < 0.03 && height < 0.03) this.box = this.drag.origin;
    }
    this.box = clampBox(this.box);
    this.drag = null;
    this.render();
    this.onChange?.();
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    const step = event.shiftKey ? 0.04 : 0.01;
    const { left, top, right, bottom } = this.box;
    const width = right - left;
    const height = bottom - top;
    let next = { ...this.box };

    switch (event.key) {
      case "ArrowLeft":
        next = event.altKey
          ? { ...next, left: left - step }
          : { left: left - step, right: right - step, top, bottom };
        break;
      case "ArrowRight":
        next = event.altKey
          ? { ...next, right: right + step }
          : { left: left + step, right: right + step, top, bottom };
        break;
      case "ArrowUp":
        next = event.altKey
          ? { ...next, top: top - step }
          : { left, right, top: top - step, bottom: bottom - step };
        break;
      case "ArrowDown":
        next = event.altKey
          ? { ...next, bottom: bottom + step }
          : { left, right, top: top + step, bottom: bottom + step };
        break;
      case "Home":
        next = { ...DEFAULT_BOX };
        break;
      case "End":
        next = { ...FULL_PAGE };
        break;
      default:
        return;
    }

    if (!event.altKey && (event.key.startsWith("Arrow"))) {
      const w = next.right - next.left || width;
      const h = next.bottom - next.top || height;
      next.left = Math.min(Math.max(0, next.left), 1 - w);
      next.top = Math.min(Math.max(0, next.top), 1 - h);
      next.right = next.left + w;
      next.bottom = next.top + h;
    }

    event.preventDefault();
    this.setBox(next);
  }

  /** @param {import("./geometry.js").NormBox} box */
  setBox(box) {
    this.box = clampBox(box);
    this.render();
    this.onChange?.();
  }

  reset(kind = "default") {
    this.setBox(kind === "full" ? FULL_PAGE : DEFAULT_BOX);
  }

  render() {
    const { left, top, right, bottom } = this.box;
    const width = (right - left) * 100;
    const height = (bottom - top) * 100;
    const l = left * 100;
    const t = top * 100;
    const r = right * 100;
    const b = bottom * 100;

    if (this.rect) {
      this.rect.style.left = `${l}%`;
      this.rect.style.top = `${t}%`;
      this.rect.style.width = `${width}%`;
      this.rect.style.height = `${height}%`;
      this.rect.setAttribute(
        "aria-valuetext",
        `عرض من ${Math.round(l)}٪ إلى ${Math.round(r)}٪، طول من ${Math.round(t)}٪ إلى ${Math.round(b)}٪`
      );
    }

    const { t: shadeT, l: shadeL, r: shadeR, b: shadeB } = this.shades;
    if (shadeT) {
      shadeT.style.left = "0";
      shadeT.style.top = "0";
      shadeT.style.width = "100%";
      shadeT.style.height = `${t}%`;
    }
    if (shadeB) {
      shadeB.style.left = "0";
      shadeB.style.top = `${b}%`;
      shadeB.style.width = "100%";
      shadeB.style.height = `${100 - b}%`;
    }
    if (shadeL) {
      shadeL.style.left = "0";
      shadeL.style.top = `${t}%`;
      shadeL.style.width = `${l}%`;
      shadeL.style.height = `${height}%`;
    }
    if (shadeR) {
      shadeR.style.left = `${r}%`;
      shadeR.style.top = `${t}%`;
      shadeR.style.width = `${100 - r}%`;
      shadeR.style.height = `${height}%`;
    }
  }

  dispose() {
    for (const off of this.listeners) off();
    this.listeners = [];
    this.drag = null;
  }
}

/**
 * @param {import("./geometry.js").NormBox} origin
 * @param {string} handle
 * @param {number} dx
 * @param {number} dy
 */
function resizeBox(origin, handle, dx, dy) {
  let { left, top, right, bottom } = origin;
  if (handle.includes("w")) left = origin.left + dx;
  if (handle.includes("e")) right = origin.right + dx;
  if (handle.includes("n")) top = origin.top + dy;
  if (handle.includes("s")) bottom = origin.bottom + dy;
  return clampBox({ left, top, right, bottom });
}

