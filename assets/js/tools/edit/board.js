import { ARABIC_FONTS } from "./text-png.js";
import {
  bboxFromPoints,
  clampedMove,
  clampBox,
  combinedBoundingBox,
  distToSegment,
  normAngle,
  pointInsideObject,
  rotatedAabb,
  rotatePoint,
  scalePoints,
  snapBox,
  translatePoints,
  worldToLocal
} from "./coords.js";

/**
 * Interactive canvas controller for the PDF Editor.
 * Handles selection, multi-selection marquee, moving, resizing, rotating,
 * inline WYSIWYG text editing, pen drawing, eraser, shapes, and smart snapping guides.
 *
 * @param {object} options
 * @param {HTMLElement} options.layer
 * @param {HTMLElement} options.viewport
 * @param {HTMLElement} options.board
 * @param {HTMLElement} options.guidesWrap
 * @param {HTMLElement} options.floatingBar
 * @param {() => number} options.pageW
 * @param {() => number} options.pageH
 * @param {() => number} options.zoom
 * @param {() => string} options.activeTool
 * @param {() => any} options.getStyle
 * @param {() => any[]} options.getObjects
 * @param {(objects: any[], pushHistory?: boolean) => void} options.setObjects
 * @param {(selectedIds: string[]) => void} options.onSelect
 * @param {(obj: any) => void} options.onCommitInlineText
 */
export function createBoard(options) {
  const {
    layer,
    viewport,
    board,
    guidesWrap,
    floatingBar,
    pageW,
    pageH,
    zoom,
    activeTool,
    getStyle,
    getObjects,
    setObjects,
    onSelect,
    onCommitInlineText
  } = options;

  let selectedIds = [];
  let isPanning = false;
  let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
  let activeOp = null;
  let liveInkPoints = [];
  let liveInkSvg = null;
  let activeTextarea = null;

  function toPageCoords(event) {
    if (!layer?.getBoundingClientRect) return { x: event.clientX || 0, y: event.clientY || 0 };
    const rect = layer.getBoundingClientRect();
    const z = zoom() || 1;
    const clientX = event.clientX || 0;
    const clientY = event.clientY || 0;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return {
      x: screenX / z,
      y: (rect.height - screenY) / z
    };
  }

  function renderGuides(guides = []) {
    if (!guidesWrap) return;
    guidesWrap.innerHTML = "";
    const z = zoom() || 1;
    const h = pageH ? pageH() : 842;
    for (const g of guides) {
      const line = document.createElement("div");
      line.className = `edit-guide edit-guide--${g.orientation}`;
      if (g.orientation === "v") {
        line.style.left = `${g.pos * z}px`;
      } else {
        line.style.top = `${(h - g.pos) * z}px`;
      }
      guidesWrap.append(line);
    }
  }

  function clearGuides() {
    if (guidesWrap) guidesWrap.innerHTML = "";
  }

  function updateFloatingBar() {
    if (!floatingBar) return;
    if (selectedIds.length === 0 || activeTextarea) {
      floatingBar.hidden = true;
      return;
    }
    const objects = getObjects().filter((o) => selectedIds.includes(o.id));
    if (!objects.length) {
      floatingBar.hidden = true;
      return;
    }
    const bbox = combinedBoundingBox(objects);
    if (!bbox) {
      floatingBar.hidden = true;
      return;
    }
    const z = zoom() || 1;
    const h = pageH ? pageH() : 842;
    const topPx = (h - (bbox.y + bbox.height)) * z;
    const centerPx = (bbox.x + bbox.width / 2) * z;

    floatingBar.hidden = false;
    floatingBar.style.left = `${centerPx}px`;

    // Smart position: if object is near the top edge, show bar below instead
    if (topPx < 50) {
      const bottomPx = (h - bbox.y) * z;
      floatingBar.style.top = `${bottomPx}px`;
      floatingBar.classList.add("is-below");
    } else {
      floatingBar.style.top = `${Math.max(10, topPx)}px`;
      floatingBar.classList.remove("is-below");
    }
  }

  function startInlineEditor(obj) {
    if (activeTextarea) commitInlineEditor();
    const el = layer.querySelector(`[data-id="${obj.id}"]`);
    if (!el) return;

    const z = zoom() || 1;
    const textarea = document.createElement("textarea");
    textarea.className = "edit-inline-textarea";
    textarea.value = obj.text || "";
    textarea.style.fontSize = `${(obj.fontSize || 18) * z}px`;
    textarea.style.fontFamily = ARABIC_FONTS[obj.fontFamily] || obj.fontFamily || "inherit";
    textarea.style.color = obj.color || "#1E3A8A";
    textarea.style.textAlign = obj.align || "right";
    textarea.style.fontWeight = obj.bold ? "bold" : "normal";
    textarea.style.fontStyle = obj.italic ? "italic" : "normal";
    textarea.style.direction = "rtl";
    textarea.setAttribute("dir", "rtl");
    if (obj.bgOn && obj.bgColor) {
      textarea.style.backgroundColor = obj.bgColor;
    }

    el.append(textarea);
    textarea.focus();
    if (typeof textarea.select === "function") textarea.select();
    activeTextarea = { textarea, obj };

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        commitInlineEditor();
      }
      e.stopPropagation();
    });

    textarea.addEventListener("blur", () => {
      commitInlineEditor();
    });
  }

  function commitInlineEditor() {
    if (!activeTextarea) return;
    const { textarea, obj } = activeTextarea;
    const newText = textarea.value;
    textarea.remove();
    activeTextarea = null;

    if (newText !== obj.text) {
      const list = getObjects().map((o) => (o.id === obj.id ? { ...o, text: newText } : o));
      setObjects(list, true);
      onCommitInlineText({ ...obj, text: newText });
    }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (activeTextarea && !activeTextarea.textarea.contains(event.target)) {
      commitInlineEditor();
    }

    const tool = activeTool();
    const pt = toPageCoords(event);
    const pw = pageW ? pageW() : 595;
    const ph = pageH ? pageH() : 842;

    // 1. Hand / Pan tool or Spacebar held
    if (tool === "hand" || event.spaceKey) {
      isPanning = true;
      panStart = {
        x: event.clientX || 0,
        y: event.clientY || 0,
        scrollLeft: viewport?.scrollLeft || 0,
        scrollTop: viewport?.scrollTop || 0
      };
      viewport?.classList?.add("is-panning");
      return;
    }

    // 2. Click on existing object handle / rotate / body
    const handleEl = event.target?.closest ? event.target.closest(".edit-handle") : null;
    const rotateEl = event.target?.closest ? event.target.closest(".edit-rotate") : null;
    const objEl = event.target?.closest ? event.target.closest(".edit-obj") : null;

    if (tool === "select" || tool === "eraser") {
      if (tool === "eraser") {
        if (objEl) {
          const id = objEl.dataset.id;
          const remaining = getObjects().filter((o) => o.id !== id);
          setObjects(remaining, true);
          selectedIds = selectedIds.filter((i) => i !== id);
          onSelect(selectedIds);
          updateFloatingBar();
        }
        return;
      }

      if (rotateEl && selectedIds.length === 1) {
        const obj = getObjects().find((o) => o.id === selectedIds[0]);
        if (obj && !obj.locked) {
          // Push history BEFORE the rotate begins
          setObjects(getObjects(), true);
          activeOp = {
            type: "rotate",
            objId: obj.id,
            cx: obj.x + obj.width / 2,
            cy: obj.y + obj.height / 2,
            startAngle: obj.rotation || 0,
            startPointerAngle: Math.atan2(pt.y - (obj.y + obj.height / 2), pt.x - (obj.x + obj.width / 2))
          };
          return;
        }
      }

      if (handleEl && selectedIds.length === 1) {
        const obj = getObjects().find((o) => o.id === selectedIds[0]);
        if (obj && !obj.locked) {
          const handle = handleEl.dataset.handle;
          // Push history BEFORE the resize begins
          setObjects(getObjects(), true);
          activeOp = {
            type: "resize",
            handle,
            objId: obj.id,
            origin: { x: obj.x, y: obj.y, width: obj.width, height: obj.height },
            startPt: pt
          };
          return;
        }
      }

      if (objEl) {
        const id = objEl.dataset.id;
        const obj = getObjects().find((o) => o.id === id);
        if (obj) {
          if (event.shiftKey) {
            if (selectedIds.includes(id)) {
              selectedIds = selectedIds.filter((i) => i !== id);
            } else {
              selectedIds = [...selectedIds, id];
            }
          } else {
            if (!selectedIds.includes(id)) {
              selectedIds = [id];
            }
          }
          onSelect(selectedIds);
          updateFloatingBar();

          if (!obj.locked) {
            // Push history BEFORE the move begins so undo restores original position
            setObjects(getObjects(), true);
            activeOp = {
              type: "move",
              startPt: pt,
              objects: getObjects()
                .filter((o) => selectedIds.includes(o.id))
                .map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }))
            };
          }
          return;
        }
      }

      // Clicked on empty canvas in Select mode -> Start Marquee selection
      if (!event.shiftKey) {
        selectedIds = [];
        onSelect(selectedIds);
        updateFloatingBar();
      }
      activeOp = {
        type: "marquee",
        startPt: pt
      };
      return;
    }

    // 3. Drawing tools: Pen
    if (tool === "pen") {
      liveInkPoints = [pt];
      const style = getStyle();
      activeOp = {
        type: "pen",
        color: style.penColor || "#1E3A8A",
        strokeWidth: style.penWeight || 2.2,
        points: liveInkPoints
      };
      return;
    }

    // 4. Creation tools: text, highlight, whiteout, rect, ellipse, triangle, arrow, line, stamp
    const style = getStyle();
    activeOp = {
      type: "create",
      tool,
      startPt: pt,
      style
    };
  }

  function onPointerMove(event) {
    if (isPanning) {
      const dx = (event.clientX || 0) - panStart.x;
      const dy = (event.clientY || 0) - panStart.y;
      if (viewport) {
        viewport.scrollLeft = panStart.scrollLeft - dx;
        viewport.scrollTop = panStart.scrollTop - dy;
      }
      return;
    }

    if (!activeOp) return;
    const pt = toPageCoords(event);
    const pw = pageW ? pageW() : 595;
    const ph = pageH ? pageH() : 842;

    if (activeOp.type === "move") {
      const dx = pt.x - activeOp.startPt.x;
      const dy = pt.y - activeOp.startPt.y;

      const otherObjects = getObjects().filter((o) => !selectedIds.includes(o.id));
      const primary = activeOp.objects[0];
      if (!primary) return;
      const testBox = { x: primary.x + dx, y: primary.y + dy, width: primary.width, height: primary.height };
      const snapped = snapBox(testBox, pw, ph, otherObjects, 6);
      renderGuides(snapped.guides);

      const realDx = snapped.x - primary.x;
      const realDy = snapped.y - primary.y;

      const updated = getObjects().map((o) => {
        const init = activeOp.objects.find((orig) => orig.id === o.id);
        if (!init) return o;
        return {
          ...o,
          x: Math.max(0, Math.min(pw - o.width, init.x + realDx)),
          y: Math.max(0, Math.min(ph - o.height, init.y + realDy))
        };
      });
      setObjects(updated, false);
      updateFloatingBar();
      return;
    }

    if (activeOp.type === "resize") {
      const { handle, objId, origin, startPt } = activeOp;
      const dx = pt.x - startPt.x;
      const dy = pt.y - startPt.y;
      let { x, y, width, height } = origin;

      if (handle.includes("e")) width = Math.max(16, origin.width + dx);
      if (handle.includes("w")) {
        const newW = Math.max(16, origin.width - dx);
        x = origin.x + (origin.width - newW);
        width = newW;
      }
      if (handle.includes("n")) height = Math.max(16, origin.height + dy);
      if (handle.includes("s")) {
        const newH = Math.max(16, origin.height - dy);
        y = origin.y + (origin.height - newH);
        height = newH;
      }

      const updated = getObjects().map((o) => {
        if (o.id !== objId) return o;
        return { ...o, x, y, width, height };
      });
      setObjects(updated, false);
      updateFloatingBar();
      return;
    }

    if (activeOp.type === "rotate") {
      const { objId, cx, cy, startAngle, startPointerAngle } = activeOp;
      const curPointerAngle = Math.atan2(pt.y - cy, pt.x - cx);
      let angleDeg = startAngle - ((curPointerAngle - startPointerAngle) * 180) / Math.PI;
      if (event.shiftKey) {
        angleDeg = Math.round(angleDeg / 15) * 15;
      }
      const updated = getObjects().map((o) => (o.id === objId ? { ...o, rotation: normAngle(angleDeg) } : o));
      setObjects(updated, false);
      updateFloatingBar();
      return;
    }

    if (activeOp.type === "pen") {
      activeOp.points.push(pt);
      renderLiveInk(activeOp.points, activeOp.color, activeOp.strokeWidth);
      return;
    }

    if (activeOp.type === "marquee") {
      renderMarquee(activeOp.startPt, pt);
      return;
    }

    if (activeOp.type === "create") {
      renderCreationGhost(activeOp.startPt, pt, activeOp.tool);
      return;
    }
  }

  function onPointerUp(event) {
    if (isPanning) {
      isPanning = false;
      viewport?.classList?.remove("is-panning");
    }

    clearGuides();
    removeMarquee();
    removeCreationGhost();
    removeLiveInk();

    if (!activeOp) return;
    const pt = toPageCoords(event);
    const pw = pageW ? pageW() : 595;
    const ph = pageH ? pageH() : 842;
    const op = activeOp;
    activeOp = null;

    if (op.type === "move" || op.type === "resize" || op.type === "rotate") {
      // History was already pushed in onPointerDown; just commit the final state
      setObjects(getObjects(), false);
      updateFloatingBar();
      return;
    }

    if (op.type === "pen") {
      if (op.points.length > 1) {
        const box = bboxFromPoints(op.points, 4);
        const newObj = {
          id: `ink_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "ink",
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          points: op.points,
          color: op.color,
          strokeWidth: op.strokeWidth,
          rotation: 0
        };
        setObjects([...getObjects(), newObj], true);
        selectedIds = [newObj.id];
        onSelect(selectedIds);
        updateFloatingBar();
      }
      return;
    }

    if (op.type === "marquee") {
      const minX = Math.min(op.startPt.x, pt.x);
      const maxX = Math.max(op.startPt.x, pt.x);
      const minY = Math.min(op.startPt.y, pt.y);
      const maxY = Math.max(op.startPt.y, pt.y);

      const found = getObjects().filter((o) => {
        const cx = o.x + o.width / 2;
        const cy = o.y + o.height / 2;
        return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      });
      selectedIds = found.map((o) => o.id);
      onSelect(selectedIds);
      updateFloatingBar();
      return;
    }

    if (op.type === "create") {
      const minX = Math.min(op.startPt.x, pt.x);
      const maxX = Math.max(op.startPt.x, pt.x);
      const minY = Math.min(op.startPt.y, pt.y);
      const maxY = Math.max(op.startPt.y, pt.y);

      let w = Math.max(24, maxX - minX);
      let h = Math.max(24, maxY - minY);

      let x = minX;
      let y = minY;

      if (Math.hypot(maxX - minX, maxY - minY) < 8) {
        if (op.tool === "text") { w = 220; h = 60; }
        else if (op.tool === "stamp") { w = 180; h = 80; }
        else if (op.tool === "arrow" || op.tool === "line" || op.tool === "double-arrow") { w = 160; h = 32; }
        else if (op.tool === "highlight" || op.tool === "whiteout") { w = 180; h = 32; }
        else { w = 120; h = 100; }
        x = Math.max(0, Math.min(pw - w, op.startPt.x - w / 2));
        y = Math.max(0, Math.min(ph - h, op.startPt.y - h / 2));
      }

      const id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let newObj = null;

      if (op.tool === "text") {
        newObj = {
          id,
          type: "text",
          x,
          y,
          width: w,
          height: h,
          text: "اكتب هنا",
          fontSize: op.style.fontSize || 18,
          fontFamily: op.style.fontFamily || "naskh",
          color: op.style.textColor || "#1E3A8A",
          bold: op.style.bold || false,
          italic: op.style.italic || false,
          underline: op.style.underline || false,
          strike: op.style.strike || false,
          align: op.style.align || "right",
          bgOn: op.style.bgOn || false,
          bgColor: op.style.bgColor || "#FFFFFF",
          rotation: 0
        };
      } else if (op.tool === "highlight") {
        newObj = {
          id,
          type: "highlight",
          x,
          y,
          width: w,
          height: h,
          color: op.style.hlColor || "#FDE047",
          opacity: op.style.hlOpacity != null ? op.style.hlOpacity : 0.35,
          rotation: 0
        };
      } else if (op.tool === "whiteout") {
        newObj = {
          id,
          type: "whiteout",
          x,
          y,
          width: w,
          height: h,
          color: op.style.woColor || "#FFFFFF",
          stroke: op.style.woBorder ? "#E2E8F0" : null,
          rotation: 0
        };
      } else if (op.tool === "stamp") {
        newObj = {
          id,
          type: "stamp",
          x,
          y,
          width: w,
          height: h,
          label: op.style.stampText || "معتمد",
          sub: new Date().toLocaleDateString("ar-EG"),
          color: op.style.stampColor || "#DC2626",
          shape: "rect",
          rotation: 0
        };
      } else if (["rect", "ellipse", "triangle", "arrow", "line", "double-arrow"].includes(op.tool)) {
        newObj = {
          id,
          type: "shape",
          kind: op.tool,
          x,
          y,
          width: w,
          height: h,
          fillOn: op.style.fillOn != null ? op.style.fillOn : true,
          fill: op.style.fillColor || "#BFDBFE",
          stroke: op.style.strokeColor || "#1E3A8A",
          strokeWidth: op.style.strokeWidth || 1.5,
          opacity: op.style.shapeOpacity != null ? op.style.shapeOpacity : 1,
          rotation: 0
        };
      }

      if (newObj) {
        setObjects([...getObjects(), newObj], true);
        selectedIds = [newObj.id];
        onSelect(selectedIds);
        updateFloatingBar();

        if (newObj.type === "text") {
          setTimeout(() => startInlineEditor(newObj), 40);
        }
      }
    }
  }

  function onDoubleClick(event) {
    const objEl = event.target?.closest ? event.target.closest('.edit-obj[data-type="text"]') : null;
    if (!objEl) return;
    const id = objEl.dataset.id;
    const obj = getObjects().find((o) => o.id === id);
    if (obj) {
      startInlineEditor(obj);
    }
  }

  function renderLiveInk(points, color, strokeWidth) {
    if (!liveInkSvg) {
      liveInkSvg = document.createElement("svg");
      liveInkSvg.classList.add("edit-ink-live");
      layer.append(liveInkSvg);
    }
    const z = zoom() || 1;
    const h = pageH ? pageH() : 842;
    const d = points
      .map((p, i) => `${i ? "L" : "M"} ${(p.x * z).toFixed(1)} ${((h - p.y) * z).toFixed(1)}`)
      .join(" ");
    liveInkSvg.innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth * z}" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  function removeLiveInk() {
    if (liveInkSvg) {
      liveInkSvg.remove();
      liveInkSvg = null;
    }
  }

  function renderMarquee(start, current) {
    let el = layer.querySelector(".edit-marquee");
    if (!el) {
      el = document.createElement("div");
      el.className = "edit-marquee";
      layer.append(el);
    }
    const z = zoom() || 1;
    const h = pageH ? pageH() : 842;
    const minX = Math.min(start.x, current.x);
    const maxX = Math.max(start.x, current.x);
    const minY = Math.min(start.y, current.y);
    const maxY = Math.max(start.y, current.y);

    el.style.left = `${minX * z}px`;
    el.style.top = `${(h - maxY) * z}px`;
    el.style.width = `${(maxX - minX) * z}px`;
    el.style.height = `${(maxY - minY) * z}px`;
  }

  function removeMarquee() {
    layer.querySelector(".edit-marquee")?.remove();
  }

  function renderCreationGhost(start, current, tool) {
    let el = layer.querySelector(".edit-ghost");
    if (!el) {
      el = document.createElement("div");
      el.className = "edit-ghost";
      layer.append(el);
    }
    const z = zoom() || 1;
    const h = pageH ? pageH() : 842;
    const minX = Math.min(start.x, current.x);
    const maxX = Math.max(start.x, current.x);
    const minY = Math.min(start.y, current.y);
    const maxY = Math.max(start.y, current.y);

    el.style.left = `${minX * z}px`;
    el.style.top = `${(h - maxY) * z}px`;
    el.style.width = `${(maxX - minX) * z}px`;
    el.style.height = `${(maxY - minY) * z}px`;
    el.style.borderRadius = tool === "ellipse" ? "50%" : "3px";
  }

  function removeCreationGhost() {
    layer.querySelector(".edit-ghost")?.remove();
  }

  layer?.addEventListener?.("pointerdown", onPointerDown);
  if (typeof window !== "undefined") {
    window.addEventListener?.("pointermove", onPointerMove);
    window.addEventListener?.("pointerup", onPointerUp);
  }
  layer?.addEventListener?.("dblclick", onDoubleClick);

  return {
    destroy() {
      layer?.removeEventListener?.("pointerdown", onPointerDown);
      if (typeof window !== "undefined") {
        window.removeEventListener?.("pointermove", onPointerMove);
        window.removeEventListener?.("pointerup", onPointerUp);
      }
      layer?.removeEventListener?.("dblclick", onDoubleClick);
    },
    setSelectedIds(ids) {
      selectedIds = ids;
      updateFloatingBar();
    },
    getSelectedIds() {
      return selectedIds;
    },
    updateFloatingBar
  };
}
