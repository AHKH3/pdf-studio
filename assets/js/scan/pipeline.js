/**
 * Dependency-free document scanning pipeline: corner detection, perspective
 * correction and scan-style enhancement.
 *
 * Pure computation only. No DOM, no canvas, no globals beyond the language
 * built-ins, so the module runs unchanged in a Web Worker and in plain Node.
 *
 * Images are plain objects shaped like ImageData:
 *   { width: number, height: number, data: Uint8ClampedArray } in RGBA order.
 */

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} RasterImage */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {[Point, Point, Point, Point]} Quad */

const DETECT_DEFAULTS = {
  workingSide: 720,
  blurSigma: 1.4,
  edgePercentile: 0.82,
  maxLines: 28,
  minAreaRatio: 0.1,
  maxAreaRatio: 0.995,
  minQuadScore: 0.22,
  borderBandRatio: 0.015,
  houghSpread: 12
};

const ENHANCE_DEFAULTS = {
  clipLow: 0.005,
  clipHigh: 0.995,
  unsharpAmount: 0.6,
  unsharpRadius: 2,
  bwRatio: 0.87,
  maxGain: 8,
  colorBlackPoint: 48
};

const MAX_OUTPUT_SIDE = 2600;
const MIN_OUTPUT_SIDE = 200;
const PARALLEL_TOLERANCE = 40 * (Math.PI / 180);
const PERPENDICULAR_TOLERANCE = 40 * (Math.PI / 180);

/* ------------------------------------------------------------------ *
 * Raster helpers
 * ------------------------------------------------------------------ */

function createImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function toRaster(image) {
  const width = Math.max(0, Math.floor(Number(image && image.width) || 0));
  const height = Math.max(0, Math.floor(Number(image && image.height) || 0));
  let data = image && image.data;
  if (data instanceof Uint8ClampedArray) {
    // already usable
  } else if (data && data.buffer instanceof ArrayBuffer) {
    data = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  } else if (data instanceof ArrayBuffer) {
    data = new Uint8ClampedArray(data);
  } else if (Array.isArray(data)) {
    data = Uint8ClampedArray.from(data);
  } else {
    data = new Uint8ClampedArray(width * height * 4);
  }
  return { width, height, data };
}

function cloneImage(image) {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Area-averaged downscale; returns the scale factors back to source space. */
function downscale(image, maxSide) {
  const { width, height, data: src } = image;
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { image: cloneImage(image), scaleX: 1, scaleY: 1 };
  const ratio = maxSide / longest;
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const out = createImage(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor(((y + 1) * height) / h)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor(((x + 1) * width) / w)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        let idx = (sy * width + x0) * 4;
        for (let sx = x0; sx < x1; sx++) {
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          a += src[idx + 3];
          idx += 4;
          count++;
        }
      }
      const o = (y * w + x) * 4;
      dst[o] = r / count;
      dst[o + 1] = g / count;
      dst[o + 2] = b / count;
      dst[o + 3] = a / count;
    }
  }
  return { image: out, scaleX: width / w, scaleY: height / h };
}

function lumaPlane(image) {
  const { width, height, data } = image;
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return gray;
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    const v = Math.exp(-(d * d) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return { kernel, radius };
}

function gaussianBlur(src, w, h, sigma) {
  const { kernel, radius } = gaussianKernel(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clamp(x + k, 0, w - 1);
        acc += src[row + sx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clamp(y + k, 0, h - 1);
        acc += tmp[sy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Running-sum box blur (O(1) per pixel) with truncated windows at the border. */
function boxBlurPass(src, dst, w, h, radius, vertical) {
  const outer = vertical ? w : h;
  const inner = vertical ? h : w;
  const step = vertical ? w : 1;
  const jump = vertical ? 1 : w;
  const r = Math.max(0, Math.min(radius, inner - 1));
  for (let o = 0; o < outer; o++) {
    const base = o * jump;
    let sum = 0;
    let count = 0;
    for (let i = 0; i <= r && i < inner; i++) {
      sum += src[base + i * step];
      count++;
    }
    for (let i = 0; i < inner; i++) {
      dst[base + i * step] = sum / count;
      const drop = i - r;
      const add = i + r + 1;
      if (drop >= 0) {
        sum -= src[base + drop * step];
        count--;
      }
      if (add < inner) {
        sum += src[base + add * step];
        count++;
      }
    }
  }
}

function boxBlur(src, w, h, radius, passes) {
  const n = w * h;
  const tmp = new Float32Array(n);
  let front = new Float32Array(n);
  let back = new Float32Array(n);
  let current = src;
  for (let p = 0; p < passes; p++) {
    boxBlurPass(current, tmp, w, h, radius, false);
    boxBlurPass(tmp, front, w, h, radius, true);
    current = front;
    const swap = front;
    front = back;
    back = swap;
  }
  return current;
}

/** Sliding-window extremum via a monotonic deque: O(1) amortised per pixel. */
function rankFilterPass(src, dst, w, h, radius, vertical, wantMax) {
  const outer = vertical ? w : h;
  const inner = vertical ? h : w;
  const step = vertical ? w : 1;
  const jump = vertical ? 1 : w;
  const r = Math.max(0, Math.min(radius, inner - 1));
  const deque = new Int32Array(inner);
  for (let o = 0; o < outer; o++) {
    const base = o * jump;
    let head = 0;
    let tail = 0;
    for (let i = 0; i < inner; i++) {
      const v = src[base + i * step];
      while (tail > head) {
        const back = src[base + deque[tail - 1] * step];
        if (wantMax ? back <= v : back >= v) tail--;
        else break;
      }
      deque[tail++] = i;
      const p = i - r;
      if (p >= 0) {
        while (deque[head] < p - r) head++;
        dst[base + p * step] = src[base + deque[head] * step];
      }
    }
    for (let p = Math.max(0, inner - r); p < inner; p++) {
      while (deque[head] < p - r) head++;
      dst[base + p * step] = src[base + deque[head] * step];
    }
  }
}

function rankFilter(src, w, h, radius, wantMax) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  rankFilterPass(src, tmp, w, h, radius, false, wantMax);
  rankFilterPass(tmp, out, w, h, radius, true, wantMax);
  return out;
}

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

/** Scharr gradients; weights sum to 16 so magnitudes stay in gray-level units. */
function scharrGradients(gray, w, h) {
  const mag = new Float32Array(w * h);
  const ori = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1];
      const t = gray[i - w];
      const tr = gray[i - w + 1];
      const l = gray[i - 1];
      const rr = gray[i + 1];
      const bl = gray[i + w - 1];
      const bb = gray[i + w];
      const br = gray[i + w + 1];
      const gx = (-3 * tl + 3 * tr - 10 * l + 10 * rr - 3 * bl + 3 * br) / 16;
      const gy = (-3 * tl - 10 * t - 3 * tr + 3 * bl + 10 * bb + 3 * br) / 16;
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let deg = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (deg < 0) deg += 180;
      ori[i] = deg;
    }
  }
  return { mag, ori };
}

function nonMaxSuppress(mag, ori, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m <= 0) continue;
      const a = ori[i];
      let o1;
      let o2;
      if (a < 22.5 || a >= 157.5) {
        o1 = i - 1;
        o2 = i + 1;
      } else if (a < 67.5) {
        o1 = i - w - 1;
        o2 = i + w + 1;
      } else if (a < 112.5) {
        o1 = i - w;
        o2 = i + w;
      } else {
        o1 = i - w + 1;
        o2 = i + w - 1;
      }
      if (m >= mag[o1] && m >= mag[o2]) out[i] = m;
    }
  }
  return out;
}

/** Magnitude threshold read off a 256-bin histogram of the ridge pixels. */
function magnitudePercentile(nms, w, h, percentile) {
  const n = w * h;
  let max = 0;
  for (let i = 0; i < n; i++) if (nms[i] > max) max = nms[i];
  if (max <= 0) return 0;
  const hist = new Uint32Array(256);
  let total = 0;
  const scale = 255 / max;
  for (let i = 0; i < n; i++) {
    const v = nms[i];
    if (v <= 0.5) continue;
    hist[(v * scale) | 0]++;
    total++;
  }
  if (total === 0) return 0;
  const target = total * percentile;
  let cumulative = 0;
  for (let bin = 0; bin < 256; bin++) {
    cumulative += hist[bin];
    // Lower bin edge: everything in the bin still passes a >= test, so a
    // saturated histogram cannot push the threshold above the real maximum.
    if (cumulative >= target) return (bin * max) / 255;
  }
  return max;
}

function hysteresis(nms, w, h, low, high) {
  const n = w * h;
  const edges = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    if (nms[i] >= high && edges[i] === 0) {
      edges[i] = 1;
      stack[top++] = i;
    }
  }
  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (edges[j] === 0 && nms[j] >= low) {
          edges[j] = 1;
          stack[top++] = j;
        }
      }
    }
  }
  return edges;
}

/* ------------------------------------------------------------------ *
 * Hough transform
 * ------------------------------------------------------------------ */

/**
 * Standard (theta, rho) accumulator over edge pixels, weighted by gradient
 * magnitude. When `ori` is given, each pixel votes only near its gradient
 * angle so wood grain and text contribute far fewer spurious lines.
 */
function houghLines(edges, mag, w, h, maxLines, ori, spread) {
  const thetaBins = 180;
  const diagonal = Math.ceil(Math.sqrt(w * w + h * h));
  const rhoBins = diagonal * 2 + 1;
  const cos = new Float32Array(thetaBins);
  const sin = new Float32Array(thetaBins);
  for (let t = 0; t < thetaBins; t++) {
    const theta = (t * Math.PI) / thetaBins;
    cos[t] = Math.cos(theta);
    sin[t] = Math.sin(theta);
  }
  const acc = new Float32Array(thetaBins * rhoBins);
  const band = ori ? Math.max(4, Math.min(20, spread || 12)) : thetaBins;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (edges[i] === 0) continue;
      const weight = mag[i] > 0 ? mag[i] : 1;
      if (!ori) {
        for (let t = 0; t < thetaBins; t++) {
          const rho = (x * cos[t] + y * sin[t] + diagonal) | 0;
          acc[t * rhoBins + rho] += weight;
        }
        continue;
      }
      const tCenter = Math.round(ori[i]) % thetaBins;
      for (let d = -band; d <= band; d++) {
        const t = ((tCenter + d) % thetaBins + thetaBins) % thetaBins;
        const rho = (x * cos[t] + y * sin[t] + diagonal) | 0;
        const falloff = 1 - Math.abs(d) / (band + 1);
        acc[t * rhoBins + rho] += weight * falloff;
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  if (peak <= 0) return [];
  const floor = peak * 0.15;
  const thetaRadius = 2;
  const rhoRadius = Math.max(4, Math.round(diagonal * 0.02));
  const lines = [];
  for (let pick = 0; pick < maxLines; pick++) {
    let best = 0;
    let bestT = -1;
    let bestR = -1;
    for (let t = 0; t < thetaBins; t++) {
      const row = t * rhoBins;
      for (let r = 0; r < rhoBins; r++) {
        const v = acc[row + r];
        if (v > best) {
          best = v;
          bestT = t;
          bestR = r;
        }
      }
    }
    if (bestT < 0 || best < floor) break;
    lines.push({
      theta: (bestT * Math.PI) / thetaBins,
      rho: bestR - diagonal,
      votes: best
    });
    for (let t = Math.max(0, bestT - thetaRadius); t <= Math.min(thetaBins - 1, bestT + thetaRadius); t++) {
      const row = t * rhoBins;
      for (let r = Math.max(0, bestR - rhoRadius); r <= Math.min(rhoBins - 1, bestR + rhoRadius); r++) {
        acc[row + r] = 0;
      }
    }
  }
  return lines;
}

function angularDistance(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

function intersectLines(a, b) {
  const ca = Math.cos(a.theta);
  const sa = Math.sin(a.theta);
  const cb = Math.cos(b.theta);
  const sb = Math.sin(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * sb - b.rho * sa) / det,
    y: (b.rho * ca - a.rho * cb) / det
  };
}

/* ------------------------------------------------------------------ *
 * Quad geometry
 * ------------------------------------------------------------------ */

function polygonArea(quad) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % 4];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

function isConvex(quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function cornerAngles(quad) {
  const angles = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    const prev = quad[(i + 3) % 4];
    const cur = quad[i];
    const next = quad[(i + 1) % 4];
    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) return null;
    const cosine = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
    angles[i] = (Math.acos(cosine) * 180) / Math.PI;
  }
  return angles;
}

/** top-left, top-right, bottom-right, bottom-left, forced clockwise. */
function orderCorners(points) {
  const rest = points.slice();
  let tlIndex = 0;
  let brIndex = 0;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i].x + rest[i].y < rest[tlIndex].x + rest[tlIndex].y) tlIndex = i;
    if (rest[i].x + rest[i].y > rest[brIndex].x + rest[brIndex].y) brIndex = i;
  }
  if (tlIndex === brIndex) brIndex = (brIndex + 1) % 4;
  const tl = rest[tlIndex];
  const br = rest[brIndex];
  const others = [];
  for (let i = 0; i < rest.length; i++) if (i !== tlIndex && i !== brIndex) others.push(rest[i]);
  let tr = others[0];
  let bl = others[1];
  if (tr.y - tr.x > bl.y - bl.x) {
    const swap = tr;
    tr = bl;
    bl = swap;
  }
  const quad = [tl, tr, br, bl];
  // Screen coordinates are y-down, so a clockwise ring has positive shoelace sum.
  if (polygonArea(quad) < 0) {
    quad[1] = bl;
    quad[3] = tr;
  }
  return quad;
}

function edgeHit(edges, w, h, x, y, radius) {
  const x0 = Math.max(0, Math.floor(x) - radius);
  const x1 = Math.min(w - 1, Math.floor(x) + radius);
  const y0 = Math.max(0, Math.floor(y) - radius);
  const y1 = Math.min(h - 1, Math.floor(y) + radius);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx <= x1; xx++) if (edges[row + xx] !== 0) return true;
  }
  return false;
}

function sideSupport(edges, w, h, quad, borderBand) {
  const samples = 32;
  let meanSum = 0;
  let min = 1;
  let hugging = 0;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    let hits = 0;
    let border = 0;
    for (let k = 0; k < samples; k++) {
      const t = (k + 0.5) / samples;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (edgeHit(edges, w, h, x, y, 2)) hits++;
      if (x <= borderBand || y <= borderBand || x >= w - 1 - borderBand || y >= h - 1 - borderBand) border++;
    }
    const support = hits / samples;
    meanSum += support;
    if (support < min) min = support;
    if (border / samples > 0.8) hugging++;
  }
  return { mean: meanSum / 4, min, hugging };
}

function otsuThreshold(gray, count) {
  const hist = new Float64Array(256);
  for (let i = 0; i < count; i++) hist[clamp(gray[i] | 0, 0, 255)]++;
  let total = 0;
  for (let t = 0; t < 256; t++) total += t * hist[t];
  let sumBelow = 0;
  let weightBelow = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    weightBelow += hist[t];
    if (weightBelow === 0) continue;
    const weightAbove = count - weightBelow;
    if (weightAbove <= 0) break;
    sumBelow += t * hist[t];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (total - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) * (meanBelow - meanAbove);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Iterative flood fill (no recursion) returning the largest bright blob. */
function largestComponent(mask, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  let bestSize = 0;
  let bestMembers = null;
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || seen[start] !== 0) continue;
    let top = 0;
    let size = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const i = stack[--top];
      members[size++] = i;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && mask[i - 1] !== 0 && seen[i - 1] === 0) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] !== 0 && seen[i + 1] === 0) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (y > 0 && mask[i - w] !== 0 && seen[i - w] === 0) {
        seen[i - w] = 1;
        stack[top++] = i - w;
      }
      if (y < h - 1 && mask[i + w] !== 0 && seen[i + w] === 0) {
        seen[i + w] = 1;
        stack[top++] = i + w;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestMembers = members.slice(0, size);
    }
  }
  return bestSize > 0 ? { size: bestSize, members: bestMembers } : null;
}

/** All blobs above `minSize`, largest first. Used to rejoin a page split by a crease. */
function collectLargeComponents(mask, w, h, minSize, limit) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  const found = [];
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || seen[start] !== 0) continue;
    let top = 0;
    let size = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const i = stack[--top];
      members[size++] = i;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && mask[i - 1] !== 0 && seen[i - 1] === 0) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] !== 0 && seen[i + 1] === 0) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (y > 0 && mask[i - w] !== 0 && seen[i - w] === 0) {
        seen[i - w] = 1;
        stack[top++] = i - w;
      }
      if (y < h - 1 && mask[i + w] !== 0 && seen[i + w] === 0) {
        seen[i + w] = 1;
        stack[top++] = i + w;
      }
    }
    if (size >= minSize) found.push({ size, members: members.slice(0, size) });
  }
  found.sort((a, b) => b.size - a.size);
  return found.slice(0, limit);
}

function mergePageHalves(components, w, h) {
  if (!components.length) return null;
  const a = components[0];
  if (components.length === 1) return a;
  const b = components[1];
  if (b.size < w * h * 0.08 || b.size < a.size * 0.28) return a;
  const members = new Int32Array(a.size + b.size);
  members.set(a.members);
  members.set(b.members, a.size);
  return { size: a.size + b.size, members };
}

/** Andrew's monotone chain. */
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((p, q) => (p.x === q.x ? p.y - q.y : p.x - q.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rotating calipers over hull edges. */
function minAreaRect(hull) {
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    dx /= len;
    dy /= len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < hull.length; k++) {
      const u = hull[k].x * dx + hull[k].y * dy;
      const v = -hull[k].x * dy + hull[k].y * dx;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, dx, dy, minU, maxU, minV, maxV };
  }
  if (!best) return null;
  const { dx, dy, minU, maxU, minV, maxV } = best;
  const at = (u, v) => ({ x: u * dx - v * dy, y: u * dy + v * dx });
  return {
    area: best.area,
    corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)]
  };
}

function inConvexQuad(quad, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** Paper is bright and not brown; wood is darker with R ≫ G. */
function pixelPaperness(r, g, b) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const brown = r - g;
  const yellow = (r + g) * 0.5 - b;
  return luma - 3.2 * Math.max(0, brown) + 0.3 * yellow;
}

function samplePlane(plane, w, h, x, y) {
  const px = clamp(x, 0, w - 1);
  const py = clamp(y, 0, h - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const ax = px - x0;
  const ay = py - y0;
  return (
    plane[y0 * w + x0] * (1 - ax) * (1 - ay) +
    plane[y0 * w + x1] * ax * (1 - ay) +
    plane[y1 * w + x0] * (1 - ax) * ay +
    plane[y1 * w + x1] * ax * ay
  );
}

function morphMask(mask, w, h, radius, dilate) {
  const n = w * h;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = mask[i];
  const filtered = rankFilter(src, w, h, radius, dilate);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = filtered[i] > 0.5 ? 1 : 0;
  return out;
}

function fillMaskHoles(mask, w, h) {
  const n = w * h;
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (i) => {
    if (mask[i] === 0 && outside[i] === 0) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = mask[i] || !outside[i] ? 1 : 0;
  return filled;
}

function papernessPlane(image) {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const plane = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    plane[i] = pixelPaperness(data[p], data[p + 1], data[p + 2]);
  }
  return plane;
}

/**
 * Adaptive paper / table mask. Border pixels estimate the table; bright inner
 * pixels estimate the sheet. Brown (R−G) gates out sunlit wood grain that
 * luma-only thresholds swallow.
 */
function buildPaperMask(image, plane) {
  const w = image.width;
  const h = image.height;
  const n = w * h;
  const data = image.data;
  const bx = Math.max(4, Math.round(w * 0.045));
  const by = Math.max(4, Math.round(h * 0.045));
  let borderSum = 0;
  let borderN = 0;
  let innerSum = 0;
  let innerN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = plane[y * w + x];
      if (x < bx || y < by || x >= w - bx || y >= h - by) {
        borderSum += v;
        borderN++;
      } else if (x > w * 0.28 && x < w * 0.72 && y > h * 0.28 && y < h * 0.72 && v > 90) {
        innerSum += v;
        innerN++;
      }
    }
  }
  const wood = borderN ? borderSum / borderN : 40;
  const paper = innerN ? innerSum / innerN : wood + 80;
  const spread = paper - wood;
  let thr;
  if (spread > 35) thr = wood + spread * 0.38;
  else {
    const scaled = new Float32Array(n);
    for (let i = 0; i < n; i++) scaled[i] = clamp(plane[i], 0, 255);
    thr = otsuThreshold(scaled, n);
  }
  const raw = new Uint8Array(n);
  let bright = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const brown = data[p] - data[p + 1];
    if (plane[i] >= thr && brown < 8) {
      raw[i] = 1;
      bright++;
    }
  }
  if (bright < n * 0.05) return { mask: raw, bright, plane, thr };
  const opened = morphMask(morphMask(raw, w, h, 1, false), w, h, 1, true);
  const closeR = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  const closed = morphMask(morphMask(opened, w, h, closeR, true), w, h, closeR, false);
  const filled = fillMaskHoles(closed, w, h);
  const component = mergePageHalves(collectLargeComponents(filled, w, h, n * 0.05, 4), w, h);
  const mask = new Uint8Array(n);
  if (component) {
    for (let k = 0; k < component.members.length; k++) mask[component.members[k]] = 1;
  }
  const inset = morphMask(mask, w, h, 1, false);
  const members = [];
  for (let i = 0; i < n; i++) if (inset[i]) members.push(i);
  return {
    mask: inset,
    bright: members.length,
    plane,
    thr,
    members: members.length ? Int32Array.from(members) : null
  };
}

function fitThetaRho(points) {
  if (!points || points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < points.length; i++) {
    mx += points[i].x;
    my += points[i].y;
  }
  mx /= points.length;
  my /= points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - mx;
    const dy = points[i].y - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const dir = 0.5 * Math.atan2(2 * xy, xx - yy);
  const vx = Math.cos(dir);
  const vy = Math.sin(dir);
  let theta = Math.atan2(vx, -vy);
  if (theta < 0) theta += Math.PI;
  if (theta >= Math.PI) theta -= Math.PI;
  const nx = Math.cos(theta);
  const ny = Math.sin(theta);
  const rho = nx * mx + ny * my;
  return { theta, rho };
}

/** Trim crease-bulge outliers so a fold wave is not treated as a corner. */
function fitThetaRhoRobust(points) {
  if (!points || points.length < 2) return null;
  let pts = points;
  for (let round = 0; round < 2; round++) {
    const line = fitThetaRho(pts);
    if (!line || pts.length < 10) return line;
    const scored = [];
    const ct = Math.cos(line.theta);
    const st = Math.sin(line.theta);
    for (let i = 0; i < pts.length; i++) {
      scored.push({
        p: pts[i],
        d: Math.abs(pts[i].x * ct + pts[i].y * st - line.rho)
      });
    }
    scored.sort((a, b) => a.d - b.d);
    const keep = Math.max(10, Math.floor(pts.length * 0.88));
    const next = scored.slice(0, keep).map((item) => item.p);
    if (next.length === pts.length) return line;
    pts = next;
  }
  return fitThetaRho(pts);
}

function quadFromLinePair(a, b, c, d, w, h) {
  const p00 = intersectLines(a, c);
  const p01 = intersectLines(a, d);
  const p11 = intersectLines(b, d);
  const p10 = intersectLines(b, c);
  if (!p00 || !p01 || !p11 || !p10) return null;
  const margin = { x: w * 0.08, y: h * 0.08 };
  const raw = [p00, p01, p11, p10];
  for (let k = 0; k < 4; k++) {
    const p = raw[k];
    if (p.x < -margin.x || p.x > w - 1 + margin.x || p.y < -margin.y || p.y > h - 1 + margin.y) return null;
  }
  return orderCorners(raw);
}

/** Drop the flattest hull vertices until four corners remain. */
function hullToQuad(hull) {
  if (hull.length < 3) return null;
  if (hull.length === 4) return orderCorners(hull);
  if (hull.length < 4) {
    const rect = minAreaRect(hull);
    return rect ? orderCorners(rect.corners) : null;
  }
  const pts = hull.map((p) => ({ x: p.x, y: p.y }));
  while (pts.length > 4) {
    let best = 0;
    let bestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    }
    pts.splice(best, 1);
  }
  return orderCorners(pts);
}

function chainsBetween(hull, corners) {
  const idx = corners.map((c) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const d = (hull[i].x - c.x) * (hull[i].x - c.x) + (hull[i].y - c.y) * (hull[i].y - c.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  });
  const chains = [];
  for (let s = 0; s < 4; s++) {
    const a = idx[s];
    const b = idx[(s + 1) % 4];
    const pts = [];
    let i = a;
    let guard = 0;
    while (guard++ <= hull.length) {
      pts.push(hull[i]);
      if (i === b) break;
      i = (i + 1) % hull.length;
    }
    chains.push(pts);
  }
  return chains;
}

function quadFromFittedHull(hull, w, h) {
  const coarse = hullToQuad(hull);
  if (!coarse) return null;
  const chains = chainsBetween(hull, coarse);
  const lines = chains.map((pts) => fitThetaRhoRobust(pts.length >= 3 ? pts : pts.concat(pts)));
  if (lines.some((line) => !line)) return coarse;
  return quadFromLinePair(lines[0], lines[2], lines[1], lines[3], w, h) || coarse;
}

function blobGeometry(members, w, h) {
  const rowMin = new Int32Array(h).fill(-1);
  const rowMax = new Int32Array(h).fill(-1);
  const colMin = new Int32Array(w).fill(-1);
  const colMax = new Int32Array(w).fill(-1);
  for (let k = 0; k < members.length; k++) {
    const i = members[k];
    const x = i % w;
    const y = (i / w) | 0;
    if (rowMin[y] < 0 || x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;
    if (colMin[x] < 0 || y < colMin[x]) colMin[x] = y;
    if (y > colMax[x]) colMax[x] = y;
  }
  const hullPts = [];
  for (let y = 0; y < h; y++) {
    if (rowMin[y] < 0) continue;
    hullPts.push({ x: rowMin[y], y });
    if (rowMax[y] !== rowMin[y]) hullPts.push({ x: rowMax[y], y });
  }
  return { rowMin, rowMax, colMin, colMax, hull: convexHull(hullPts) };
}

function silhouetteQuad(geom, w, h) {
  const { rowMin, rowMax, colMin, colMax } = geom;
  const minWidth = Math.max(12, Math.round(w * 0.18));
  const minHeight = Math.max(12, Math.round(h * 0.18));
  const left = [];
  const right = [];
  const top = [];
  const bottom = [];
  for (let y = 0; y < h; y++) {
    if (rowMin[y] < 0) continue;
    if (rowMax[y] - rowMin[y] < minWidth) continue;
    left.push({ x: rowMin[y], y });
    right.push({ x: rowMax[y], y });
  }
  for (let x = 0; x < w; x++) {
    if (colMin[x] < 0) continue;
    if (colMax[x] - colMin[x] < minHeight) continue;
    top.push({ x, y: colMin[x] });
    bottom.push({ x, y: colMax[x] });
  }
  if (left.length < 8 || right.length < 8 || top.length < 8 || bottom.length < 8) return null;
  const leftL = fitThetaRhoRobust(left);
  const rightL = fitThetaRhoRobust(right);
  const topL = fitThetaRhoRobust(top);
  const bottomL = fitThetaRhoRobust(bottom);
  if (!leftL || !rightL || !topL || !bottomL) return null;
  return quadFromLinePair(topL, bottomL, leftL, rightL, w, h);
}

function maskStats(quad, mask, w, h) {
  const step = Math.max(2, Math.round(Math.min(w, h) / 260));
  let paperAll = 0;
  let paperIn = 0;
  let totIn = 0;
  for (let y = 0; y < h; y += step) {
    const row = y * w;
    for (let x = 0; x < w; x += step) {
      const m = mask[row + x];
      if (m) paperAll++;
      if (inConvexQuad(quad, x + 0.5, y + 0.5)) {
        totIn++;
        if (m) paperIn++;
      }
    }
  }
  const fill = totIn ? paperIn / totIn : 0;
  const recall = paperAll ? paperIn / paperAll : 0;
  const iou = paperIn / Math.max(1, totIn + paperAll - paperIn);
  return { fill, recall, iou };
}

function sideContrast(plane, quad, w, h) {
  const samples = 28;
  const offset = Math.max(4, Math.round(Math.min(w, h) * 0.016));
  let sum = 0;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const inX = (-dy / len) * offset;
    const inY = (dx / len) * offset;
    let acc = 0;
    for (let k = 0; k < samples; k++) {
      const t = (k + 0.5) / samples;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      acc += samplePlane(plane, w, h, x + inX, y + inY) - samplePlane(plane, w, h, x - inX, y - inY);
    }
    sum += clamp(acc / samples / 90, 0, 1);
  }
  return sum / 4;
}

function interiorSides(mask, quad, w, h) {
  const samples = 24;
  const offset = Math.max(5, Math.round(Math.min(w, h) * 0.018));
  let interior = 0;
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const inX = (-dy / len) * offset;
    const inY = (dx / len) * offset;
    let inward = 0;
    let outward = 0;
    for (let k = 0; k < samples; k++) {
      const t = (k + 0.5) / samples;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const ix = clamp(Math.round(x + inX), 0, w - 1);
      const iy = clamp(Math.round(y + inY), 0, h - 1);
      const ox = clamp(Math.round(x - inX), 0, w - 1);
      const oy = clamp(Math.round(y - inY), 0, h - 1);
      if (mask[iy * w + ix]) inward++;
      if (mask[oy * w + ox]) outward++;
    }
    if (inward / samples > 0.62 && outward / samples > 0.62) interior++;
  }
  return interior;
}

function evaluateQuad(quad, ctx) {
  const { mask, plane, edges, w, h, options } = ctx;
  const area = Math.abs(polygonArea(quad));
  const areaRatio = area / (w * h);
  if (areaRatio < options.minAreaRatio || areaRatio > options.maxAreaRatio) return null;
  if (!isConvex(quad)) return null;
  const angles = cornerAngles(quad);
  if (!angles) return null;
  let angleError = 0;
  for (let i = 0; i < 4; i++) {
    if (angles[i] < 40 || angles[i] > 140) return null;
    angleError += Math.abs(angles[i] - 90);
  }
  const angleScore = clamp(1 - angleError / 4 / 45, 0, 1);
  const widthTop = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const widthBottom = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const heightLeft = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const heightRight = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  const avgWidth = (widthTop + widthBottom) / 2;
  const avgHeight = (heightLeft + heightRight) / 2;
  if (avgWidth < 8 || avgHeight < 8) return null;
  const aspect = Math.max(avgWidth, avgHeight) / Math.min(avgWidth, avgHeight);
  if (aspect > 6) return null;
  const stats = maskStats(quad, mask, w, h);
  if (stats.fill < 0.62) return null;
  if (stats.recall < 0.7) return null;
  const borderBand = Math.max(1, Math.round(Math.max(w, h) * options.borderBandRatio));
  const support = sideSupport(edges, w, h, quad, borderBand);
  const interior = interiorSides(mask, quad, w, h);
  const contrast = sideContrast(plane, quad, w, h);
  const fold = interior > 0 && interior < 3 ? interior : 0;
  const score =
    stats.iou * 0.4 +
    stats.fill * 0.16 +
    stats.recall * 0.12 +
    contrast * 0.12 +
    angleScore * 0.08 +
    clamp(areaRatio, 0, 1) * stats.fill * 0.1 +
    support.mean * 0.06 -
    fold * 0.4 -
    support.hugging * 0.08;
  return {
    score,
    iou: stats.iou,
    fill: stats.fill,
    recall: stats.recall,
    contrast,
    angleScore,
    areaRatio,
    interior,
    edgeScore: 0.5 * stats.fill + 0.3 * contrast + 0.2 * support.mean
  };
}

function consider(list, quad, method, ctx, bonus) {
  if (!quad) return;
  const scored = evaluateQuad(quad, ctx);
  if (!scored) return;
  list.push({ ...scored, score: scored.score + (bonus || 0), quad, method });
}

function collectLineQuads(lines, ctx) {
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (angularDistance(lines[i].theta, lines[j].theta) <= PARALLEL_TOLERANCE) pairs.push([i, j]);
    }
  }
  const rough = [];
  for (let a = 0; a < pairs.length; a++) {
    const [a1, a2] = pairs[a];
    for (let b = a + 1; b < pairs.length; b++) {
      const [b1, b2] = pairs[b];
      if (b1 === a1 || b1 === a2 || b2 === a1 || b2 === a2) continue;
      if (angularDistance(lines[a1].theta, lines[b1].theta) < PERPENDICULAR_TOLERANCE) continue;
      const quad = quadFromLinePair(lines[a1], lines[a2], lines[b1], lines[b2], ctx.w, ctx.h);
      if (!quad || !isConvex(quad)) continue;
      const area = Math.abs(polygonArea(quad)) / (ctx.w * ctx.h);
      if (area < ctx.options.minAreaRatio || area > ctx.options.maxAreaRatio) continue;
      rough.push({ quad, area });
    }
  }
  rough.sort((a, b) => b.area - a.area);
  const found = [];
  const seen = new Set();
  for (let i = 0; i < rough.length && found.length < 16; i++) {
    const quad = rough[i].quad;
    const key = quad.map((p) => `${Math.round(p.x / 6)},${Math.round(p.y / 6)}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    consider(found, quad, "lines", ctx);
  }
  return found;
}

function makeEdges(plane, w, h, blurSigma, percentile) {
  const blurred = gaussianBlur(plane, w, h, blurSigma);
  const { mag, ori } = scharrGradients(blurred, w, h);
  const nms = nonMaxSuppress(mag, ori, w, h);
  const high = Math.max(4, magnitudePercentile(nms, w, h, percentile));
  const edges = hysteresis(nms, w, h, high * 0.4, high);
  return { edges, nms, ori, mag };
}

/**
 * Snap each side onto the strongest paper→table drop, then re-intersect.
 * Folds stay inside the sheet so they lose to a true outer edge.
 */
function refineQuad(quad, plane, w, h) {
  const search = Math.max(10, Math.round(Math.min(w, h) * 0.055));
  const samples = 40;
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s];
    const b = quad[(s + 1) % 4];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return quad;
    const ox = dy / len;
    const oy = -dx / len;
    const pts = [];
    for (let k = 0; k < samples; k++) {
      const t = (k + 0.5) / samples;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      let bestT = 0;
      let best = -Infinity;
      for (let d = -search; d <= search; d++) {
        const x = px + ox * d;
        const y = py + oy * d;
        const inside = samplePlane(plane, w, h, x - ox * 2.5, y - oy * 2.5);
        const outside = samplePlane(plane, w, h, x + ox * 2.5, y + oy * 2.5);
        const gain = inside - outside;
        if (gain > best) {
          best = gain;
          bestT = d;
        }
      }
      if (best > 10) pts.push({ x: px + ox * bestT, y: py + oy * bestT });
    }
    const fitted = pts.length >= 8 ? fitThetaRhoRobust(pts) : fitThetaRho([a, b]);
    if (!fitted) return quad;
    lines.push(fitted);
  }
  return quadFromLinePair(lines[0], lines[2], lines[1], lines[3], w, h) || quad;
}

function pickBest(candidates, ctx) {
  if (!candidates.length) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].score > best.score) best = candidates[i];
  }
  if (best.score < ctx.options.minQuadScore) return null;
  const refined = refineQuad(best.quad, ctx.plane, ctx.w, ctx.h);
  const rescored = evaluateQuad(refined, ctx);
  if (rescored && rescored.score >= best.score - 0.04) {
    return { ...rescored, quad: refined, method: best.method };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Locate a document quadrilateral. Never throws; always returns four ordered
 * corners in original-image pixel coordinates.
 * @param {RasterImage} image
 * @param {Partial<typeof DETECT_DEFAULTS>} [options]
 * @returns {{ corners: Quad, confidence: number, method: "quad"|"lines"|"fallback" }}
 */
export function detectDocument(image, options) {
  const source = toRaster(image);
  const fallback = {
    corners: [
      { x: 0, y: 0 },
      { x: source.width, y: 0 },
      { x: source.width, y: source.height },
      { x: 0, y: source.height }
    ],
    confidence: 0,
    method: "fallback"
  };
  try {
    const config = { ...DETECT_DEFAULTS, ...(options || {}) };
    if (source.width < 16 || source.height < 16) return fallback;
    const { image: small, scaleX, scaleY } = downscale(source, config.workingSide);
    const w = small.width;
    const h = small.height;
    if (w < 16 || h < 16) return fallback;

    const gray = lumaPlane(small);
    const flatBg = boxBlur(gray, w, h, Math.max(6, Math.floor(Math.min(w, h) / 18)), 2);
    const flat = new Float32Array(w * h);
    for (let i = 0; i < flat.length; i++) {
      const bg = flatBg[i] > 1 ? flatBg[i] : 1;
      flat[i] = (gray[i] * 160) / bg;
    }
    const paper = papernessPlane(small);
    const built = buildPaperMask(small, paper);
    const lumaEdges = makeEdges(flat, w, h, config.blurSigma, config.edgePercentile);
    const paperEdges = makeEdges(paper, w, h, 1.1, 0.78);
    let edges = lumaEdges.edges;
    const n = w * h;
    const merged = new Uint8Array(n);
    let edgeCount = 0;
    for (let i = 0; i < n; i++) {
      const on = lumaEdges.edges[i] || paperEdges.edges[i] ? 1 : 0;
      merged[i] = on;
      edgeCount += on;
    }
    edges = merged;

    const ctx = { mask: built.mask, plane: paper, edges, w, h, options: config };
    const candidates = [];

    if (built.members && built.bright > n * 0.05) {
      const geom = blobGeometry(built.members, w, h);
      consider(candidates, hullToQuad(geom.hull), "quad", ctx);
      consider(candidates, quadFromFittedHull(geom.hull, w, h), "quad", ctx, 0.03);
      consider(candidates, silhouetteQuad(geom, w, h), "quad", ctx, 0.045);
      const rect = minAreaRect(geom.hull);
      if (rect) consider(candidates, orderCorners(rect.corners), "quad", ctx, -0.04);
    }

    if (edgeCount > 32) {
      const lumaLines = houghLines(
        lumaEdges.edges,
        lumaEdges.nms,
        w,
        h,
        config.maxLines,
        lumaEdges.ori,
        config.houghSpread
      );
      const paperLines = houghLines(
        paperEdges.edges,
        paperEdges.nms,
        w,
        h,
        config.maxLines,
        paperEdges.ori,
        config.houghSpread
      );
      if (lumaLines.length >= 4) candidates.push(...collectLineQuads(lumaLines, ctx));
      if (paperLines.length >= 4) candidates.push(...collectLineQuads(paperLines, ctx));
    }

    const result = pickBest(candidates, ctx);
    if (!result) return fallback;
    const corners = result.quad.map((p) => ({
      x: clamp(p.x * scaleX, 0, source.width),
      y: clamp(p.y * scaleY, 0, source.height)
    }));
    return {
      corners: orderCorners(corners),
      confidence: clamp(result.iou * 0.55 + result.angleScore * 0.25 + result.fill * 0.2, 0, 1),
      method: result.method
    };
  } catch {
    return fallback;
  }
}

/**
 * Output size from the average of opposite edge lengths.
 * @param {Quad} corners
 * @param {{ maxSide?: number }} [options]
 * @returns {{ width: number, height: number }}
 */
export function suggestOutputSize(corners, options) {
  const maxSide = Math.max(MIN_OUTPUT_SIDE, Math.floor((options && options.maxSide) || MAX_OUTPUT_SIDE));
  const quad = corners && corners.length === 4 ? corners : null;
  if (!quad) return { width: MIN_OUTPUT_SIDE, height: MIN_OUTPUT_SIDE };
  const widthTop = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const widthBottom = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const heightLeft = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const heightRight = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  let width = Math.round((widthTop + widthBottom) / 2);
  let height = Math.round((heightLeft + heightRight) / 2);
  if (!Number.isFinite(width) || width < 1) width = 1;
  if (!Number.isFinite(height) || height < 1) height = 1;
  const longest = Math.max(width, height);
  if (longest > maxSide) {
    const ratio = maxSide / longest;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  return {
    width: Math.max(MIN_OUTPUT_SIDE, width),
    height: Math.max(MIN_OUTPUT_SIDE, height)
  };
}

/**
 * Solve the 8x8 system for the homography taking the output rectangle corners
 * to the source quad corners. Gaussian elimination with partial pivoting.
 */
function solveHomography(dst, width, height) {
  const src = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];
  const m = new Float64Array(8 * 9);
  for (let i = 0; i < 4; i++) {
    const u = src[i].x;
    const v = src[i].y;
    const x = dst[i].x;
    const y = dst[i].y;
    let r = i * 2 * 9;
    m[r] = u;
    m[r + 1] = v;
    m[r + 2] = 1;
    m[r + 6] = -u * x;
    m[r + 7] = -v * x;
    m[r + 8] = x;
    r += 9;
    m[r + 3] = u;
    m[r + 4] = v;
    m[r + 5] = 1;
    m[r + 6] = -u * y;
    m[r + 7] = -v * y;
    m[r + 8] = y;
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    let best = Math.abs(m[col * 9 + col]);
    for (let row = col + 1; row < 8; row++) {
      const value = Math.abs(m[row * 9 + col]);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-12) return null;
    if (pivot !== col) {
      for (let k = col; k < 9; k++) {
        const tmp = m[col * 9 + k];
        m[col * 9 + k] = m[pivot * 9 + k];
        m[pivot * 9 + k] = tmp;
      }
    }
    const diag = m[col * 9 + col];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = m[row * 9 + col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < 9; k++) m[row * 9 + k] -= factor * m[col * 9 + k];
    }
  }
  const solution = new Float64Array(9);
  for (let i = 0; i < 8; i++) {
    const diag = m[i * 9 + i];
    if (!Number.isFinite(diag) || Math.abs(diag) < 1e-12) return null;
    solution[i] = m[i * 9 + 8] / diag;
  }
  solution[8] = 1;
  for (let i = 0; i < 9; i++) if (!Number.isFinite(solution[i])) return null;
  return solution;
}

function bilinearSample(src, w, h, fx, fy, out, target) {
  const x = clamp(fx, 0, w - 1);
  const y = clamp(fy, 0, h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const ax = x - x0;
  const ay = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  for (let c = 0; c < 4; c++) {
    out[target + c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
  }
}

function croppedCopy(image, corners, size) {
  const out = createImage(size.width, size.height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) {
    minX = 0;
    minY = 0;
    maxX = image.width;
    maxY = image.height;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const sx = minX + (spanX * (x + 0.5)) / size.width;
      const sy = minY + (spanY * (y + 0.5)) / size.height;
      bilinearSample(image.data, image.width, image.height, sx, sy, out.data, (y * size.width + x) * 4);
    }
  }
  return out;
}

/**
 * Inverse-mapped perspective warp with bilinear sampling.
 * @param {RasterImage} image
 * @param {Quad} corners
 * @param {{ width: number, height: number }} [size]
 * @returns {RasterImage}
 */
export function warpDocument(image, corners, size) {
  const source = toRaster(image);
  const quad = corners && corners.length === 4 ? corners : suggestFullFrame(source);
  const target = size && size.width > 0 && size.height > 0
    ? { width: Math.round(size.width), height: Math.round(size.height) }
    : suggestOutputSize(quad);
  if (source.width < 1 || source.height < 1) return createImage(target.width, target.height);
  const homography = solveHomography(quad, target.width, target.height);
  if (!homography) return croppedCopy(source, quad, target);
  const [h11, h12, h13, h21, h22, h23, h31, h32] = homography;
  const out = createImage(target.width, target.height);
  const src = source.data;
  for (let y = 0; y < target.height; y++) {
    const v = y + 0.5;
    for (let x = 0; x < target.width; x++) {
      const u = x + 0.5;
      const denom = h31 * u + h32 * v + 1;
      const o = (y * target.width + x) * 4;
      if (Math.abs(denom) < 1e-12) {
        out.data[o + 3] = 255;
        continue;
      }
      const sx = (h11 * u + h12 * v + h13) / denom;
      const sy = (h21 * u + h22 * v + h23) / denom;
      bilinearSample(src, source.width, source.height, sx, sy, out.data, o);
    }
  }
  return out;
}

function suggestFullFrame(image) {
  return [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height }
  ];
}

/* ------------------------------------------------------------------ *
 * Enhancement
 * ------------------------------------------------------------------ */

/**
 * Illumination envelope. A dilation wipes out ink narrower than the window;
 * the matching erosion undoes the brightness bias a dilation introduces on a
 * sloped background (a lone max filter shifts the ramp by the radius and would
 * leave the paper systematically below white). A triple box blur then turns the
 * closing into a smooth paper-brightness field.
 */
function estimateBackground(gray, w, h) {
  const radius = Math.max(8, Math.floor(Math.min(w, h) / 12));
  const dilated = rankFilter(gray, w, h, radius, true);
  const closed = rankFilter(dilated, w, h, radius, false);
  return boxBlur(closed, w, h, radius, 3);
}

function buildStretchLut(hist, total, clipLow, clipHigh, maxBlackPoint) {
  const lut = new Uint8ClampedArray(256);
  if (total <= 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const lowTarget = total * clipLow;
  const highTarget = total * clipHigh;
  let cumulative = 0;
  let low = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= lowTarget) {
      low = i;
      break;
    }
  }
  cumulative = 0;
  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }
  if (Number.isFinite(maxBlackPoint) && low > maxBlackPoint) low = maxBlackPoint;
  if (low > 254) low = 254;
  if (high <= low) high = low + 1;
  const scale = 255 / (high - low);
  for (let i = 0; i < 256; i++) lut[i] = (i - low) * scale;
  return lut;
}

function planeHistogram(plane, count) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < count; i++) hist[clamp(plane[i] | 0, 0, 255)]++;
  return hist;
}

function unsharpPlane(plane, w, h, amount, radius) {
  const n = w * h;
  const float = new Float32Array(n);
  for (let i = 0; i < n; i++) float[i] = plane[i];
  const blurred = boxBlur(float, w, h, radius, 2);
  for (let i = 0; i < n; i++) plane[i] = float[i] + amount * (float[i] - blurred[i]);
}

/** Bradley/Wellner adaptive threshold over an integral image. */
function bradleyThreshold(plane, w, h, windowSize, ratio) {
  const n = w * h;
  const stride = w + 1;
  const useWide = n * 255 > 4294967295;
  const integral = useWide ? new Float64Array(stride * (h + 1)) : new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += plane[y * w + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }
  const half = windowSize >> 1;
  const out = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      out[y * w + x] = plane[y * w + x] * count < sum * ratio ? 0 : 255;
    }
  }
  return out;
}

function correctedGrayPlane(gray, background, count, maxGain) {
  const plane = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) {
    const bg = background[i];
    const gain = bg > 1 ? Math.min(maxGain, 255 / bg) : maxGain;
    plane[i] = gray[i] * gain;
  }
  return plane;
}

function grayToImage(plane, w, h, alpha) {
  const out = createImage(w, h);
  const data = out.data;
  for (let i = 0, p = 0; i < plane.length; i++, p += 4) {
    const v = plane[i];
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = alpha ? alpha[i] : 255;
  }
  return out;
}

/**
 * Windows with many distinct mid-tones are photos, not ink-on-paper. Barcodes
 * stay bimodal so they keep a hard threshold. The mask is dilated so a face
 * is not eaten by the surrounding paper.
 */
/**
 * Photos are dense mid-tone rectangles. Text is sparse strokes; barcodes are
 * long thin strips. We keep those rectangles in grayscale when binarising.
 */
function photoProtectMask(plane, w, h) {
  const n = w * h;
  const radius = Math.max(7, Math.floor(Math.min(w, h) / 26));
  const dark = new Float32Array(n);
  for (let i = 0; i < n; i++) dark[i] = plane[i] < 170 ? 1 : 0;
  const density = boxBlur(dark, w, h, radius, 2);
  const mark = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (density[i] > 0.3) mark[i] = 1;

  const out = new Uint8Array(n);
  const minSize = Math.floor(n * 0.005);
  const maxSize = Math.floor(n * 0.18);
  let guard = 0;
  while (guard < 8) {
    guard += 1;
    const component = largestComponent(mark, w, h);
    if (!component || component.size < minSize) break;
    for (let k = 0; k < component.members.length; k++) mark[component.members[k]] = 0;
    if (component.size > maxSize) continue;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let k = 0; k < component.members.length; k++) {
      const i = component.members[k];
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw < 12 || bh < 12) continue;
    const aspect = Math.max(bw, bh) / Math.min(bw, bh);
    const fill = component.size / (bw * bh);
    if (aspect > 2.4 || fill < 0.5) continue;

    const pad = Math.max(4, Math.round(Math.min(bw, bh) * 0.08));
    for (let k = 0; k < component.members.length; k++) {
      const i = component.members[k];
      const x = i % w;
      const y = (i / w) | 0;
      const x0 = Math.max(0, x - pad);
      const x1 = Math.min(w - 1, x + pad);
      const y0 = Math.max(0, y - pad);
      const y1 = Math.min(h - 1, y + pad);
      for (let yy = y0; yy <= y1; yy++) {
        let p = yy * w + x0;
        for (let xx = x0; xx <= x1; xx++, p++) out[p] = 1;
      }
    }
  }
  return out;
}

function alphaPlane(image) {
  const n = image.width * image.height;
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0, p = 3; i < n; i++, p += 4) alpha[i] = image.data[p];
  return alpha;
}

/**
 * Scan-style enhancement.
 * @param {RasterImage} image
 * @param {"original"|"color"|"gray"|"bw"|"sharp"} mode
 * @param {Partial<typeof ENHANCE_DEFAULTS>} [options]
 * @returns {RasterImage}
 */
export function enhance(image, mode, options) {
  const source = toRaster(image);
  const config = { ...ENHANCE_DEFAULTS, ...(options || {}) };
  const w = source.width;
  const h = source.height;
  const n = w * h;
  if (mode === "original" || n === 0) return cloneImage(source);

  const gray = lumaPlane(source);
  const background = estimateBackground(gray, w, h);
  const alpha = alphaPlane(source);

  if (mode === "color") {
    const out = createImage(w, h);
    const src = source.data;
    const dst = out.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const bg = background[i];
      const gain = bg > 1 ? Math.min(config.maxGain, 255 / bg) : config.maxGain;
      dst[p] = src[p] * gain;
      dst[p + 1] = src[p + 1] * gain;
      dst[p + 2] = src[p + 2] * gain;
      dst[p + 3] = src[p + 3];
    }
    // One luma-derived LUT for all three channels keeps hue intact.
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = 0.299 * dst[p] + 0.587 * dst[p + 1] + 0.114 * dst[p + 2];
      hist[clamp(v | 0, 0, 255)]++;
    }
    // Capping the black point keeps saturated ink and coloured regions from
    // being crushed to black while paper still clips to white.
    const lut = buildStretchLut(hist, n, config.clipLow, config.clipHigh, config.colorBlackPoint);
    for (let p = 0; p < dst.length; p += 4) {
      dst[p] = lut[dst[p]];
      dst[p + 1] = lut[dst[p + 1]];
      dst[p + 2] = lut[dst[p + 2]];
    }
    const channel = new Uint8ClampedArray(n);
    for (let c = 0; c < 3; c++) {
      for (let i = 0, p = c; i < n; i++, p += 4) channel[i] = dst[p];
      unsharpPlane(channel, w, h, config.unsharpAmount, config.unsharpRadius);
      for (let i = 0, p = c; i < n; i++, p += 4) dst[p] = channel[i];
    }
    return out;
  }

  const plane = correctedGrayPlane(gray, background, n, config.maxGain);

  if (mode === "bw") {
    let window = Math.floor(w / 8);
    if (window < 15) window = 15;
    if (window % 2 === 0) window += 1;
    const binary = bradleyThreshold(plane, w, h, window, config.bwRatio);
    const protect = photoProtectMask(plane, w, h);
    const mixed = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) mixed[i] = protect[i] ? plane[i] : binary[i];
    return grayToImage(mixed, w, h, alpha);
  }

  if (mode === "sharp") {
    const lut = buildStretchLut(planeHistogram(plane, n), n, 0.02, 0.98);
    for (let i = 0; i < n; i++) plane[i] = lut[plane[i]];
    unsharpPlane(plane, w, h, 1, config.unsharpRadius);
    return grayToImage(plane, w, h, alpha);
  }

  const lut = buildStretchLut(planeHistogram(plane, n), n, config.clipLow, config.clipHigh);
  for (let i = 0; i < n; i++) plane[i] = lut[plane[i]];
  return grayToImage(plane, w, h, alpha);
}

/**
 * Rotate by a multiple of 90 degrees.
 * @param {RasterImage} image
 * @param {number} degrees
 * @returns {RasterImage}
 */
export function rotateImage(image, degrees) {
  const source = toRaster(image);
  let turns = Math.round((Number(degrees) || 0) / 90) % 4;
  if (turns < 0) turns += 4;
  if (turns === 0) return cloneImage(source);
  const { width, height, data } = source;
  const swap = turns !== 2;
  const out = createImage(swap ? height : width, swap ? width : height);
  const dst = out.data;
  const ow = out.width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx;
      let ny;
      if (turns === 1) {
        nx = height - 1 - y;
        ny = x;
      } else if (turns === 2) {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      const from = (y * width + x) * 4;
      const to = (ny * ow + nx) * 4;
      dst[to] = data[from];
      dst[to + 1] = data[from + 1];
      dst[to + 2] = data[from + 2];
      dst[to + 3] = data[from + 3];
    }
  }
  return out;
}

/**
 * Light unsharp pass designed to run after an AI upscale: the model tends
 * to soften ink edges, and this restores crispness without halos.
 * @param {RasterImage} image
 * @param {{ amount?: number; radius?: number }} [options]
 * @returns {RasterImage}
 */
export function sharpen(image, options) {
  const source = toRaster(image);
  const config = { amount: 0.35, radius: 1, ...(options || {}) };
  const w = source.width;
  const h = source.height;
  const n = w * h;
  if (n === 0) return cloneImage(source);
  const out = cloneImage(source);
  const channel = new Uint8ClampedArray(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0, p = c; i < n; i++, p += 4) channel[i] = out.data[p];
    unsharpPlane(channel, w, h, config.amount, config.radius);
    for (let i = 0, p = c; i < n; i++, p += 4) out.data[p] = channel[i];
  }
  return out;
}

/**
 * Deepens faded ink toward black while leaving the paper and photo-like
 * regions untouched. Text on old documents is the main win: the curve only
 * touches pixels clearly darker than their local paper level, so mid-tone
 * folds and photographs survive.
 * @param {RasterImage} image
 * @param {{ gamma?: number; threshold?: number }} [options]
 * @returns {RasterImage}
 */
export function inkBoost(image, options) {
  const source = toRaster(image);
  const config = { gamma: 1.45, threshold: 0.55, ...(options || {}) };
  const w = source.width;
  const h = source.height;
  const n = w * h;
  if (n === 0) return cloneImage(source);

  const gray = lumaPlane(source);
  const background = estimateBackground(gray, w, h);
  const protect = photoProtectMask(gray, w, h);
  const alpha = alphaPlane(source);
  const out = createImage(w, h);
  const src = source.data;
  const dst = out.data;
  const th = config.threshold;
  const g = config.gamma;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const bg = background[i];
    dst[p + 3] = alpha[i];
    if (bg < 1 || protect[i]) {
      dst[p] = src[p];
      dst[p + 1] = src[p + 1];
      dst[p + 2] = src[p + 2];
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const t = src[p + c] / bg;
      if (t >= th) {
        dst[p + c] = src[p + c];
      } else {
        dst[p + c] = th * Math.pow(t / th, g) * bg;
      }
    }
  }
  return out;
}

/**
 * Warp, enhance, then optionally rotate.
 * @param {RasterImage} image
 * @param {{ corners?: Quad, size?: { width: number, height: number }, mode?: string, rotate?: number }} [params]
 * @returns {{ image: RasterImage, size: { width: number, height: number } }}
 */
export function processDocument(image, params) {
  const source = toRaster(image);
  const settings = params || {};
  const corners = settings.corners && settings.corners.length === 4
    ? settings.corners
    : detectDocument(source).corners;
  const size = settings.size && settings.size.width > 0 && settings.size.height > 0
    ? { width: Math.round(settings.size.width), height: Math.round(settings.size.height) }
    : suggestOutputSize(corners);
  const warped = warpDocument(source, corners, size);
  const enhanced = enhance(warped, settings.mode || "color");
  const rotated = rotateImage(enhanced, settings.rotate || 0);
  return { image: rotated, size: { width: rotated.width, height: rotated.height } };
}
