/**
 * Interactive page board for the edit overlay.
 * Object rectangles live in visual PDF space (origin bottom-left, upright).
 *
 * Selection model: every tool manipulates objects directly (click moves,
 * handles resize/rotate, text focuses for typing). The select tool never
 * activates itself — it only multi-selects (click / ctrl-click / marquee)
 * so several layers can be moved, duplicated or deleted together.
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
import { FONT } from "./text-png.js";
import { MIN_BOX_PX, fitPageCssWidth, stabilizeFitPx } from "./fit.js";

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

  /** CSS px per pt at zoom 1 — fit the page into the visible wrap (fills it). */
  function computeFitPx() {
    if (!visualWidth || !visualHeight) return 0;
    const { w, h } = availableBox();
    return fitPageCssWidth(visualWidth, visualHeight, w, h);
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
        const padPx = Math.max(2, fontSize * 0.18) * scale;
        node.style.color = obj.color || "#1E3A8A";
        node.style.fontFamily = FONT;
        node.style.fontWeight = obj.bold ? "700" : "400";
        node.style.fontStyle = obj.italic ? "italic" : "normal";
        node.style.textDecoration = obj.underline ? "underline" : "none";
        node.style.fontSize = `${fontSize * scale}px`;
        node.style.lineHeight = "1.45";
        node.style.textAlign = obj.align || "right";
        node.style.padding = `${padPx}px`;
        if (obj.id === singleId || obj.id === keepFocusId) {
          const area = document.createElement("textarea");
          area.value = obj.text || "";
          area.dir = "rtl";
          area.maxLength = 2000;
          area.addEventListener("pointerdown", (event) => event.stopPropagation());
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
          requestAnimationFrame(() => {
            if (area.isConnected) growTextArea(area, obj);
          });
        } else {
          const preview = document.createElement("div");
          preview.className = "edit-obj__text";
          preview.textContent = obj.text || "نص";
          node.append(preview);
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

  function pointerDown(event) {
    if (event.target instanceof HTMLTextAreaElement) return;
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

    if (tool === "rect" || tool === "ellipse" || tool === "triangle") {
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
      if (width < 8 || height < 8) return;
      const style = getStyle();
      const box = {
        x: Math.min(start.x, visual.x),
        y: Math.min(start.y, visual.y),
        width,
        height
      };
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
        strokeWidth: style.strokeWidth
      });
      return;
    }

    if (mode === "move-group" || mode === "move" || mode === "rotate" || FREE_HANDLES.includes(mode)) {
      if (!drag.dirty && drag.historyPushed) onDiscardHistory?.();
      drag = null;
      paintOverlay();
      onChange();
      return;
    }

    drag = null;
  }

  function onLayerKey(event) {
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
      const area = layer.querySelector(".edit-obj.is-selected textarea");
      if (area instanceof HTMLTextAreaElement) area.focus();
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
