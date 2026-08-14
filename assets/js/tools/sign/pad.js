/**
 * Signature drawing pad. The bitmap stays transparent; CSS paints the white
 * ground so the exported PNG composites cleanly over the page.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ signal?: AbortSignal }} [options]
 */
export function attachPad(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر فتح لوحة الرسم.");

  let drawing = false;
  let lastX = 0;
  let lastY = 0;
  let ink = "#141c17";
  let weight = 2.4;
  let dirty = false;

  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(200, Math.floor(canvas.clientWidth || 240));
    const cssH = 156;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = `${cssH}px`;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    applyStroke();
    dirty = false;
  }

  function applyStroke() {
    const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = weight * dpr;
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function down(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const at = point(event);
    lastX = at.x;
    lastY = at.y;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(lastX, lastY, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    dirty = true;
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const at = point(event);
    const midX = (lastX + at.x) / 2;
    const midY = (lastY + at.y) / 2;
    ctx.quadraticCurveTo(lastX, lastY, midX, midY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    lastX = at.x;
    lastY = at.y;
  }

  function up(event) {
    if (!drawing) return;
    drawing = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  const signal = options.signal;
  canvas.addEventListener("pointerdown", down, { signal });
  canvas.addEventListener("pointermove", move, { signal });
  canvas.addEventListener("pointerup", up, { signal });
  canvas.addEventListener("pointercancel", up, { signal });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });

  fit();

  return {
    fit,
    isDirty: () => dirty,
    setColor(value) {
      ink = value || "#141c17";
      applyStroke();
    },
    setWeight(value) {
      weight = Math.min(6, Math.max(1.2, Number(value) || 2.4));
      applyStroke();
    },
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
    },
    snapshot() {
      return canvas;
    }
  };
}
