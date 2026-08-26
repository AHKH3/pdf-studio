/**
 * Unit checks for the edit overlay's coordinate math — the bits that used to
 * silently mismatch the on-screen preview (page /Rotate, ink rotation, clamp).
 */
import {
  clampedMove,
  orientedPoints,
  rotatePoint,
  visualPointToMedia,
  visualRectToMedia
} from "../assets/js/tools/edit/coords.js";
import { fitPageCssWidth, stabilizeFitPx } from "../assets/js/tools/edit/fit.js";

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function pointEq(got, expected, eps = 1e-6) {
  return close(got.x, expected.x, eps) && close(got.y, expected.y, eps);
}

function fmt(point) {
  return `(${point.x}, ${point.y})`;
}

console.log("\nedit coords (visual ↔ media, ink rotation, clamp)");

{
  const p = rotatePoint(1, 0, 0, 0, 90);
  check("clockwise 90 around origin: (1,0) → (0,-1)", pointEq(p, { x: 0, y: -1 }), fmt(p));
}

{
  const obj = { x: 0, y: 0, width: 10, height: 10, rotation: 90 };
  const [spun] = orientedPoints(obj, [{ x: 10, y: 5 }]);
  check(
    "ink 90°: right-middle goes to bottom-middle",
    pointEq(spun, { x: 5, y: 0 }),
    fmt(spun)
  );
  check("unrotated ink keeps original points", orientedPoints({ ...obj, rotation: 0 }, [{ x: 10, y: 5 }])[0].x === 10);
}

{
  const mediaW = 200;
  const mediaH = 100;
  const visual = { x: 10, y: 20 };
  check(
    "page 0° point is identity",
    pointEq(visualPointToMedia(0, mediaW, mediaH, visual.x, visual.y), visual)
  );
  check(
    "page 90° point",
    pointEq(visualPointToMedia(90, mediaW, mediaH, visual.x, visual.y), { x: mediaW - visual.y, y: visual.x })
  );
  check(
    "page 180° point",
    pointEq(visualPointToMedia(180, mediaW, mediaH, visual.x, visual.y), {
      x: mediaW - visual.x,
      y: mediaH - visual.y
    })
  );
  check(
    "page 270° point",
    pointEq(visualPointToMedia(270, mediaW, mediaH, visual.x, visual.y), { x: visual.y, y: mediaH - visual.x })
  );
}

{
  const rect = { x: 10, y: 20, width: 30, height: 40 };
  const r0 = visualRectToMedia(0, 200, 100, rect);
  check("page 0° rect keeps size", r0.width === 30 && r0.height === 40 && r0.ccw === 0);

  const r90 = visualRectToMedia(90, 200, 100, rect);
  check(
    "page 90° rect swaps edges and stamps 1 ccw quarter",
    r90.width === 40 && r90.height === 30 && r90.ccw === 1 && close(r90.x, 200 - 20 - 40) && close(r90.y, 10),
    JSON.stringify(r90)
  );

  const r180 = visualRectToMedia(180, 200, 100, rect);
  check(
    "page 180° rect",
    r180.width === 30 && r180.height === 40 && r180.ccw === 2 && close(r180.x, 200 - 10 - 30) && close(r180.y, 100 - 20 - 40),
    JSON.stringify(r180)
  );

  const r270 = visualRectToMedia(270, 200, 100, rect);
  check(
    "page 270° rect swaps edges and stamps 3 ccw quarters",
    r270.width === 40 && r270.height === 30 && r270.ccw === 3 && close(r270.x, 20) && close(r270.y, 100 - 10 - 30),
    JSON.stringify(r270)
  );
}

{
  const obj = { x: 40, y: 40, width: 20, height: 10, rotation: 90, points: [{ x: 50, y: 45 }] };
  const [world] = orientedPoints(obj);
  const media = visualPointToMedia(90, 200, 100, world.x, world.y);
  check(
    "rotated ink then 90° page maps through both spaces",
    Number.isFinite(media.x) && Number.isFinite(media.y),
    fmt(media)
  );
}

{
  const box = { x: 0, y: 0, width: 20, height: 20 };
  const blocked = clampedMove(box, -8, 0, 100, 100);
  check("clamp at origin reports no delta", blocked.dx === 0 && blocked.dy === 0 && blocked.x === 0);

  const slid = clampedMove(box, 5, 3, 100, 100);
  check("in-page move keeps requested delta", slid.dx === 5 && slid.dy === 3 && slid.x === 5 && slid.y === 3);

  const edge = { x: 80, y: 0, width: 20, height: 20 };
  const bump = clampedMove(edge, 40, 0, 100, 100);
  check("clamp at far edge reports no delta", bump.dx === 0 && bump.x === 80);
}

console.log("\nedit fit (page CSS width must not oscillate on open)");

{
  const A4W = 595;
  const A4H = 842;

  check(
    "hidden / zero wrap is not laid out — return 0 so we do not shrink to 120px",
    fitPageCssWidth(A4W, A4H, 0, 0) === 0 && fitPageCssWidth(A4W, A4H, 40, 40) === 0
  );

  const paneW = 660;
  const paneH = 380;
  const fitted = fitPageCssWidth(A4W, A4H, paneW, paneH);
  const expected = paneH * (A4W / A4H);
  check(
    "visible pane height-limits A4 without exceeding width or 1:1",
    close(fitted, expected, 0.5) && fitted <= paneW && fitted <= A4W,
    String(fitted)
  );

  check(
    "never wider than the pane even when minPx would overflow",
    fitPageCssWidth(A4W, A4H, 100, 80) <= 100
  );
  check(
    "tiny pane is height-limited instead of forced to 120px",
    fitPageCssWidth(A4W, A4H, 100, 80) < 120 && fitPageCssWidth(A4W, A4H, 100, 80) > 0
  );

  check(
    "stabilize ignores 1px jitter that used to retrigger ResizeObserver",
    stabilizeFitPx(268.4, 268, 2) === 268 && stabilizeFitPx(280, 268, 2) === 280
  );

  check("stabilize keeps previous size when the wrap is not laid out yet", stabilizeFitPx(0, 268) === 268);

  function legacyFit(pageW, pageH, boxW, boxH) {
    const w = Math.max(80, boxW);
    const h = Math.max(80, boxH);
    const byHeight = h * (pageW / pageH);
    return Math.max(120, Math.min(w, byHeight, pageW));
  }

  check(
    "legacy hidden wrap reports 120px — the first-open jump before layout",
    legacyFit(A4W, A4H, 0, 0) === 120
  );

  const frames = [];
  let last = 0;
  for (const box of [
    [0, 0],
    [0, 0],
    [660, 380]
  ]) {
    last = stabilizeFitPx(fitPageCssWidth(A4W, A4H, box[0], box[1]), last);
    if (last) frames.push(Math.round(last));
  }
  check(
    "skipping hidden measures means the first visible width is the pane fit, not 120",
    frames.length === 1 && frames[0] === Math.round(paneH * (A4W / A4H)),
    frames.join(" → ")
  );

  const stablePaneH = 640;
  const stable = [];
  let prev = 0;
  for (let i = 0; i < 10; i++) {
    const next = stabilizeFitPx(fitPageCssWidth(A4W, A4H, 660, stablePaneH), prev);
    stable.push(Math.round(next));
    prev = next;
  }
  check(
    "new fit on a fixed pane converges to one CSS width",
    new Set(stable).size === 1 && stable[0] > 120,
    stable.join(" → ")
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
