import { hexToRgb, lib } from "../../pdf/core.js";
import { throwIfCancelled, updateProgress } from "../../ui/feedback.js";
import { orientedPoints, rotatePoint, rotatedAabb, visualPointToMedia, visualRectToMedia } from "./coords.js";
import { bakeRotatedPng, pngToCanvas, renderTextBoxPng, rotatePngQuarter } from "./text-png.js";

function objectCorners(obj) {
  const { x, y, width, height, rotation = 0 } = obj;
  const ox = x + width / 2;
  const oy = y + height / 2;
  return [
    rotatePoint(x, y, ox, oy, rotation),
    rotatePoint(x + width, y, ox, oy, rotation),
    rotatePoint(x + width, y + height, ox, oy, rotation),
    rotatePoint(x, y + height, ox, oy, rotation)
  ];
}

function trianglePoints(obj) {
  const { x, y, width, height, rotation = 0 } = obj;
  const ox = x + width / 2;
  const oy = y + height / 2;
  return [
    rotatePoint(x + width / 2, y + height, ox, oy, rotation),
    rotatePoint(x, y, ox, oy, rotation),
    rotatePoint(x + width, y, ox, oy, rotation)
  ];
}

function mapPoints(pageAngle, mediaW, mediaH, points) {
  return points.map((point) => visualPointToMedia(pageAngle, mediaW, mediaH, point.x, point.y));
}

function svgPath(points, close) {
  const cmds = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
  return `${cmds.join(" ")}${close ? " Z" : ""}`;
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Local offset from object center, then apply object rotation. */
function alongLocal(obj, dx, dy) {
  const ox = obj.x + obj.width / 2;
  const oy = obj.y + obj.height / 2;
  return rotatePoint(ox + dx, oy + dy, ox, oy, obj.rotation || 0);
}

/**
 * Draw every overlay object onto the page content stream (flatten).
 * Text and images become PNGs. Shapes and ink are vectors.
 *
 * @param {Uint8Array} bytes
 * @param {Array<any>} objects
 */
export async function flattenObjects(bytes, objects) {
  const pdf = lib();
  const target = await pdf.PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = target.getPages();
  const roundCap = pdf.LineCapStyle?.Round;
  /** @type {Map<Uint8Array, Array<any>>} */
  const embeds = new Map();

  async function imageFor(png, ccw) {
    let pack = embeds.get(png);
    if (!pack) {
      pack = [null, null, null, null];
      embeds.set(png, pack);
    }
    if (!pack[ccw]) {
      const oriented = ccw ? await rotatePngQuarter(png, ccw) : png;
      pack[ccw] = await target.embedPng(oriented);
    }
    return pack[ccw];
  }

  async function stampPng(page, pageAngle, mediaW, mediaH, png, visual) {
    const placed = visualRectToMedia(pageAngle, mediaW, mediaH, visual);
    const image = await imageFor(png, placed.ccw);
    page.drawImage(image, {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height
    });
  }

  const total = Math.max(1, objects.length);
  for (const [index, obj] of objects.entries()) {
    throwIfCancelled();
    const page = pages[obj.pageIndex];
    if (!page) continue;
    const { width: mediaW, height: mediaH } = page.getSize();
    const pageAngle = page.getRotation().angle || 0;

    if (obj.type === "text") {
      if (!String(obj.text || "").trim()) continue;
      const painted = await renderTextBoxPng(obj.text || "", {
        width: obj.width,
        height: obj.height,
        fontSize: obj.fontSize || 18,
        color: obj.color || "#1E3A8A",
        bold: Boolean(obj.bold),
        align: obj.align || "right"
      });
      let png = painted.bytes;
      let box = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      if (obj.rotation) {
        const aabb = rotatedAabb(obj.x, obj.y, obj.width, obj.height, obj.rotation);
        const baked = await bakeRotatedPng(painted.canvas, box, obj.rotation, aabb);
        png = baked.bytes;
        box = aabb;
      }
      await stampPng(page, pageAngle, mediaW, mediaH, png, box);
    } else if (obj.type === "image" && obj.png) {
      let png = obj.png;
      let box = { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
      if (obj.rotation) {
        const aabb = rotatedAabb(obj.x, obj.y, obj.width, obj.height, obj.rotation);
        const source = await pngToCanvas(obj.png);
        const baked = await bakeRotatedPng(source, box, obj.rotation, aabb);
        png = baked.bytes;
        box = aabb;
      }
      await stampPng(page, pageAngle, mediaW, mediaH, png, box);
    } else if (obj.type === "shape") {
      const fill = obj.fillOn === false ? undefined : hexToRgb(obj.fill || "#8AA4E0");
      const stroke = hexToRgb(obj.stroke || "#1E3A8A");
      const borderWidth = Math.max(0, finiteNumber(obj.strokeWidth, 1.5));

      if (obj.kind === "ellipse") {
        const c = alongLocal(obj, 0, 0);
        const right = alongLocal(obj, obj.width / 2, 0);
        const top = alongLocal(obj, 0, obj.height / 2);
        const mc = visualPointToMedia(pageAngle, mediaW, mediaH, c.x, c.y);
        const mr = visualPointToMedia(pageAngle, mediaW, mediaH, right.x, right.y);
        const mt = visualPointToMedia(pageAngle, mediaW, mediaH, top.x, top.y);
        const xScale = Math.hypot(mr.x - mc.x, mr.y - mc.y);
        const yScale = Math.hypot(mt.x - mc.x, mt.y - mc.y);
        const ccw = (Math.atan2(mr.y - mc.y, mr.x - mc.x) * 180) / Math.PI;
        page.drawEllipse({
          x: mc.x,
          y: mc.y,
          xScale: Math.max(0.5, xScale),
          yScale: Math.max(0.5, yScale),
          rotate: pdf.degrees(ccw),
          color: fill,
          borderColor: stroke,
          borderWidth
        });
      } else {
        const pts = obj.kind === "triangle" ? trianglePoints(obj) : objectCorners(obj);
        page.drawSvgPath(svgPath(mapPoints(pageAngle, mediaW, mediaH, pts), true), {
          x: 0,
          y: 0,
          color: fill,
          borderColor: stroke,
          borderWidth
        });
      }
    } else if (obj.type === "ink" && obj.points?.length > 1) {
      const color = hexToRgb(obj.color || "#1E3A8A");
      const thickness = Math.max(0.6, Number(obj.strokeWidth) || 2);
      const mapped = mapPoints(pageAngle, mediaW, mediaH, orientedPoints(obj, obj.points));
      for (let i = 1; i < mapped.length; i += 1) {
        const line = {
          start: mapped[i - 1],
          end: mapped[i],
          thickness,
          color
        };
        if (roundCap != null) line.lineCap = roundCap;
        page.drawLine(line);
      }
    }

    if (index % 4 === 0) {
      updateProgress({
        percent: (index / total) * 90,
        detail: `عنصر ${index + 1} من ${objects.length}`
      });
    }
  }

  throwIfCancelled();
  updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
  return target.save();
}
