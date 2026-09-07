/**
 * Unit checks for the edit overlay's coordinate math — the bits that used to
 * silently mismatch the on-screen preview (page /Rotate, ink rotation, clamp).
 */
import {
  clampGroupDelta,
  clampedMove,
  orientedPoints,
  rectsIntersect,
  rotatePoint,
  visualPointToMedia,
  visualRectToMedia
} from "../assets/js/tools/edit/coords.js";
import { MAX_FIT_SCALE, fitPageCssWidth, stabilizeFitPx } from "../assets/js/tools/edit/fit.js";

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

console.log("\nedit fit (page fills the pane by default, no first-open jump)");

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
    "visible pane height-limits A4 without exceeding the pane",
    close(fitted, expected, 0.5) && fitted <= paneW,
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
    "roomy pane upscales past 1:1 so the page fills its area",
    fitPageCssWidth(A4W, A4H, 1600, 1200) > A4W,
    String(fitPageCssWidth(A4W, A4H, 1600, 1200))
  );
  check(
    "upscale is capped so absurd panes cannot explode memory",
    fitPageCssWidth(A4W, A4H, 9000, 9000) <= A4W * MAX_FIT_SCALE + 1,
    String(fitPageCssWidth(A4W, A4H, 9000, 9000))
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

console.log("\nedit multi-select (rigid group move + marquee)");

{
  const a = { x: 10, y: 10, width: 20, height: 20 };
  const b = { x: 60, y: 60, width: 20, height: 20 };
  const free = clampGroupDelta([a, b], 5, 5, 100, 100);
  check("group move keeps the requested delta inside the page", free.dx === 5 && free.dy === 5);

  const blocked = clampGroupDelta([a, b], -30, 0, 100, 100);
  check("group stops at the tightest edge (a pins at x=0)", blocked.dx === -10 && blocked.dy === 0);

  const far = { x: 80, y: 0, width: 20, height: 20 };
  const pinned = clampGroupDelta([a, far], 40, 7, 100, 100);
  check("group stays glued: far edge blocks dx, both still move in dy", pinned.dx === 0 && pinned.dy === 7);

  check("empty selection never moves", clampGroupDelta([], 5, 5, 100, 100).dx === 0);

  // The single-object path must agree with the group path on one box.
  const one = clampGroupDelta([{ x: 40, y: 40, width: 20, height: 10 }], 5, 3, 100, 100);
  const solo = clampedMove({ x: 40, y: 40, width: 20, height: 10 }, 5, 3, 100, 100);
  check("group-of-one matches clampedMove", one.dx === solo.dx && one.dy === solo.dy);
}

{
  check(
    "marquee catches overlap",
    rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })
  );
  check(
    "marquee ignores disjoint boxes",
    !rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 })
  );
  check(
    "touching edges do not count as selection",
    !rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

console.log("\nedit ui wiring (app.js must only touch refs buildUi() returns)");

{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = (await import("node:path")).default;
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uiSrc = await readFile(path.join(ROOT, "assets/js/tools/edit/ui.js"), "utf8");
  const appSrc = await readFile(path.join(ROOT, "assets/js/tools/edit/app.js"), "utf8");
  const boardSrc = await readFile(path.join(ROOT, "assets/js/tools/edit/board.js"), "utf8");

  const returnBlock = uiSrc.match(/return\s*\{([\s\S]*?)\};\s*\n\}/);
  check("buildUi return block is parseable", Boolean(returnBlock));
  const returned = new Set((returnBlock?.[1].match(/(\w+)\s*:/g) || []).map((m) => m.replace(/\s*:/, "")));
  check("buildUi returns a usable handle set", returned.size > 20, `keys=${returned.size}`);

  const touched = new Set();
  for (const m of appSrc.matchAll(/session\.ui\?\.(\w+)|session\.ui\.(\w+)/g)) touched.add(m[1] || m[2]);
  const missing = [...touched].filter((k) => !returned.has(k));
  check("every session.ui.* in app.js exists in buildUi()", missing.length === 0, missing.join(","));

  // board.js gets its nodes from options only — it must not look up edit ids.
  check(
    "board.js uses no edit element id lookups",
    !/(getElementById\(|querySelector\("#edit-|\bel\("edit-)/.test(boardSrc)
  );

  const templateIds = new Set((uiSrc.match(/id="([\w-]+)"/g) || []).map((m) => m.slice(4, -1)));
  const queriedIds = new Set((uiSrc.match(/querySelector\("#([\w-]+)"\)/g) || []).map((m) => m.match(/#([\w-]+)/)[1]));
  const dangling = [...queriedIds].filter((id) => !templateIds.has(id));
  check("every querySelector id exists in the template", dangling.length === 0, dangling.join(","));

  // One tool, one settings bar: shapes (all kinds) share a single panel.
  const panels = (uiSrc.match(/data-edit-panel="(\w+)"/g) || []).map((m) => m.match(/"(\w+)"/)[1]);
  check(
    "panels are exactly select/text/pen/shapes/image",
    JSON.stringify([...new Set(panels)].sort()) === JSON.stringify(["image", "pen", "select", "shapes", "text"]),
    panels.join(",")
  );
  check("no rect/ellipse/triangle tool radios remain", !/name="edit-tool"[^>]*value="(rect|ellipse|triangle)"/.test(uiSrc));
  check("no usage-instruction text in the edit template", !/(يظهر فوراً|اسحب الزوايا|لطيفة|💡|لطبقة فوق|الناتج PDF)/.test(uiSrc));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
