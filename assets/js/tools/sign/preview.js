/**
 * Interactive page board: pdf.js bitmap plus HTML overlays the user can
 * drag and resize. Stamp rectangles are stored in visual PDF space
 * (origin at the bottom-left of the upright page).
 */
import { openDocument } from "../../pdf/core.js";

const HANDLES = ["nw", "ne", "sw", "se"];
const MIN_PT = 22;

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.layer
 * @param {() => Array<any>} options.getStamps
 * @param {() => string} options.getSelectedId
 * @param {(id: string) => void} options.setSelectedId
 * @param {() => void} options.onChange
 */
export function createBoard(options) {
  const { canvas, layer, getStamps, getSelectedId, setSelectedId, onChange } = options;

  /** @type {any} */
  let pdf = null;
  let visualWidth = 0;
  let visualHeight = 0;
  let pageIndex = 0;
  let generation = 0;
  /** @type {null | { pointerId: number; mode: "move" | string; stamp: any }} */
  let drag = null;

  function displayScale() {
    return canvas.offsetWidth / Math.max(1, visualWidth);
  }

  function stampOnPage() {
    return getStamps().filter((stamp) => stamp.pageIndex === pageIndex);
  }

  /** @param {HTMLElement} node @param {any} stamp */
  function positionNode(node, stamp) {
    const scale = displayScale();
    node.style.left = `${stamp.x * scale}px`;
    node.style.top = `${(visualHeight - stamp.y - stamp.height) * scale}px`;
    node.style.width = `${stamp.width * scale}px`;
    node.style.height = `${stamp.height * scale}px`;
  }

  function markSelected() {
    const selected = getSelectedId();
    for (const node of layer.children) {
      const on = /** @type {HTMLElement} */ (node).dataset.id === selected;
      node.classList.toggle("is-selected", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function paintOverlay() {
    layer.replaceChildren();
    layer.style.direction = "ltr";
    const selected = getSelectedId();

    for (const stamp of stampOnPage()) {
      const node = document.createElement("div");
      node.className = "sign-stamp" + (stamp.id === selected ? " is-selected" : "");
      node.dataset.id = stamp.id;
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", stamp.label || "ختم");
      node.setAttribute("aria-selected", stamp.id === selected ? "true" : "false");
      positionNode(node, stamp);

      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.src = stamp.url;
      node.append(img);

      for (const handle of HANDLES) {
        const grip = document.createElement("span");
        grip.className = "sign-handle";
        grip.dataset.handle = handle;
        grip.setAttribute("aria-hidden", "true");
        node.append(grip);
      }

      layer.append(node);
    }
  }

  function clampStamp(stamp) {
    stamp.aspect = stamp.aspect || stamp.width / Math.max(1, stamp.height);
    stamp.width = Math.min(visualWidth, Math.max(MIN_PT, stamp.width));
    stamp.height = stamp.width / Math.max(0.12, stamp.aspect);
    if (stamp.height > visualHeight) {
      stamp.height = visualHeight;
      stamp.width = stamp.height * stamp.aspect;
    }
    stamp.x = Math.min(Math.max(0, stamp.x), Math.max(0, visualWidth - stamp.width));
    stamp.y = Math.min(Math.max(0, stamp.y), Math.max(0, visualHeight - stamp.height));
  }

  /**
   * @param {string} handle
   * @param {any} origin
   * @param {number} dxPt
   */
  function applyResize(handle, origin, dxPt) {
    const aspect = Math.max(0.12, origin.aspect);
    let width = handle === "se" || handle === "ne" ? origin.width + dxPt : origin.width - dxPt;
    width = Math.max(MIN_PT, width);
    const height = width / aspect;
    const top = origin.y + origin.height;
    const right = origin.x + origin.width;

    if (handle === "se") return { x: origin.x, y: top - height, width, height };
    if (handle === "ne") return { x: origin.x, y: origin.y, width, height };
    if (handle === "sw") return { x: right - width, y: top - height, width, height };
    return { x: right - width, y: origin.y, width, height };
  }

  async function renderPage(index) {
    if (!pdf) return;
    const token = (generation += 1);
    const page = await pdf.getPage(index + 1);
    if (token !== generation) {
      page.cleanup();
      return;
    }

    const base = page.getViewport({ scale: 1 });
    visualWidth = base.width;
    visualHeight = base.height;
    pageIndex = index;

    const maxEdge = 720;
    const scale = maxEdge / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    if (token !== generation) return;
    paintOverlay();
  }

  function pointerDown(event) {
    const handle = event.target.closest?.(".sign-handle");
    const node = event.target.closest?.(".sign-stamp");
    if (!node) {
      setSelectedId("");
      markSelected();
      onChange();
      return;
    }
    event.preventDefault();
    const stamp = getStamps().find((item) => item.id === node.dataset.id);
    if (!stamp) return;
    setSelectedId(stamp.id);
    markSelected();
    node.setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      mode: handle?.dataset.handle || "move",
      stamp: { ...stamp }
    };
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    onChange();
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const stamp = getStamps().find((item) => item.id === drag.stamp.id);
    if (!stamp) return;
    const scale = displayScale();
    const dxPt = (event.clientX - drag.startX) / scale;
    const dyPdf = -(event.clientY - drag.startY) / scale;

    if (drag.mode === "move") {
      stamp.x = drag.stamp.x + dxPt;
      stamp.y = drag.stamp.y + dyPdf;
    } else {
      Object.assign(stamp, applyResize(drag.mode, drag.stamp, dxPt));
    }
    clampStamp(stamp);
    const node = layer.querySelector(`[data-id="${stamp.id}"]`);
    if (node) positionNode(/** @type {HTMLElement} */ (node), stamp);
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    paintOverlay();
    onChange();
  }

  function onLayerKey(event) {
    const node = event.target.closest?.(".sign-stamp");
    if (!node) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(node.dataset.id);
      markSelected();
      onChange();
    }
  }

  layer.addEventListener("pointerdown", pointerDown);
  layer.addEventListener("pointermove", pointerMove);
  layer.addEventListener("pointerup", pointerUp);
  layer.addEventListener("pointercancel", pointerUp);
  layer.addEventListener("keydown", onLayerKey);

  const observer = new ResizeObserver(() => {
    if (!drag) paintOverlay();
  });
  observer.observe(canvas);

  async function closePdf() {
    generation += 1;
    drag = null;
    if (pdf) {
      await pdf.destroy().catch(() => {});
      pdf = null;
    }
    visualWidth = 0;
    visualHeight = 0;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    layer.replaceChildren();
  }

  function detach() {
    layer.removeEventListener("pointerdown", pointerDown);
    layer.removeEventListener("pointermove", pointerMove);
    layer.removeEventListener("pointerup", pointerUp);
    layer.removeEventListener("pointercancel", pointerUp);
    layer.removeEventListener("keydown", onLayerKey);
    observer.disconnect();
  }

  return {
    get visualWidth() {
      return visualWidth;
    },
    get visualHeight() {
      return visualHeight;
    },
    paintOverlay,
    clampStamp,
    async load(bytes) {
      await closePdf();
      pdf = await openDocument(bytes);
      return pdf.numPages;
    },
    async clear() {
      await closePdf();
    },
    showPage: renderPage,
    nudge(dxPt, dyPt) {
      const stamp = getStamps().find((item) => item.id === getSelectedId());
      if (!stamp || stamp.pageIndex !== pageIndex) return false;
      stamp.x += dxPt;
      stamp.y += dyPt;
      clampStamp(stamp);
      paintOverlay();
      onChange();
      return true;
    },
    async destroy() {
      await closePdf();
      detach();
    }
  };
}
