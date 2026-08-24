/**
 * Interactive page board for the edit overlay.
 * Object rectangles live in visual PDF space (origin bottom-left, upright).
 */
import { openDocument } from "../../pdf/core.js";
import {
  MIN_PT,
  bboxFromPoints,
  clampBox,
  clampedMove,
  scalePoints,
  worldToLocal
} from "./coords.js";
import { FONT } from "./text-png.js";

const CORNER_HANDLES = ["nw", "ne", "sw", "se"];
const FREE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.layer
 * @param {HTMLElement} [options.wrap]
 * @param {() => Array<any>} options.getObjects
 * @param {() => string} options.getSelectedId
 * @param {(id: string) => void} options.setSelectedId
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
    getSelectedId,
    setSelectedId,
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
  let zoom = 1;
  let fitPx = 0;
  let hiResTimer = 0;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 2.5;

  function displayScale() {
    return canvas.offsetWidth / Math.max(1, visualWidth);
  }

  function availableBox() {
    if (!wrap) return { w: 760, h: 980 };
    const cs = getComputedStyle(wrap);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return {
      w: Math.max(80, wrap.clientWidth - padX),
      h: Math.max(80, wrap.clientHeight - padY)
    };
  }

  /** CSS px per pt at zoom 1 — fit the page inside the visible wrap, never upscale past 1:1. */
  function computeFitPx() {
    if (!visualWidth || !visualHeight) return 0;
    const { w, h } = availableBox();
    const byHeight = h * (visualWidth / visualHeight);
    return Math.max(120, Math.min(w, byHeight, visualWidth));
  }

  /**
   * Real layout sizing (no CSS transform): the canvas width drives offsetWidth,
   * so displayScale and every coordinate path stay exact at any zoom.
   */
  function applySize() {
    if (!visualWidth || !visualHeight) return;
    fitPx = computeFitPx();
    const nextWidth = `${Math.round(fitPx * zoom)}px`;
    if (canvas.style.width !== nextWidth) canvas.style.width = nextWidth;
    canvas.style.height = "auto";
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
    const selected = getSelectedId();
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
      const node = document.createElement("div");
      node.className = "edit-obj" + (obj.id === selected ? " is-selected" : "");
      node.dataset.id = obj.id;
      node.dataset.type = obj.type;
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", labelFor(obj));
      node.setAttribute("aria-selected", obj.id === selected ? "true" : "false");
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
        if (obj.id === selected || obj.id === keepFocusId) {
          const area = document.createElement("textarea");
          area.value = obj.text || "";
          area.dir = "rtl";
          area.maxLength = 2000;
          area.addEventListener("pointerdown", (event) => event.stopPropagation());
          area.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSelectedId("");
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

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    if (token !== generation) return;
    paintOverlay();
  }

  function pointerDown(event) {
    if (event.target instanceof HTMLTextAreaElement) return;
    const tool = getTool();
    const visual = clientToVisual(event.clientX, event.clientY);
    const handle = event.target.closest?.("[data-handle]");
    const node = event.target.closest?.(".edit-obj");

    if (tool === "select" || (node && handle) || (node && tool !== "pen")) {
      if (!node) {
        setSelectedId("");
        paintOverlay();
        onChange();
        return;
      }
      event.preventDefault();
      const obj = getObjects().find((item) => item.id === node.dataset.id);
      if (!obj) return;
      setSelectedId(obj.id);
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

    if (tool === "pen") {
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

    if (tool === "text") {
      event.preventDefault();
      const hit = hitObject(visual.x, visual.y);
      if (hit) {
        setSelectedId(hit.id);
        paintOverlay();
        onChange();
        return;
      }
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
        align: style.align
      });
      return;
    }

    if (tool === "rect" || tool === "ellipse" || tool === "triangle") {
      event.preventDefault();
      const hit = hitObject(visual.x, visual.y);
      if (hit) {
        setSelectedId(hit.id);
        paintOverlay();
        onChange();
        return;
      }
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
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const visual = clientToVisual(event.clientX, event.clientY);

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

    const node = layer.querySelector(`[data-id="${obj.id}"]`);
    if (node) positionNode(/** @type {HTMLElement} */ (node), obj);
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const mode = drag.mode;

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

    if (mode === "move" || mode === "rotate" || CORNER_HANDLES.includes(mode) || FREE_HANDLES.includes(mode)) {
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
      setSelectedId(node.dataset.id);
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
    applySize();
    paintOverlay();
  });
  observer.observe(sizeTarget);
  sizeTarget.addEventListener("wheel", onWheel, { passive: false });

  async function closePdf() {
    generation += 1;
    drag = null;
    ghost?.remove();
    ghost = null;
    endLiveInk();
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
    paintOverlay,
    async load(bytes) {
      await closePdf();
      pdf = await openDocument(bytes);
      return pdf.numPages;
    },
    async clear() {
      await closePdf();
    },
    showPage: renderPage,
    setZoom: setZoomValue,
    getZoom() {
      return zoom;
    },
    /** Re-fit the page into the wrap at zoom 1 (recomputes the fit base). */
    fit() {
      return setZoomValue(1, true);
    },
    syncTool() {
      layer.dataset.tool = getTool();
    },
    nudge(dxPt, dyPt) {
      const obj = getObjects().find((item) => item.id === getSelectedId());
      if (!obj || obj.pageIndex !== pageIndex) return false;
      const moved = clampedMove(obj, dxPt, dyPt, visualWidth, visualHeight);
      if (moved.dx === 0 && moved.dy === 0) return false;
      obj.x = moved.x;
      obj.y = moved.y;
      if (obj.points) {
        obj.points = obj.points.map((point) => ({ x: point.x + moved.dx, y: point.y + moved.dy }));
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
      const node = layer.querySelector(".edit-obj.is-selected");
      const area = node?.querySelector("textarea");
      if (!(area instanceof HTMLTextAreaElement) || document.activeElement === area) return;
      const obj = getObjects().find((item) => item.id === node?.dataset.id);
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
