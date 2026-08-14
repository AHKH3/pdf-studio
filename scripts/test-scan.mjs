/**
 * Checks the scanning pipeline against synthetic documents.
 * Run with: npm test
 *
 * The pipeline is deliberately free of DOM and canvas APIs so it can be
 * exercised here, in plain Node, with no browser and no dependencies.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { detectDocument, enhance, processDocument, rotateImage, suggestOutputSize, warpDocument } from "../assets/js/scan/pipeline.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name, body) {
  console.log(`\n${name}`);
  body();
}

function blank(width, height, shade = 40) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = shade;
    data[i + 1] = shade;
    data[i + 2] = shade;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(image, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const p = (y * image.width + x) * 4;
  image.data[p] = r;
  image.data[p + 1] = g;
  image.data[p + 2] = b;
  image.data[p + 3] = 255;
}

function inQuad(quad, x, y) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const a = quad[i];
    const b = quad[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * A bright page on a dark table, tilted in perspective, with darker text bars
 * and an illumination gradient across the sheet.
 */
function synthetic({ width = 900, height = 700, quad, gradient = true, text = true }) {
  const image = blank(width, height, 38);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inQuad(quad, x + 0.5, y + 0.5)) continue;
      const shade = gradient ? 250 - (x / width) * 90 - (y / height) * 40 : 244;
      setPixel(image, x, y, shade, shade, shade - 2);
    }
  }
  if (text) {
    const minX = Math.min(...quad.map((p) => p.x));
    const maxX = Math.max(...quad.map((p) => p.x));
    const minY = Math.min(...quad.map((p) => p.y));
    const maxY = Math.max(...quad.map((p) => p.y));
    for (let line = 0; line < 14; line += 1) {
      const y0 = Math.round(minY + ((maxY - minY) * (line + 1)) / 16);
      for (let y = y0; y < y0 + 5; y += 1) {
        for (let x = Math.round(minX + 40); x < maxX - 40; x += 1) {
          if (!inQuad(quad, x + 0.5, y + 0.5)) continue;
          setPixel(image, x, y, 28, 26, 30);
        }
      }
    }
  }
  return image;
}

function corner(quad, name) {
  const map = { tl: 0, tr: 1, br: 2, bl: 3 };
  return quad[map[name]];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Mean corner error, order-insensitive against the closest truth corner. */
function cornerError(found, truth) {
  return (
    found.reduce((sum, point) => sum + Math.min(...truth.map((t) => distance(point, t))), 0) / found.length
  );
}

const tilted = [
  { x: 150, y: 90 },
  { x: 760, y: 150 },
  { x: 700, y: 610 },
  { x: 110, y: 540 }
];

group("detectDocument", () => {
  const image = synthetic({ quad: tilted });
  const result = detectDocument(image);
  const error = cornerError(result.corners, tilted);
  check("finds a quad on a tilted page", result.method !== "fallback", `method=${result.method}`);
  check("corners land within 30px of truth", error < 30, `mean error ${error.toFixed(1)}px`);
  check("reports usable confidence", result.confidence > 0.3, `confidence ${result.confidence.toFixed(2)}`);
  check("orders corners clockwise from top-left", corner(result.corners, "tl").x < corner(result.corners, "tr").x);
  check("bottom row sits below the top row", corner(result.corners, "bl").y > corner(result.corners, "tl").y);
});

group("detectDocument — degenerate input", () => {
  const tiny = blank(8, 8);
  const result = detectDocument(tiny);
  check("falls back on a tiny image", result.method === "fallback");
  check("fallback still returns four corners", result.corners.length === 4);

  const flat = blank(300, 200, 128);
  const flatResult = detectDocument(flat);
  check("never throws on a flat image", Array.isArray(flatResult.corners) && flatResult.corners.length === 4);
});

group("warpDocument", () => {
  const image = synthetic({ quad: tilted, text: false });
  const size = suggestOutputSize(tilted);
  const warped = warpDocument(image, tilted, size);
  check("returns the requested size", warped.width === size.width && warped.height === size.height);

  // Every pixel of the warped output should come from inside the page, so the
  // dark table must be gone.
  let dark = 0;
  for (let i = 0; i < warped.data.length; i += 4) if (warped.data[i] < 90) dark += 1;
  const ratio = dark / (warped.width * warped.height);
  check("drops the background", ratio < 0.02, `${(ratio * 100).toFixed(1)}% dark pixels remain`);
});

group("enhance", () => {
  const image = synthetic({ quad: tilted });
  const warped = warpDocument(image, tilted, suggestOutputSize(tilted));

  const grayed = enhance(warped, "gray");
  let min = 255;
  let max = 0;
  for (let i = 0; i < grayed.data.length; i += 4) {
    if (grayed.data[i] < min) min = grayed.data[i];
    if (grayed.data[i] > max) max = grayed.data[i];
  }
  check("stretches contrast to the full range", max - min > 200, `range ${min}-${max}`);

  const bw = enhance(warped, "bw");
  const values = new Set();
  for (let i = 0; i < bw.data.length; i += 4) values.add(bw.data[i]);
  check("black and white is strictly two-valued", values.size <= 2, `${values.size} distinct values`);

  let white = 0;
  for (let i = 0; i < bw.data.length; i += 4) if (bw.data[i] === 255) white += 1;
  const paper = white / (bw.width * bw.height);
  check("paper stays white under a lighting gradient", paper > 0.5, `${(paper * 100).toFixed(0)}% white`);

  const untouched = enhance(warped, "original");
  check("original mode changes nothing", untouched.data.every((v, i) => v === warped.data[i]));
});

group("rotateImage", () => {
  const image = synthetic({ width: 200, height: 120, quad: [
    { x: 20, y: 15 },
    { x: 180, y: 15 },
    { x: 180, y: 105 },
    { x: 20, y: 105 }
  ] });
  const once = rotateImage(image, 90);
  check("swaps the axes at 90 degrees", once.width === 120 && once.height === 200);
  const full = rotateImage(rotateImage(rotateImage(once, 90), 90), 90);
  check("four quarter turns restore the original", full.width === 200 && full.height === 120);
  check("four quarter turns restore the pixels", full.data.every((v, i) => v === image.data[i]));
});

group("detectDocument — interior fold", () => {
  const page = [
    { x: 90, y: 50 },
    { x: 810, y: 80 },
    { x: 780, y: 640 },
    { x: 70, y: 610 }
  ];
  const image = synthetic({ width: 900, height: 700, quad: page });
  for (let y = 330; y < 338; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (inQuad(page, x + 0.5, y + 0.5)) setPixel(image, x, y, 28, 26, 24);
    }
  }
  const result = detectDocument(image);
  const error = cornerError(result.corners, page);
  check("does not lock onto the crease", error < 45, `mean error ${error.toFixed(1)}px method=${result.method}`);
  const height = Math.hypot(
    result.corners[3].x - result.corners[0].x,
    result.corners[3].y - result.corners[0].y
  );
  check("keeps the full page height", height > 420, `height ${height.toFixed(0)}`);
});

group("processDocument", () => {
  const image = synthetic({ quad: tilted });
  const result = processDocument(image, { mode: "color" });
  check("returns an image without explicit corners", result.image.width > 100 && result.image.height > 100);
  const rotated = processDocument(image, { corners: tilted, mode: "gray", rotate: 90 });
  check("honours rotation", rotated.image.height > rotated.image.width === (result.image.width > result.image.height));
});

function paperish(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 && r - g < 8;
}

function woodish(r, g, b) {
  return r - g > 12 && 0.299 * r + 0.587 * g + 0.114 * b < 165;
}

function quadCoverage(image, quad) {
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

function sampleArea(name) {
  const image = decodePng(readFileSync(path.join(ROOT, "assets", "samples", "document-scan", name)));
  const result = detectDocument(image);
  const area = Math.abs(
    result.corners.reduce((sum, p, i) => {
      const q = result.corners[(i + 1) % 4];
      return sum + (p.x * q.y - q.x * p.y);
    }, 0) / 2
  );
  return { result, areaRatio: area / (image.width * image.height), image };
}

group("real photographs", () => {
  const permit = sampleArea("residence-permit.png");
  check(
    "residence permit covers most of the frame",
    permit.areaRatio > 0.5,
    `area=${(permit.areaRatio * 100).toFixed(1)}% method=${permit.result.method}`
  );
  const permitHeight = Math.hypot(
    permit.result.corners[3].x - permit.result.corners[0].x,
    permit.result.corners[3].y - permit.result.corners[0].y
  );
  check("residence permit is portrait-tall", permitHeight > 600, `height ${permitHeight.toFixed(0)}`);

  const card = sampleArea("unhcr-card.png");
  check(
    "UNHCR card covers most of the frame",
    card.areaRatio > 0.55,
    `area=${(card.areaRatio * 100).toFixed(1)}% method=${card.result.method}`
  );
  const warped = warpDocument(card.image, card.result.corners, suggestOutputSize(card.result.corners));
  const bw = enhance(warped, "bw");
  let mid = 0;
  const bandY0 = Math.floor(bw.height * 0.22);
  const bandY1 = Math.floor(bw.height * 0.55);
  const bandX0 = Math.floor(bw.width * 0.04);
  const bandX1 = Math.floor(bw.width * 0.42);
  let count = 0;
  for (let y = bandY0; y < bandY1; y += 1) {
    for (let x = bandX0; x < bandX1; x += 1) {
      const v = bw.data[(y * bw.width + x) * 4];
      count += 1;
      if (v > 20 && v < 235) mid += 1;
    }
  }
  check(
    "UNHCR photo region keeps gray levels under B&W",
    count > 0 && mid / count > 0.08,
    `midtones ${(100 * mid / Math.max(1, count)).toFixed(1)}%`
  );
});

group("gold photographs — corner accuracy", () => {
  const expected = JSON.parse(
    readFileSync(path.join(ROOT, "assets", "samples", "document-scan", "expected-corners.json"), "utf8")
  );
  for (const [name, spec] of Object.entries(expected)) {
    const image = decodePng(readFileSync(path.join(ROOT, "assets", "samples", "document-scan", name)));
    const result = detectDocument(image);
    const error = cornerError(result.corners, spec.corners);
    const coverage = quadCoverage(image, result.corners);
    const rightmost = Math.max(...result.corners.map((p) => p.x));
    check(
      `${name} corners near the sheet`,
      error <= spec.maxMeanError,
      `mean error ${error.toFixed(1)}px method=${result.method}`
    );
    check(
      `${name} covers the paper`,
      coverage.recall >= spec.minPaperRecall,
      `recall ${(coverage.recall * 100).toFixed(1)}%`
    );
    check(
      `${name} excludes the wood`,
      coverage.woodFraction <= spec.maxWoodFraction,
      `wood ${(coverage.woodFraction * 100).toFixed(1)}%`
    );
    check(
      `${name} does not hug the right frame`,
      rightmost < image.width - 40,
      `rightmost ${rightmost.toFixed(0)} of ${image.width}`
    );
  }
});

group("detectDocument — yellow page on brown wood", () => {
  const page = [
    { x: 120, y: 70 },
    { x: 780, y: 95 },
    { x: 750, y: 630 },
    { x: 90, y: 600 }
  ];
  const image = blank(900, 700, 0);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const grain = (x % 17) * 2;
      setPixel(image, x, y, 92 + grain, 72, 58);
    }
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!inQuad(page, x + 0.5, y + 0.5)) continue;
      setPixel(image, x, y, 196, 200, 166);
    }
  }
  for (let y = 340; y < 348; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (inQuad(page, x + 0.5, y + 0.5)) setPixel(image, x, y, 120, 118, 90);
    }
  }
  const result = detectDocument(image);
  const error = cornerError(result.corners, page);
  check("finds the yellow sheet on wood", error < 28, `mean error ${error.toFixed(1)}px method=${result.method}`);
  const height = Math.hypot(
    result.corners[3].x - result.corners[0].x,
    result.corners[3].y - result.corners[0].y
  );
  check("fold shadow is not the crop edge", height > 420, `height ${height.toFixed(0)}`);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
