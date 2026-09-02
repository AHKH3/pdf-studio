/**
 * Visual PDF space: origin at the bottom-left of the upright page the user sees.
 * Rotation is stored as clockwise degrees (matches CSS `rotate()`).
 */

export const MIN_PT = 14;

/** @param {number} angle */
export function normAngle(angle) {
  const a = ((Number(angle) || 0) % 360) + 360;
  return a % 360;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} cx
 * @param {number} cy
 * @param {number} clockwiseDeg
 */
export function rotatePoint(px, py, cx, cy, clockwiseDeg) {
  const rad = ((clockwiseDeg || 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} rotation
 */
export function rotatedAabb(x, y, width, height, rotation) {
  if (!rotation) return { x, y, width, height };
  const cx = x + width / 2;
  const cy = y + height / 2;
  const corners = [
    rotatePoint(x, y, cx, cy, rotation),
    rotatePoint(x + width, y, cx, cy, rotation),
    rotatePoint(x + width, y + height, cx, cy, rotation),
    rotatePoint(x, y + height, cx, cy, rotation)
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY
  };
}

/**
 * Local coords: origin at the unrotated box's bottom-left, y up.
 * @param {{ x: number; y: number; width: number; height: number; rotation?: number }} obj
 * @param {number} vx
 * @param {number} vy
 */
export function worldToLocal(obj, vx, vy) {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rad = ((obj.rotation || 0) * Math.PI) / 180;
  const dx = vx - cx;
  const dy = vy - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + obj.width / 2,
    y: dx * sin + dy * cos + obj.height / 2
  };
}

/**
 * Check if a point (vx, vy) is inside the object box, accounting for rotation.
 * @param {{ x: number; y: number; width: number; height: number; rotation?: number }} obj
 * @param {number} vx
 * @param {number} vy
 * @param {number} pad
 */
export function pointInsideObject(obj, vx, vy, pad = 0) {
  const local = worldToLocal(obj, vx, vy);
  return (
    local.x >= -pad &&
    local.x <= obj.width + pad &&
    local.y >= -pad &&
    local.y <= obj.height + pad
  );
}

/**
 * @param {Array<{ x: number; y: number }>} points
 * @param {number} pad
 */
export function bboxFromPoints(points, pad = 4) {
  if (!points.length) return { x: 0, y: 0, width: MIN_PT, height: MIN_PT };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(MIN_PT, maxX - minX + pad * 2),
    height: Math.max(MIN_PT, maxY - minY + pad * 2)
  };
}

/**
 * Combined bounding box of multiple objects.
 * @param {Array<{ x: number; y: number; width: number; height: number; rotation?: number }>} objects
 */
export function combinedBoundingBox(objects) {
  if (!objects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    const aabb = rotatedAabb(obj.x, obj.y, obj.width, obj.height, obj.rotation || 0);
    if (aabb.x < minX) minX = aabb.x;
    if (aabb.y < minY) minY = aabb.y;
    if (aabb.x + aabb.width > maxX) maxX = aabb.x + aabb.width;
    if (aabb.y + aabb.height > maxY) maxY = aabb.y + aabb.height;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

/**
 * @param {{ x: number; y: number; width: number; height: number }} box
 * @param {number} pageW
 * @param {number} pageH
 */
export function clampBox(box, pageW, pageH) {
  box.width = Math.min(pageW, Math.max(MIN_PT, box.width));
  box.height = Math.min(pageH, Math.max(MIN_PT, box.height));
  box.x = Math.min(Math.max(0, box.x), Math.max(0, pageW - box.width));
  box.y = Math.min(Math.max(0, box.y), Math.max(0, pageH - box.height));
  return box;
}

/**
 * Translate a box, then clamp.
 *
 * @param {{ x: number; y: number; width: number; height: number }} box
 * @param {number} dx
 * @param {number} dy
 * @param {number} pageW
 * @param {number} pageH
 */
export function clampedMove(box, dx, dy, pageW, pageH) {
  const next = { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
  clampBox(next, pageW, pageH);
  return {
    x: next.x,
    y: next.y,
    dx: next.x - box.x,
    dy: next.y - box.y
  };
}

/**
 * Smart Snapping against page guidelines and other objects.
 * @param {{ x: number; y: number; width: number; height: number }} box
 * @param {number} pageW
 * @param {number} pageH
 * @param {Array<{ x: number; y: number; width: number; height: number; id: string }>} otherObjects
 * @param {number} threshold
 */
export function snapBox(box, pageW, pageH, otherObjects = [], threshold = 5) {
  let targetX = box.x;
  let targetY = box.y;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const right = box.x + box.width;
  const top = box.y + box.height;

  const activeGuides = [];

  // Vertical guides (X-axis)
  const verticalTargets = [
    { pos: pageW / 2, type: "center", label: "وسط الصفحة" },
    { pos: 24, type: "margin", label: "هامش الصفحة" },
    { pos: pageW - 24, type: "margin", label: "هامش الصفحة" }
  ];

  // Horizontal guides (Y-axis)
  const horizontalTargets = [
    { pos: pageH / 2, type: "center", label: "وسط الصفحة" },
    { pos: 24, type: "margin", label: "هامش الصفحة" },
    { pos: pageH - 24, type: "margin", label: "هامش الصفحة" }
  ];

  for (const obj of otherObjects) {
    verticalTargets.push({ pos: obj.x, type: "edge" });
    verticalTargets.push({ pos: obj.x + obj.width / 2, type: "center" });
    verticalTargets.push({ pos: obj.x + obj.width, type: "edge" });

    horizontalTargets.push({ pos: obj.y, type: "edge" });
    horizontalTargets.push({ pos: obj.y + obj.height / 2, type: "center" });
    horizontalTargets.push({ pos: obj.y + obj.height, type: "edge" });
  }

  // Snap X
  let snappedX = false;
  for (const guide of verticalTargets) {
    if (Math.abs(cx - guide.pos) < threshold) {
      targetX = guide.pos - box.width / 2;
      activeGuides.push({ orientation: "v", pos: guide.pos });
      snappedX = true;
      break;
    }
    if (Math.abs(box.x - guide.pos) < threshold) {
      targetX = guide.pos;
      activeGuides.push({ orientation: "v", pos: guide.pos });
      snappedX = true;
      break;
    }
    if (Math.abs(right - guide.pos) < threshold) {
      targetX = guide.pos - box.width;
      activeGuides.push({ orientation: "v", pos: guide.pos });
      snappedX = true;
      break;
    }
  }

  // Snap Y
  for (const guide of horizontalTargets) {
    if (Math.abs(cy - guide.pos) < threshold) {
      targetY = guide.pos - box.height / 2;
      activeGuides.push({ orientation: "h", pos: guide.pos });
      break;
    }
    if (Math.abs(box.y - guide.pos) < threshold) {
      targetY = guide.pos;
      activeGuides.push({ orientation: "h", pos: guide.pos });
      break;
    }
    if (Math.abs(top - guide.pos) < threshold) {
      targetY = guide.pos - box.height;
      activeGuides.push({ orientation: "h", pos: guide.pos });
      break;
    }
  }

  return {
    x: targetX,
    y: targetY,
    guides: activeGuides
  };
}

/**
 * Calculate distance from point (px, py) to line segment (x1, y1)-(x2, y2).
 */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * World-space points with the object's CSS-clockwise rotation applied around
 * the box centre.
 *
 * @param {{ x: number; y: number; width: number; height: number; rotation?: number }} obj
 * @param {Array<{ x: number; y: number }>} [points]
 */
export function orientedPoints(obj, points) {
  const list = points || obj.points || [];
  if (!list.length || !obj.rotation) return list;
  return rotatePoints(list, obj.x + obj.width / 2, obj.y + obj.height / 2, obj.rotation);
}

/**
 * @param {number} angle pdf-lib page rotation
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {number} vx
 * @param {number} vy
 */
export function visualPointToMedia(angle, mediaW, mediaH, vx, vy) {
  const a = normAngle(angle);
  if (a === 90) return { x: mediaW - vy, y: vx };
  if (a === 180) return { x: mediaW - vx, y: mediaH - vy };
  if (a === 270) return { x: vy, y: mediaH - vx };
  return { x: vx, y: vy };
}

/**
 * Map a visual-space rectangle into pdf-lib media-box space.
 *
 * @param {number} angle
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {{ x: number; y: number; width: number; height: number }} rect
 */
export function visualRectToMedia(angle, mediaW, mediaH, rect) {
  const a = normAngle(angle);
  const { x, y, width, height } = rect;
  if (a === 90) {
    return { x: mediaW - y - height, y: x, width: height, height: width, ccw: 1 };
  }
  if (a === 180) {
    return { x: mediaW - x - width, y: mediaH - y - height, width, height, ccw: 2 };
  }
  if (a === 270) {
    return { x: y, y: mediaH - x - width, width: height, height: width, ccw: 3 };
  }
  return { x, y, width, height, ccw: 0 };
}

/**
 * @param {Array<{ x: number; y: number }>} points
 * @param {{ x: number; y: number; width: number; height: number }} from
 * @param {{ x: number; y: number; width: number; height: number }} to
 */
export function scalePoints(points, from, to) {
  const ow = Math.max(1e-6, from.width);
  const oh = Math.max(1e-6, from.height);
  return points.map((point) => ({
    x: to.x + ((point.x - from.x) / ow) * to.width,
    y: to.y + ((point.y - from.y) / oh) * to.height
  }));
}

/**
 * @param {Array<{ x: number; y: number }>} points
 * @param {number} dx
 * @param {number} dy
 */
export function translatePoints(points, dx, dy) {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

/**
 * @param {Array<{ x: number; y: number }>} points
 * @param {number} cx
 * @param {number} cy
 * @param {number} clockwiseDeg
 */
export function rotatePoints(points, cx, cy, clockwiseDeg) {
  return points.map((point) => rotatePoint(point.x, point.y, cx, cy, clockwiseDeg));
}
