/**
 * Runs the scanning pipeline over the real reference photographs in
 * assets/samples/document-scan and writes every stage to tmp/scan-out so the
 * result can be inspected by eye, not only by assertion.
 *
 * Usage: node scripts/scan-samples.mjs [name...]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decodePng, encodePng } from "./lib/png.mjs";
import { detectDocument, enhance, suggestOutputSize, warpDocument } from "../assets/js/scan/pipeline.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN = path.join(ROOT, "assets", "samples", "document-scan");
const OUT = path.join(ROOT, "tmp", "scan-out");

const MODES = ["color", "gray", "bw", "sharp"];

function drawQuad(image, corners, radius = 3) {
  const marked = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  const put = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
        const p = (ny * image.width + nx) * 4;
        marked.data[p] = 220;
        marked.data[p + 1] = 30;
        marked.data[p + 2] = 20;
      }
    }
  };
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let s = 0; s <= steps; s += 1) put(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
  return marked;
}

function stats(image) {
  let sum = 0;
  let min = 255;
  let max = 0;
  const n = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    const luma = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    sum += luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return { mean: sum / n, min, max };
}

/** Share of pixels within 8 levels of pure white — the "paper is paper" check. */
function paperRatio(image) {
  let white = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] > 247 && image.data[i + 1] > 247 && image.data[i + 2] > 247) white += 1;
  }
  return white / (image.width * image.height);
}

/** Colour spread; near zero means the yellow cast has been neutralised. */
function inQuad(quad, x, y) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const a = quad[i];
    const b = quad[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function paperish(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 && r - g < 8;
}

function woodish(r, g, b) {
  return r - g > 12 && 0.299 * r + 0.587 * g + 0.114 * b < 165;
}

function coverage(image, quad) {
  const { width: w, height: h, data } = image;
  let paper = 0;
  let paperIn = 0;
  let woodIn = 0;
  let totIn = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const p = (y * w + x) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const inside = inQuad(quad, x + 0.5, y + 0.5);
      if (inside) totIn += 1;
      if (paperish(r, g, b)) {
        paper += 1;
        if (inside) paperIn += 1;
      } else if (woodish(r, g, b) && inside) {
        woodIn += 1;
      }
    }
  }
  return {
    recall: paper ? paperIn / paper : 0,
    woodFraction: totIn ? woodIn / totIn : 1
  };
}

/** Colour spread; near zero means the yellow cast has been neutralised. */
function chroma(image) {
  let sum = 0;
  const n = image.width * image.height;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return sum / n;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const filter = process.argv.slice(2);
  const files = readdirSync(IN)
    .filter((name) => /\.png$/i.test(name))
    .filter((name) => !filter.length || filter.some((f) => name.includes(f)));

  for (const file of files) {
    const stem = path.basename(file, path.extname(file));
    const source = decodePng(readFileSync(path.join(IN, file)));
    console.log(`\n${file} — ${source.width}×${source.height}`);

    let started = Date.now();
    const detection = detectDocument(source);
    const detectMs = Date.now() - started;
    const area =
      Math.abs(
        detection.corners.reduce(
          (sum, p, i) => {
            const q = detection.corners[(i + 1) % 4];
            return sum + (p.x * q.y - q.x * p.y);
          },
          0
        ) / 2
      ) /
      (source.width * source.height);

    console.log(`  detect   ${detectMs}ms  method=${detection.method}  confidence=${detection.confidence.toFixed(2)}  area=${(area * 100).toFixed(1)}%`);
    console.log(`  corners  ${detection.corners.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(" ")}`);
    const cov = coverage(source, detection.corners);
    console.log(`  fit      paper-recall=${(cov.recall * 100).toFixed(1)}%  wood-in-quad=${(cov.woodFraction * 100).toFixed(1)}%`);

    writeFileSync(path.join(OUT, `${stem}-0-detected.png`), encodePng(drawQuad(source, detection.corners)));

    const size = suggestOutputSize(detection.corners);
    started = Date.now();
    const warped = warpDocument(source, detection.corners, size);
    console.log(`  warp     ${Date.now() - started}ms  ->  ${warped.width}×${warped.height}`);
    writeFileSync(path.join(OUT, `${stem}-1-warped.png`), encodePng(warped));

    for (const mode of MODES) {
      started = Date.now();
      const result = enhance(warped, mode);
      const ms = Date.now() - started;
      const s = stats(result);
      console.log(
        `  ${mode.padEnd(8)} ${String(ms).padStart(5)}ms  mean=${s.mean.toFixed(0)}  range=${s.min.toFixed(0)}-${s.max.toFixed(0)}  paper=${(paperRatio(result) * 100).toFixed(0)}%  chroma=${chroma(result).toFixed(1)}`
      );
      writeFileSync(path.join(OUT, `${stem}-2-${mode}.png`), encodePng(result));
    }
  }

  console.log(`\nwrote stages to ${path.relative(ROOT, OUT)}`);
}

main();
