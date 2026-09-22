/**
 * Interactive page board for the edit overlay.
 * Object rectangles live in visual PDF space (origin bottom-left, upright).
 *
 * Selection model: no tool is armed by default — the mouse alone selects,
 * moves, resizes and rotates any object on the page. Creation tools
 * (text/pen/shapes) only add new objects on empty space; the select tool
 * adds multi-select gestures (ctrl-click / marquee) so several layers can
 * be bulk-moved, duplicated or deleted together.
 *
 * Cursor contract (tool-independent, follows the hovered capability):
 * .edit-obj shows grab, move drags add .is-grabbing (grabbing) on the
 * layer, resize handles keep their directional arrows, and the rotate
 * grip shows a circular arrow. Resize/rotate drags never take
 * .is-grabbing, so their cursors are never overridden mid-gesture.
 */
import { openDocument, pdfRenderContext } from "../../pdf/core.js";
import {
  MIN_PT,
  bboxFromPoints,
  clampBox,
  clampGroupDelta,
  clampedMove,
  rectsIntersect,
  scalePoints,
  worldToLocal
} from "./coords.js";
import { FONT, textPad } from "./text-png.js";
import { MIN_BOX_PX, fitPageCssWidth, fitWidthFillPx, stabilizeFitPx } from "./fit.js";

const CORNER_HANDLES = ["nw", "ne", "sw", "se"];
const FREE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.layer
 * @param {HTMLElement} [options.wrap]
 * @param {() => Array<any>} options.getObjects
 * @param {() => string[]} options.getSelectedIds
 * @param {(ids: string[]) => void} options.setSelectedIds
 * @param {() => string} options.getTool
 * @param {() => object} options.getStyle
 * @param {(obj: any) => void} options.onCreate
 * @param {() => void} options.onChange
 * @param {() => void} [options.onBeginChange]
 * @param {() => void} options.onHistory
 * @param {() => void} [options.onDiscardHistory]
 * @param {(zoom: number) => void} [options.onZoomChange]
 */
export function createBoard(options) {
  const {
    canvas,
    layer,
    wrap,
    getObjects,
    getSelectedIds,
    setSelectedIds,
    getTool,
    getStyle,
    onCreate,
    onChange,
    onBeginChange,
    onHistory,
    onDiscardHistory,
    onZoomChange
  } = options;

  /** @type {any} */
  let pdf = null;
  let visualWidth = 0;
  let visualHeight = 0;
  let pageIndex = 0;
  let generation = 0;
  /** @type {null | any} */
  let drag = null;
  /** @type {SVGSVGElement | null} */
  let ghostInk = null;
  /** @type {SVGSVGElement | null} */
  let ghost = null;
  /** @type {HTMLElement | null} */
  let marquee = null;
  let zoom = 1;
  let fitPx = 0;
  /** "width": page fills the content width (default). "page": whole page contained. */
  let fitMode = "width";
  let hiResTimer = 0;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.5;

  function displayScale() {
    return canvas.offsetWidth / Math.max(1, visualWidth);
  }

  function wrapIsLaidOut() {
    if (!wrap) return true;
    if (wrap.hidden || wrap.closest("[hidden]")) return false;
    return wrap.clientWidth >= MIN_BOX_PX && wrap.clientHeight >= MIN_BOX_PX;
  }

  function availableBox() {
    if (!wrap) return { w: 760, h: 980 };
    if (!wrapIsLaidOut()) return { w: 0, h: 0 };
    const cs = getComputedStyle(wrap);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const board = canvas.parentElement;
    const bs = board ? getComputedStyle(board) : null;
    const chromeX = bs
      ? (parseFloat(bs.borderLeftWidth) || 0) + (parseFloat(bs.borderRightWidth) || 0)
      : 0;
    const chromeY = bs
      ? (parseFloat(bs.borderTopWidth) || 0) + (parseFloat(bs.borderBottomWidth) || 0)
      : 0;
    return {
      w: Math.max(0, wrap.clientWidth - padX - chromeX),
      h: Math.max(0, wrap.clientHeight - padY - chromeY)
    };
  }

  /** CSS px per pt at zoom 1 — width-fill by default, whole-page on demand. */
  function computeFitPx() {
    if (!visualWidth || !visualHeight) return 0;
    const { w, h } = availableBox();
    if (fitMode === "page") return fitPageCssWidth(visualWidth, visualHeight, w, h);
    return fitWidthFillPx(visualWidth, w);
  }

  /**
   * Real layout sizing (no CSS transform): the canvas width drives offsetWidth,
   * so displayScale and every coordinate path stay exact at any zoom.
   * @returns {boolean} whether the displayed CSS width changed
   */
  function applySize() {
    if (!visualWidth || !visualHeight) return false;
    if (wrap && !wrapIsLaidOut()) return false;
    const nextFit = stabilizeFitPx(computeFitPx(), fitPx);
    if (!nextFit) return false;
    fitPx = nextFit;
    const nextWidth = `${Math.round(fitPx * zoom)}px`;
    const changed = canvas.style.width !== nextWidth;
    if (changed) canvas.style.width = nextWidth;
    canvas.style.height = "auto";
    return changed;
  }

  function scheduleHiRes() {
    if (hiResTimer) clearTimeout(hiResTimer);
    hiResTimer = setTimeout(() => {
      hiResTimer = 0;
      if (!drag && pdf) void renderPage(pageIndex);
    }, 160);
  }

  function setZoomValue(next, force = false) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (clamped === zoom && !force) return zoom;
    zoom = clamped;
    applySize();
    scheduleHiRes();
    onZoomChange?.(zoom);
    return zoom;
  }

  /** Ctrl/⌘ + wheel (and trackpad pinch) zooms; plain wheel keeps scrolling. */
  function onWheel(event) {
    if (!wrapIsLaidOut() || !(fitPx > 0)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0016);
    setZoomValue(zoom * factor);
  }

  function clientToVisual(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = visualWidth / Math.max(1, rect.width);
    const scaleY = visualHeight / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: visualHeight - (clientY - rect.top) * scaleY
    };
  }

  function objectsOnPage() {
    return getObjects().filter((obj) => obj.pageIndex === pageIndex);
  }

  function positionNode(node, obj) {
    const scale = displayScale();
    node.style.left = `${obj.x * scale}px`;
    node.style.top = `${(visualHeight - obj.y - obj.height) * scale}px`;
    node.style.width = `${obj.width * scale}px`;
    node.style.height = `${obj.height * scale}px`;
    node.style.transform = obj.rotation ? `rotate(${obj.rotation}deg)` : "";
  }

  function shapeSvg(obj) {
    const ns = "http://www.w3.org/2000/svg";
    if (obj.kind === "line" || obj.kind === "arrow") return lineSvg(obj, ns);
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    const fill = obj.fillOn === false ? "none" : obj.fill || "#8AA4E0";
    const stroke = obj.stroke || "#1E3A8A";
    const strokePt = Number.isFinite(Number(obj.strokeWidth)) ? Math.max(0, Number(obj.strokeWidth)) : 1.5;
    const sw = strokePt * (100 / Math.max(obj.width, 1));
    /** @type {SVGElement} */
    let el;
    if (obj.kind === "ellipse") {
      el = document.createElementNS(ns, "ellipse");
      el.setAttribute("cx", "50");
      el.setAttribute("cy", "50");
      el.setAttribute("rx", "48");
      el.setAttribute("ry", "48");
    } else if (obj.kind === "triangle") {
      el = document.createElementNS(ns, "polygon");
      el.setAttribute("points", "50,4 4,96 96,96");
    } else {
      el = document.createElementNS(ns, "rect");
      el.setAttribute("x", "2");
      el.setAttribute("y", "2");
      el.setAttribute("width", "96");
      el.setAttribute("height", "96");
    }
    el.setAttribute("fill", fill);
    el.setAttribute("stroke", stroke);
    el.setAttribute("stroke-width", String(sw));
    svg.append(el);
    return svg;
  }

  /** Arrowhead size from the shaft thickness (same formula as flatten). */
  function headSize(thickness) {
    const len = Math.min(Math.max(8, thickness * 4), 28);
    return { len, half: len * 0.5 };
  }

  /**
   * Filled triangular head at `tip`, pointing along the unit vector
   * (`ux`, `uy`). Pure point math — shared by the board preview, the drag
   * ghost and the flatten step (which keeps its own copy).
   */
  function arrowHeadPoints(tip, ux, uy, size) {
    const bx = tip.x - ux * size.len;
    const by = tip.y - uy * size.len;
    return [tip, { x: bx - uy * size.half, y: by + ux * size.half }, { x: bx + uy * size.half, y: by - ux * size.half }];
  }

  /**
   * Lines/arrows render from their two stored endpoints (pt viewBox, like
   * ink) — not from box corners — so horizontal/vertical shafts stay exact
   * and resize keeps the geometry glued via the generic points path.
   */
  function lineSvg(obj, ns) {
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${obj.width} ${obj.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const stroke = obj.stroke || "#1E3A8A";
    const sw = Number.isFinite(Number(obj.strokeWidth)) ? Math.max(0, Number(obj.strokeWidth)) : 1.5;
    const ends = Array.isArray(obj.points) && obj.points.length > 1
      ? [obj.points[0], obj.points[1]]
      : [{ x: obj.x, y: obj.y }, { x: obj.x + obj.width, y: obj.y + obj.height }];
    const rel = ends.map((point) => ({ x: point.x - obj.x, y: obj.height - (point.y - obj.y) }));
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(rel[0].x));
    line.setAttribute("y1", String(rel[0].y));
    line.setAttribute("x2", String(rel[1].x));
    line.setAttribute("y2", String(rel[1].y));
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-width", String(sw));
    line.setAttribute("stroke-linecap", "round");
    svg.append(line);
    if (obj.kind === "arrow" && sw > 0) {
      const dx = rel[1].x - rel[0].x;
      const dy = rel[1].y - rel[0].y;
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        // Same clamp as flatten: a shrunken shaft never grows a head
        // longer than itself, so preview and output always agree.
        const use = Math.min(headSize(sw).len, len);
        const head = arrowHeadPoints(rel[1], dx / len, dy / len, { len: use, half: use * 0.5 });
        const poly = document.createElementNS(ns, "polygon");
        poly.setAttribute("points", head.map((point) => `${point.x},${point.y}`).join(" "));
        poly.setAttribute("fill", stroke);
        svg.append(poly);
      }
    }
    return svg;
  }

  /** Drag ghost content for line/arrow: a live shaft (+ head) preview. */
  function buildGhostLine(ghost, kind) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const line = document.createElementNS(ns, "line");
    line.style.stroke = "var(--accent)";
    line.style.strokeWidth = "3";
    line.setAttribute("stroke-linecap", "round");
    svg.append(line);
    let head = null;
    if (kind === "arrow") {
      head = document.createElementNS(ns, "polygon");
      head.style.fill = "var(--accent)";
      svg.append(head);
    }
    ghost.append(svg);
    return { line, head };
  }

  function paintGhostLine(refs, from, to, box) {
    const w = Math.max(box.width, 1e-6);
    const h = Math.max(box.height, 1e-6);
    const X = (point) => ((point.x - box.x) / w) * 100;
    const Y = (point) => (1 - (point.y - box.y) / h) * 100;
    const tip = { x: X(to), y: Y(to) };
    refs.line.setAttribute("x1", X(from).toFixed(1));
    refs.line.setAttribute("y1", Y(from).toFixed(1));
    refs.line.setAttribute("x2", tip.x.toFixed(1));
    refs.line.setAttribute("y2", tip.y.toFixed(1));
    if (refs.head) {
      const dx = tip.x - X(from);
      const dy = tip.y - Y(from);
      const len = Math.hypot(dx, dy) || 1;
      const use = Math.min(14, len);
      const head = arrowHeadPoints(tip, dx / len, dy / len, { len: use, half: use * 0.5 });
      refs.head.setAttribute("points", head.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
    }
  }

  function inkSvg(obj) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${obj.width} ${obj.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS(ns, "path");
    const d = (obj.points || [])
      .map((point, index) => {
        const x = point.x - obj.x;
        const y = obj.height - (point.y - obj.y);
        return `${index ? "L" : "M"} ${x} ${y}`;
      })
      .join(" ");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", obj.color || "#1E3A8A");
    path.setAttribute("stroke-width", String(obj.strokeWidth || 2));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  /**
   * Live pen preview as an SVG overlay (visual pt units, same mapping as the
   * final ink layer). A second <canvas> here used to present a stale white GPU
   * buffer after resize and blank the whole page.
   */
  function beginLiveInk(color, weight) {
    endLiveInk();
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${visualWidth} ${visualHeight}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("edit-ink-live");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(weight));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    layer.append(svg);
    ghostInk = svg;
    return path;
  }

  function endLiveInk() {
    ghostInk?.remove();
    ghostInk = null;
  }

  function drawLiveInk() {
    if (!ghostInk || !drag?.livePath) return;
    const d = drag.points
      .map((point, index) => `${index ? "L" : "M"} ${point.x} ${visualHeight - point.y}`)
      .join(" ");
    drag.livePath.setAttribute("d", d);
  }

  /**
   * Grow a text object's height so its textarea never clips content.
   * Keeps the visual TOP edge fixed (box grows downward on screen).
   * @param {HTMLTextAreaElement} area
   * @param {any} obj
   */
  function growTextArea(area, obj) {
    const scale = displayScale();
    if (!(scale > 0)) return;
    const neededPt = area.scrollHeight / scale + 2;
    if (neededPt <= obj.height + 0.5) return;
    const top = visualHeight - obj.y - obj.height;
    obj.height = Math.min(visualHeight, Math.max(MIN_PT, neededPt));
    obj.y = Math.max(0, Math.min(visualHeight - obj.height, visualHeight - top - obj.height));
    const node = area.closest(".edit-obj");
    if (node instanceof HTMLElement) positionNode(node, obj);
  }

  function paintOverlay() {
    const selected = new Set(getSelectedIds());
    const singleId = selected.size === 1 ? [...selected][0] : "";
    const focused = document.activeElement;
    const keepFocusId =
      focused instanceof HTMLTextAreaElement ? focused.closest(".edit-obj")?.dataset.id : "";

    layer.querySelectorAll(".edit-obj, .edit-ghost").forEach((node) => {
      try {
        node.remove();
      } catch {
        /* أُزيلت بالفعل أثناء معالجة متداخلة */
      }
    });
    layer.dataset.tool = getTool();

    for (const obj of objectsOnPage()) {
      const isSelected = selected.has(obj.id);
      const node = document.createElement("div");
      node.className = "edit-obj" + (isSelected ? " is-selected" : "");
      node.dataset.id = obj.id;
      node.dataset.type = obj.type;
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", labelFor(obj));
      node.setAttribute("aria-selected", isSelected ? "true" : "false");
      positionNode(node, obj);

      if (obj.type === "text") {
        const fontSize = obj.fontSize || 18;
        const scale = displayScale();
        // No padding on the node itself: the editor/preview children carry
        // exactly one textPad (border-box), matching the final PNG. Padding
        // here used to stack on top of theirs and shift the text on exit.
        node.style.color = obj.color || "#1E3A8A";
        node.style.fontFamily = FONT;
        node.style.fontWeight = obj.bold ? "700" : "400";
        node.style.fontStyle = obj.italic ? "italic" : "normal";
        node.style.textDecoration = obj.underline ? "underline" : "none";
        node.style.fontSize = `${fontSize * scale}px`;
        node.style.lineHeight = "1.45";
        node.style.textAlign = obj.align || "right";
        if (obj.id === singleId || obj.id === keepFocusId) {
          const area = document.createElement("textarea");
          area.value = obj.text || "";
          area.dir = "rtl";
          area.maxLength = 2000;
          area.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSelectedIds([]);
              paintOverlay();
              onChange();
            }
          });
          area.addEventListener("input", () => {
            onBeginChange?.();
            obj.text = area.value;
            growTextArea(area, obj);
            onChange();
          });
          node.append(area);
          applyTextBoxMetrics(area, obj, displayScale());
          requestAnimationFrame(() => {
            if (area.isConnected) growTextArea(area, obj);
          });
        } else {
          const preview = document.createElement("div");
          preview.className = "edit-obj__text";
          preview.style.display = "block";
          preview.textContent = obj.text || "نص";
          node.append(preview);
          applyTextBoxMetrics(preview, obj, displayScale());
        }
      } else if (obj.type === "image") {
        const img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        img.src = obj.url;
        node.append(img);
      } else if (obj.type === "shape") {
        node.append(shapeSvg(obj));
      } else if (obj.type === "ink") {
        node.append(inkSvg(obj));
      }

      // Handles + rotate grip only for a single selection: precise control
      // stays predictable, groups move as one block.
      if (obj.id === singleId) {
        const handles = obj.type === "image" ? CORNER_HANDLES : FREE_HANDLES;
        for (const handle of handles) {
          const grip = document.createElement("span");
          grip.className = "edit-handle";
          grip.dataset.handle = handle;
          grip.setAttribute("aria-hidden", "true");
          node.append(grip);
        }
        const rotate = document.createElement("span");
        rotate.className = "edit-rotate";
        rotate.dataset.handle = "rotate";
        rotate.setAttribute("aria-hidden", "true");
        node.append(rotate);
      }

      layer.append(node);

      if (obj.id === keepFocusId) {
        const area = node.querySelector("textarea");
        if (area instanceof HTMLTextAreaElement) {
          area.focus();
          area.selectionStart = area.value.length;
        }
      }
    }
  }

  function labelFor(obj) {
    if (obj.type === "text") return "نص";
    if (obj.type === "image") return "صورة";
    if (obj.type === "ink") return "رسم";
    if (obj.kind === "ellipse") return "دائرة";
    if (obj.kind === "triangle") return "مثلث";
    if (obj.kind === "line") return "خط";
    if (obj.kind === "arrow") return "سهم";
    return "مربع";
  }

  function applyResize(handle, origin, vx, vy) {
    const local = worldToLocal(origin, vx, vy);
    const cx = origin.x + origin.width / 2;
    const cy = origin.y + origin.height / 2;
    let width = origin.width;
    let height = origin.height;
    const lock = origin.type === "image";

    if (handle.includes("e") || handle.includes("w")) {
      width = Math.max(MIN_PT, Math.abs(local.x - origin.width / 2) * 2);
    }
    if (handle.includes("n") || handle.includes("s")) {
      height = Math.max(MIN_PT, Math.abs(local.y - origin.height / 2) * 2);
    }
    if (lock && origin.aspect) {
      if (handle === "n" || handle === "s") width = height * origin.aspect;
      else height = width / origin.aspect;
    }

    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height
    };
  }

  function hitObject(vx, vy) {
    const list = objectsOnPage().slice().reverse();
    for (const obj of list) {
      const local = worldToLocal(obj, vx, vy);
      if (local.x >= 0 && local.y >= 0 && local.x <= obj.width && local.y <= obj.height) {
        return obj;
      }
    }
    return null;
  }

  function beginMarquee(visual) {
    endMarquee();
    marquee = document.createElement("div");
    marquee.className = "edit-marquee";
    layer.append(marquee);
    return { start: visual };
  }

  function updateMarquee(start, visual) {
    if (!marquee) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(start.x, visual.x);
    const y = Math.min(start.y, visual.y);
    const width = Math.abs(visual.x - start.x);
    const height = Math.abs(visual.y - start.y);
    const scale = displayScale();
    marquee.style.left = `${x * scale}px`;
    marquee.style.top = `${(visualHeight - y - height) * scale}px`;
    marquee.style.width = `${width * scale}px`;
    marquee.style.height = `${height * scale}px`;
    return { x, y, width, height };
  }

  function endMarquee() {
    marquee?.remove();
    marquee = null;
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

    applySize();
    if (!fitPx) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      applySize();
    }
    if (!fitPx) return;

    // Bitmap resolution follows the on-screen size (zoom × fit) so zoom-in stays crisp.
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const shownW = Math.max(1, fitPx * zoom);
    const shownLongest = Math.max(shownW, shownW * (base.height / base.width));
    const bitmapLongest = Math.max(360, Math.min(2400, shownLongest * dpr));
    const scale = bitmapLongest / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;

    const ctx = pdfRenderContext(canvas);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    if (token !== generation) return;
    canvas.style.visibility = "";
    paintOverlay();
  }

  /**
   * Sharp page thumbnail: rendered at 2x its CSS size so small previews stay
   * crisp on hidpi screens (this is what used to look blurry everywhere).
   * @param {number} index 0-based
   * @param {number} [longestPx] backing-store longest edge
   */
  async function renderThumb(index, longestPx = 320) {
    if (!pdf) return null;
    const token = generation;
    try {
      const page = await pdf.getPage(index + 1);
      if (token !== generation || !pdf) {
        try {
          page.cleanup();
        } catch {
          /* تجاهل */
        }
        return null;
      }
      const base = page.getViewport({ scale: 1 });
      const scale = longestPx / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });
      const thumb = document.createElement("canvas");
      thumb.width = Math.max(1, Math.ceil(viewport.width));
      thumb.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = pdfRenderContext(thumb);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, thumb.width, thumb.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      if (token !== generation) return null;
      return thumb;
    } catch {
      return null;
    }
  }

  function focusSelectedText() {
    const area = layer.querySelector(".edit-obj.is-selected textarea");
    if (area instanceof HTMLTextAreaElement) area.focus();
  }

  /**
   * Shared box metrics for the editable textarea and the read-only preview
   * so both render the text with the same padding, wrapping and border-box
   * sizing as the final PNG (same textPad formula). Any divergence here
   * shows up as the text jumping when edit mode is exited.
   */
  function applyTextBoxMetrics(target, obj, scale) {
    const padCss = textPad(obj.fontSize || 18) * scale;
    target.style.boxSizing = "border-box";
    target.style.padding = `${padCss}px`;
    target.style.whiteSpace = "pre-wrap";
    target.style.overflowWrap = "break-word";
  }

  function pointerDown(event) {
    // Text editing vs text moving is decided by a movement threshold: a press
    // that stays put becomes a caret click, a press that travels moves the box.
    if (event.target instanceof HTMLTextAreaElement) {
      const node = event.target.closest?.(".edit-obj");
      const obj = node && getObjects().find((item) => item.id === node.dataset.id);
      if (!obj) return;
      event.preventDefault();
      if (!getSelectedIds().includes(obj.id)) {
        setSelectedIds([obj.id]);
        paintOverlay();
      }
      layer.setPointerCapture(event.pointerId);
      onHistory();
      layer.classList.add("is-grabbing");
      drag = {
        pointerId: event.pointerId,
        mode: "move",
        textPending: true,
        caretX: event.clientX,
        caretY: event.clientY,
        origin: {
          ...obj,
          points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined
        },
        startX: event.clientX,
        startY: event.clientY,
        dirty: false,
        historyPushed: true
      };
      onChange();
      return;
    }
    const tool = getTool();
    const visual = clientToVisual(event.clientX, event.clientY);
    const handle = event.target.closest?.("[data-handle]");
    const node = event.target.closest?.(".edit-obj");

    // ——— select tool: multi-select only ———
    if (tool === "select") {
      if (handle && node) {
        // Handles exist only on single selections.
        const obj = getObjects().find((item) => item.id === node.dataset.id);
        if (!obj) return;
        event.preventDefault();
        layer.setPointerCapture(event.pointerId);
        onHistory();
        drag = {
          pointerId: event.pointerId,
          mode: handle.dataset.handle,
          origin: {
            ...obj,
            points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined
          },
          startX: event.clientX,
          startY: event.clientY,
          dirty: false,
          historyPushed: true
        };
        return;
      }
      if (node) {
        const obj = getObjects().find((item) => item.id === node.dataset.id);
        if (!obj) return;
        event.preventDefault();
        const current = getSelectedIds();
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          const next = current.includes(obj.id)
            ? current.filter((id) => id !== obj.id)
            : [...current, obj.id];
          setSelectedIds(next);
          paintOverlay();
          onChange();
          return;
        }
        const ids = current.includes(obj.id) && current.length > 1 ? current.slice() : [obj.id];
        setSelectedIds(ids);
        paintOverlay();
        if (obj.type === "text") focusSelectedText();
        layer.setPointerCapture(event.pointerId);
        onHistory();
        layer.classList.add("is-grabbing");
        drag = startGroupDrag(event, ids);
        onChange();
        return;
      }
      // Empty: marquee.
      event.preventDefault();
      if (!event.shiftKey) setSelectedIds([]);
      layer.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        mode: "marquee",
        ...(event.shiftKey ? { add: true } : null),
        ...beginMarquee(visual),
        box: { x: visual.x, y: visual.y, width: 0, height: 0 }
      };
      paintOverlay();
      onChange();
      return;
    }

    // ——— pen draws only on empty space; objects move directly ———
    if (tool === "pen" && !node && !handle) {
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      const style = getStyle();
      drag = {
        pointerId: event.pointerId,
        mode: "pen",
        points: [{ x: visual.x, y: visual.y }],
        color: style.penColor,
        strokeWidth: style.penWeight
      };
      drag.livePath = beginLiveInk(drag.color, drag.strokeWidth);
      drawLiveInk();
      return;
    }

    // ——— every other tool manipulates objects directly ———
    if (node) {
      const obj = getObjects().find((item) => item.id === node.dataset.id);
      if (!obj) return;
      event.preventDefault();
      setSelectedIds([obj.id]);
      paintOverlay();
      if (obj.type === "text") focusSelectedText();
      layer.setPointerCapture(event.pointerId);
      const mode = handle?.dataset.handle || "move";
      if (mode === "move") layer.classList.add("is-grabbing");
      onHistory();
      drag = {
        pointerId: event.pointerId,
        mode,
        origin: {
          ...obj,
          points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined
        },
        startX: event.clientX,
        startY: event.clientY,
        dirty: false,
        historyPushed: true
      };
      onChange();
      return;
    }

    if (tool === "text") {
      event.preventDefault();
      const style = getStyle();
      onHistory();
      onCreate({
        type: "text",
        pageIndex,
        x: visual.x - 90,
        y: visual.y - 24,
        width: 180,
        height: 48,
        rotation: 0,
        text: "",
        fontSize: style.fontSize,
        color: style.textColor,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        align: style.align
      });
      return;
    }

    if (tool === "rect" || tool === "ellipse" || tool === "triangle" || tool === "line" || tool === "arrow") {
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        mode: "shape",
        kind: tool,
        start: visual
      };
      ghost = document.createElement("div");
      ghost.className = "edit-ghost";
      layer.append(ghost);
      if (tool === "line" || tool === "arrow") drag.ghostSvg = buildGhostLine(ghost, tool);
      return;
    }

    // image / unknown on empty space: just clear the selection.
    setSelectedIds([]);
    paintOverlay();
    onChange();
  }

  /**
   * @param {PointerEvent} event
   * @param {string[]} ids
   */
  function startGroupDrag(event, ids) {
    /** @type {Map<string, any>} */
    const origins = new Map();
    for (const id of ids) {
      const obj = getObjects().find((item) => item.id === id);
      if (!obj || obj.pageIndex !== pageIndex) continue;
      origins.set(id, {
        ...obj,
        points: obj.points ? obj.points.map((point) => ({ ...point })) : undefined
      });
    }
    return {
      pointerId: event.pointerId,
      mode: "move-group",
      ids: [...origins.keys()],
      origins,
      startX: event.clientX,
      startY: event.clientY,
      dirty: false,
      historyPushed: true
    };
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const visual = clientToVisual(event.clientX, event.clientY);

    if (drag.textPending) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 6) return;
      drag.textPending = false;
    }

    if (drag.mode === "marquee") {
      drag.box = updateMarquee(drag.start, visual);
      return;
    }

    if (drag.mode === "pen") {
      const last = drag.points[drag.points.length - 1];
      if (Math.hypot(visual.x - last.x, visual.y - last.y) < 0.8) return;
      drag.points.push({ x: visual.x, y: visual.y });
      drawLiveInk();
      return;
    }

    if (drag.mode === "shape") {
      const x = Math.min(drag.start.x, visual.x);
      const y = Math.min(drag.start.y, visual.y);
      const width = Math.abs(visual.x - drag.start.x);
      const height = Math.abs(visual.y - drag.start.y);
      const scale = displayScale();
      if (ghost) {
        ghost.style.left = `${x * scale}px`;
        ghost.style.top = `${(visualHeight - y - height) * scale}px`;
        ghost.style.width = `${width * scale}px`;
        ghost.style.height = `${height * scale}px`;
        ghost.style.borderRadius = drag.kind === "ellipse" ? "50%" : "0";
        if (drag.ghostSvg) paintGhostLine(drag.ghostSvg, drag.start, visual, { x, y, width, height });
      }
      return;
    }

    if (drag.mode === "move-group") {
      const scale = displayScale();
      const dxPt = (event.clientX - drag.startX) / scale;
      const dyPdf = -(event.clientY - drag.startY) / scale;
      const boxes = [...drag.origins.values()];
      const allowed = clampGroupDelta(boxes, dxPt, dyPdf, visualWidth, visualHeight);
      for (const [id, origin] of drag.origins) {
        const obj = getObjects().find((item) => item.id === id);
        if (!obj) continue;
        obj.x = origin.x + allowed.dx;
        obj.y = origin.y + allowed.dy;
        if (obj.points) {
          obj.points = origin.points.map((point) => ({
            x: point.x + allowed.dx,
            y: point.y + allowed.dy
          }));
        }
        const el = layer.querySelector(`[data-id="${id}"]`);
        if (el) positionNode(/** @type {HTMLElement} */ (el), obj);
      }
      drag.dirty = allowed.dx !== 0 || allowed.dy !== 0;
      return;
    }

    const obj = getObjects().find((item) => item.id === drag.origin.id);
    if (!obj) return;
    const scale = displayScale();
    const dxPt = (event.clientX - drag.startX) / scale;
    const dyPdf = -(event.clientY - drag.startY) / scale;

    if (drag.mode === "move") {
      const moved = clampedMove(drag.origin, dxPt, dyPdf, visualWidth, visualHeight);
      obj.x = moved.x;
      obj.y = moved.y;
      if (obj.points) {
        obj.points = drag.origin.points.map((point) => ({
          x: point.x + moved.dx,
          y: point.y + moved.dy
        }));
      }
      drag.dirty = moved.dx !== 0 || moved.dy !== 0;
    } else if (drag.mode === "rotate") {
      const cx = drag.origin.x + drag.origin.width / 2;
      const cy = drag.origin.y + drag.origin.height / 2;
      obj.rotation = (Math.atan2(visual.x - cx, visual.y - cy) * 180) / Math.PI;
      drag.dirty = true;
    } else {
      const next = applyResize(drag.mode, drag.origin, visual.x, visual.y);
      clampBox(next, visualWidth, visualHeight);
      if (obj.points) {
        obj.points = scalePoints(drag.origin.points, drag.origin, next);
      }
      Object.assign(obj, next);
      drag.dirty =
        next.x !== drag.origin.x ||
        next.y !== drag.origin.y ||
        next.width !== drag.origin.width ||
        next.height !== drag.origin.height;
    }

    const el = layer.querySelector(`[data-id="${obj.id}"]`);
    if (el) positionNode(/** @type {HTMLElement} */ (el), obj);
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    layer.classList.remove("is-grabbing");
    const mode = drag.mode;

    if (mode === "marquee") {
      const box = drag.box || { x: 0, y: 0, width: 0, height: 0 };
      const base = drag.add ? getSelectedIds().slice() : [];
      drag = null;
      endMarquee();
      if (box.width > 4 || box.height > 4) {
        const hit = objectsOnPage()
          .filter((obj) => rectsIntersect(obj, box))
          .map((obj) => obj.id);
        const next = [...base];
        for (const id of hit) if (!next.includes(id)) next.push(id);
        setSelectedIds(next);
      }
      paintOverlay();
      onChange();
      return;
    }

    if (mode === "pen") {
      const points = drag.points;
      const color = drag.color;
      const strokeWidth = drag.strokeWidth;
      drag = null;
      endLiveInk();
      if (points.length > 1) {
        const pad = strokeWidth + 2;
        const box = bboxFromPoints(points, pad);
        clampBox(box, visualWidth, visualHeight);
        onHistory();
        onCreate({
          type: "ink",
          pageIndex,
          ...box,
          rotation: 0,
          points,
          color,
          strokeWidth
        });
      }
      return;
    }

    if (mode === "shape") {
      const start = drag.start;
      const kind = drag.kind;
      const visual = clientToVisual(event.clientX, event.clientY);
      drag = null;
      ghost?.remove();
      ghost = null;
      const width = Math.abs(visual.x - start.x);
      const height = Math.abs(visual.y - start.y);
      const isLine = kind === "line" || kind === "arrow";
      // A shaft has no area: its length is the size that matters, so a
      // horizontal/vertical drag must not be rejected by the box minimum.
      if (isLine ? Math.hypot(width, height) < 8 : width < 8 || height < 8) return;
      const style = getStyle();
      const linePad = isLine ? (style.strokeWidth > 0 ? style.strokeWidth : 2.5) + 2 : 0;
      const box = {
        x: Math.min(start.x, visual.x) - linePad,
        y: Math.min(start.y, visual.y) - linePad,
        width: width + linePad * 2,
        height: height + linePad * 2
      };
      if (isLine) {
        // Center the minimum box on the shaft: clampBox only grows from x/y,
        // which would pin a horizontal/vertical shaft to the box edge — every
        // later resize would then drag the shaft off-center, and rotation
        // would orbit around a point off the shaft instead of its middle.
        if (box.width < MIN_PT) { box.x -= (MIN_PT - box.width) / 2; box.width = MIN_PT; }
        if (box.height < MIN_PT) { box.y -= (MIN_PT - box.height) / 2; box.height = MIN_PT; }
      }
      clampBox(box, visualWidth, visualHeight);
      onHistory();
      onCreate({
        type: "shape",
        kind,
        pageIndex,
        ...box,
        rotation: 0,
        fill: style.fill,
        fillOn: style.fillOn,
        stroke: style.stroke,
        // A zero-width shaft paints nothing (flatten skips it) and a shaft
        // has no fill to fall back on — creation guarantees visibility.
        strokeWidth: isLine && !(style.strokeWidth > 0) ? 2.5 : style.strokeWidth,
        // Endpoints ride along with the generic points path (move/resize),
        // so thin shafts keep exact geometry under any box clamp.
        ...(isLine ? { points: [{ x: start.x, y: start.y }, { x: visual.x, y: visual.y }] } : null)
      });
      return;
    }

    if (mode === "move-group" || mode === "move" || mode === "rotate" || FREE_HANDLES.includes(mode)) {
      if (drag.textPending) {
        // A press that never travelled: plain caret click, no history, no move.
        const { caretX, caretY, origin } = drag;
        drag = null;
        onDiscardHistory?.();
        paintOverlay();
        const node = layer.querySelector(`[data-id="${origin.id}"]`);
        const area = node?.querySelector("textarea");
        if (area instanceof HTMLTextAreaElement) {
          area.focus({ preventScroll: true });
          try {
            const range = document.caretRangeFromPoint?.(caretX, caretY);
            if (range) {
              const sel = getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            } else {
              area.selectionStart = area.value.length;
            }
          } catch {
            area.selectionStart = area.value.length;
          }
        }
        onChange();
        return;
      }
      if (!drag.dirty && drag.historyPushed) onDiscardHistory?.();
      drag = null;
      paintOverlay();
      onChange();
      return;
    }

    drag = null;
  }

  function onLayerKey(event) {
    // Typing inside the on-canvas editor must reach the text: without this
    // guard Space/Enter never typed (eaten here) and every press rebuilt the
    // editor mid-typing, stealing focus so following keys went nowhere.
    if (event.target?.closest?.("textarea, input, select")) return;
    const node = event.target.closest?.(".edit-obj");
    if (!node) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedIds([node.dataset.id]);
      paintOverlay();
      onChange();
    }
  }

  layer.addEventListener("pointerdown", pointerDown);
  layer.addEventListener("pointermove", pointerMove);
  layer.addEventListener("pointerup", pointerUp);
  layer.addEventListener("pointercancel", pointerUp);
  layer.addEventListener("keydown", onLayerKey);

  const sizeTarget = wrap || canvas;
  const observer = new ResizeObserver(() => {
    if (drag) return;
    if (!wrapIsLaidOut()) return;
    if (pdf && visualWidth && !fitPx) {
      void renderPage(pageIndex);
      return;
    }
    const changed = applySize();
    if (changed) {
      paintOverlay();
      scheduleHiRes();
    }
  });
  observer.observe(sizeTarget);
  sizeTarget.addEventListener("wheel", onWheel, { passive: false });

  async function closePdf() {
    generation += 1;
    drag = null;
    layer.classList.remove("is-grabbing");
    ghost?.remove();
    ghost = null;
    endLiveInk();
    endMarquee();
    if (hiResTimer) {
      clearTimeout(hiResTimer);
      hiResTimer = 0;
    }
    if (pdf) {
      await pdf.destroy().catch(() => {});
      pdf = null;
    }
    visualWidth = 0;
    visualHeight = 0;
    fitPx = 0;
    canvas.style.width = "";
    canvas.style.visibility = "";
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    layer.querySelectorAll(".edit-obj, .edit-ghost").forEach((node) => {
      try {
        node.remove();
      } catch {
        /* أُزيلت بالفعل */
      }
    });
  }

  function detach() {
    layer.removeEventListener("pointerdown", pointerDown);
    layer.removeEventListener("pointermove", pointerMove);
    layer.removeEventListener("pointerup", pointerUp);
    layer.removeEventListener("pointercancel", pointerUp);
    layer.removeEventListener("keydown", onLayerKey);
    sizeTarget.removeEventListener("wheel", onWheel);
    observer.disconnect();
  }

  return {
    get visualWidth() {
      return visualWidth;
    },
    get visualHeight() {
      return visualHeight;
    },
    getPageIndex() {
      return pageIndex;
    },
    paintOverlay,
    renderThumb,
    async load(bytes) {
      await closePdf();
      canvas.style.visibility = "hidden";
      if (!wrapIsLaidOut()) canvas.style.width = "0px";
      pdf = await openDocument(bytes);
      return pdf.numPages;
    },
    async clear() {
      await closePdf();
    },
    showPage: renderPage,
    whenLaidOut() {
      return new Promise((resolve) => {
        if (wrapIsLaidOut()) {
          resolve();
          return;
        }
        let settled = false;
        const node = wrap || canvas;
        const finish = () => {
          if (settled) return;
          settled = true;
          obs.disconnect();
          clearTimeout(timer);
          resolve();
        };
        const obs = new ResizeObserver(() => {
          if (wrapIsLaidOut()) finish();
        });
        obs.observe(node);
        const timer = setTimeout(finish, 400);
        requestAnimationFrame(() => {
          if (wrapIsLaidOut()) finish();
        });
      });
    },
    setZoom: setZoomValue,
    getZoom() {
      return zoom;
    },
    getFitMode() {
      return fitMode;
    },
    /** Switch width-fill / whole-page and recompute the fit base. */
    setFitMode(mode) {
      if (mode !== "width" && mode !== "page") return fitMode;
      if (mode === fitMode) return fitMode;
      fitMode = mode;
      fitPx = 0;
      applySize();
      paintOverlay();
      scheduleHiRes();
      return fitMode;
    },
    /** Re-fit the page into the wrap at zoom 1 (recomputes the fit base). */
    fit() {
      fitPx = 0;
      return setZoomValue(1, true);
    },
    syncTool() {
      layer.dataset.tool = getTool();
    },
    /**
     * Move every selected layer on the current page as one rigid block.
     * @param {number} dxPt
     * @param {number} dyPt
     */
    nudge(dxPt, dyPt) {
      const targets = getObjects().filter(
        (item) => getSelectedIds().includes(item.id) && item.pageIndex === pageIndex
      );
      if (!targets.length) return false;
      const allowed = clampGroupDelta(targets, dxPt, dyPt, visualWidth, visualHeight);
      if (allowed.dx === 0 && allowed.dy === 0) return false;
      for (const obj of targets) {
        obj.x += allowed.dx;
        obj.y += allowed.dy;
        if (obj.points) {
          obj.points = obj.points.map((point) => ({ x: point.x + allowed.dx, y: point.y + allowed.dy }));
        }
      }
      paintOverlay();
      onChange();
      return true;
    },
    focusSelectedText() {
      focusSelectedText();
    },
    /**
     * Grow the single selected text box so its content fits after a style
     * change (size/bold/italic). Without this the text clips and looks deleted.
     */
    fitSelectedBox() {
      const ids = getSelectedIds();
      if (ids.length !== 1) return;
      const obj = getObjects().find((item) => item.id === ids[0]);
      if (!obj || obj.type !== "text") return;
      const node = layer.querySelector(`[data-id="${obj.id}"]`);
      const area = node?.querySelector("textarea");
      if (area instanceof HTMLTextAreaElement) growTextArea(area, obj);
    },
    /**
     * Scale every selected layer on the current page around their union
     * center. Points of ink strokes scale too. Returns false when nothing
     * could move (caller keeps/discards its history entry).
     * @param {number} factor
     */
    scaleSelected(factor) {
      if (!(factor > 0) || factor === 1) return false;
      const targets = getObjects().filter(
        (item) => getSelectedIds().includes(item.id) && item.pageIndex === pageIndex
      );
      if (!targets.length) return false;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const obj of targets) {
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x + obj.width);
        maxY = Math.max(maxY, obj.y + obj.height);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      for (const obj of targets) {
        const width = Math.max(MIN_PT, obj.width * factor);
        const height = Math.max(MIN_PT, obj.height * factor);
        const ncx = cx + (obj.x + obj.width / 2 - cx) * factor;
        const ncy = cy + (obj.y + obj.height / 2 - cy) * factor;
        const next = { x: ncx - width / 2, y: ncy - height / 2, width, height };
        clampBox(next, visualWidth, visualHeight);
        if (obj.points) {
          obj.points = obj.points.map((point) => ({
            x: cx + (point.x - cx) * factor,
            y: cy + (point.y - cy) * factor
          }));
        }
        Object.assign(obj, next);
      }
      paintOverlay();
      onChange();
      return true;
    },
    /** Mirror side-panel text into the on-canvas textarea (when not focused). */
    syncSelectedText(value) {
      const ids = getSelectedIds();
      if (ids.length !== 1) return;
      const node = layer.querySelector(`.edit-obj[data-id="${ids[0]}"]`);
      const area = node?.querySelector("textarea");
      if (!(area instanceof HTMLTextAreaElement) || document.activeElement === area) return;
      const obj = getObjects().find((item) => item.id === ids[0]);
      if (!obj) return;
      area.value = value || "";
      growTextArea(area, obj);
    },
    async destroy() {
      await closePdf();
      endLiveInk();
      detach();
    }
  };
}
