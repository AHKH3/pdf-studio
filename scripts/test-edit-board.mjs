/**
 * Interaction checks for the edit overlay board: drive the REAL createBoard()
 * pointer/keyboard logic with a minimal fake DOM in Node.
 *
 * These cover what the operator-level flatten tests cannot: Space/Enter must
 * reach the on-canvas text editor (they were eaten by the layer key handler,
 * which also rebuilt the editor and stole focus on every space), and pressing
 * a text node or its resize/rotate grips must start a gesture (a missing
 * focusSelectedText binding threw on every such press, freezing move/resize/
 * rotate for text while hover cursors still changed).
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/* ---------------- fake DOM ---------------- */
const VOID = new Set();
class FakeEl {
  constructor(tag, ns = "") {
    this.tagName = String(tag).toUpperCase();
    this.ns = ns;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this._class = new Set();
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.tabIndex = 0;
    this.scrollHeight = 20;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this._capture = [];
  }
  get classList() {
    const self = this;
    return {
      add(...c) { c.forEach((x) => self._class.add(x)); },
      remove(...c) { c.forEach((x) => self._class.delete(x)); },
      toggle(c, force) {
        if (force === undefined) { self._class.has(c) ? self._class.delete(c) : self._class.add(c); }
        else if (force) self._class.add(c); else self._class.delete(c);
      },
      contains(c) { return self._class.has(c); }
    };
  }
  get className() { return [...this._class].join(" "); }
  set className(v) { this._class = new Set(String(v || "").split(/\s+/).filter(Boolean)); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return !!n._root; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } return this; }
  appendChild(n) { return this.append(n); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  focus() { globalThis.document.activeElement = this; }
  setPointerCapture(id) { this._capture.push(id); }
  closest(sel) {
    let n = this;
    const parts = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
    while (n) {
      for (const p of parts) { if (matchesCompound(n, parseCompound(p))) return n; }
      n = n.parent;
    }
    return null;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const chains = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
    const walk = (node) => {
      for (const ch of node.children) {
        if (chains.some((c) => matchesChain(ch, c))) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }
}

function parseCompound(sel) {
  const out = { tag: null, classes: [], attrs: [] };
  let s = sel.trim();
  const attrRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = attrRe.exec(s))) out.attrs.push({ k: m[1], v: m[2] ?? null });
  s = s.replace(attrRe, "");
  const parts = s.split(".");
  if (parts[0]) out.tag = parts[0].toLowerCase();
  out.classes = parts.slice(1).filter(Boolean);
  return out;
}
function matchesCompound(el, c) {
  if (!el || !el.tagName) return false;
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  for (const cl of c.classes) if (!el._class.has(cl)) return false;
  for (const a of c.attrs) {
    const v = a.k.startsWith("data-") ? el.dataset[a.k.slice(5)] : el.getAttribute(a.k);
    if (a.v === null) { if (v === undefined || v === null) return false; }
    else if (String(v) !== a.v) return false;
  }
  return true;
}
function matchesChain(el, chain) {
  const parts = chain.trim().split(/\s+/).map(parseCompound);
  let cur = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    while (cur && !matchesCompound(cur, parts[i])) cur = cur.parent;
    if (!cur) return false;
    cur = cur.parent;
  }
  return true;
}

const layer = new FakeEl("div");
layer._root = true;
const canvas = {
  tagName: "CANVAS",
  offsetWidth: 600,
  style: {},
  width: 0,
  height: 0,
  dir: "",
  listeners: {},
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
  removeEventListener() {},
  getBoundingClientRect() { return { left: 100, top: 50, width: 600, height: 800 }; },
  getContext() { return { fillStyle: "", direction: "", fillRect() {}, clearRect() {} }; }
};

globalThis.document = {
  activeElement: null,
  caretRangeFromPoint: undefined,
  createElement: (t) => tagEl(t),
  createElementNS: (ns, t) => tagEl(t, ns),
  getElementById: () => null
};
globalThis.window = { devicePixelRatio: 1, PDFLib: {}, "pdfjs-dist/build/pdf": { GlobalWorkerOptions: {} } };
globalThis.HTMLTextAreaElement = class extends FakeEl {};
globalThis.HTMLInputElement = class extends FakeEl {};
globalThis.HTMLElement = class extends FakeEl {};
function tagEl(t, ns = "") {
  const el = new FakeEl(t, ns);
  const low = String(t).toLowerCase();
  if (low === "textarea") Object.setPrototypeOf(el, globalThis.HTMLTextAreaElement.prototype);
  if (low === "input") Object.setPrototypeOf(el, globalThis.HTMLInputElement.prototype);
  return el;
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.getComputedStyle = () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0", borderLeftWidth: "0", borderRightWidth: "0", borderTopWidth: "0", borderBottomWidth: "0" });
globalThis.getSelection = () => null;

/* pdf.js stub for openDocument */
const fakePage = {
  getViewport({ scale }) { return { width: 595 * scale, height: 842 * scale }; },
  render() { return { promise: Promise.resolve() }; },
  cleanup() {}
};
const fakeDoc = { numPages: 1, getPage: async () => fakePage, destroy: async () => {} };
globalThis.window["pdfjs-dist/build/pdf"].getDocument = () => ({ promise: Promise.resolve(fakeDoc) });

const { initPdfEngines } = await import("../assets/js/pdf/core.js");
initPdfEngines();
const { createBoard } = await import("../assets/js/tools/edit/board.js");

/* ---------------- session fakes (mirror app.js) ---------------- */
const objects = [];
const selectedIds = [];
let tool = "text";
let n = 0;
const history = [];
const board = createBoard({
  canvas,
  layer,
  wrap: undefined,
  getObjects: () => objects,
  getSelectedIds: () => selectedIds,
  setSelectedIds: (v) => { selectedIds.length = 0; selectedIds.push(...v); },
  getTool: () => tool,
  getStyle: () => ({ fontSize: 18, textColor: "#111827", bold: false, italic: false, underline: false, align: "right", penColor: "#111827", penWeight: 2, fillOn: true, fill: "#fff", stroke: "#111", strokeWidth: 1.5 }),
  onCreate: (p) => { objects.push({ id: `t${++n}`, rotation: 0, ...p }); selectedIds.length = 0; selectedIds.push(`t${n}`); board.paintOverlay(); },
  onChange: () => {},
  onBeginChange: () => {},
  onHistory: () => { history.push("snap"); },
  onDiscardHistory: () => { history.pop(); },
  onZoomChange: () => {}
});

await board.load(new Uint8Array([1, 2, 3]));
await board.showPage(0);
await new Promise((r) => setTimeout(r, 10));
console.log("visual:", board.visualWidth, "x", board.visualHeight);

/* visual (pt) -> client (px) with the fixed rect above */
const VX = (vx) => 100 + (vx * 600) / 595;
const VY = (vy) => 50 + ((842 - vy) * 800) / 842;

function ev(type, target, extra = {}) {
  return {
    type, target,
    clientX: 0, clientY: 0, pointerId: 7, button: 0,
    shiftKey: false, ctrlKey: false, metaKey: false, key: "",
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    ...extra
  };
}
function fire(target, type, extra) {
  const e = ev(type, target, extra);
  let node = target;
  while (node) {
    for (const fn of (node.listeners?.[type] || [])) fn(e);
    node = node.parent;
  }
  return e;
}
const tick = () => new Promise((r) => setTimeout(r, 10));

/* seed one text object, single-selected */
objects.push({ id: "t1", type: "text", pageIndex: 0, x: 100, y: 100, width: 180, height: 48, rotation: 0, text: "hello", fontSize: 18, color: "#111", bold: false, align: "right" });
selectedIds.push("t1");
board.paintOverlay();
await tick();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name} ${detail}`); }
}
async function reseed() {
  objects.length = 0;
  objects.push({ id: "t1", type: "text", pageIndex: 0, x: 100, y: 100, width: 180, height: 48, rotation: 0, text: "hello", fontSize: 18, color: "#111", bold: false, align: "right" });
  selectedIds.length = 0; selectedIds.push("t1");
  board.paintOverlay();
  await tick();
}

/* T1: space inside canvas textarea must NOT be preventDefaulted */
{
  const area = layer.querySelector(".edit-obj.is-selected textarea");
  check("T1 setup: single text shows a textarea", !!area);
  const e = fire(area, "keydown", { key: " " });
  check("T1 space is not hijacked (defaultPrevented=false)", e.defaultPrevented !== true, `defaultPrevented=${e.defaultPrevented}`);
  const areaFresh = layer.querySelector(".edit-obj.is-selected textarea");
  const e2 = fire(areaFresh, "keydown", { key: "Enter" });
  check("T1 enter is not hijacked", e2.defaultPrevented !== true);
}

/* T2b: press an UNselected text node with the TEXT tool (preview div target) */
{
  tool = "text";
  selectedIds.length = 0;
  board.paintOverlay();
  await tick();
  const node = layer.querySelector(".edit-obj");
  check("T2b setup: unselected text shows a node without textarea", !!node && !node.querySelector("textarea"));
  const before = { x: objects[0].x, y: objects[0].y };
  let threw = "";
  try {
    fire(node, "pointerdown", { clientX: VX(190), clientY: VY(124) });
    fire(layer, "pointermove", { clientX: VX(190) + 60, clientY: VY(124) + 80 });
    fire(layer, "pointerup", { clientX: VX(190) + 60, clientY: VY(124) + 80 });
  } catch (err) { threw = String(err && err.message || err); }
  await tick();
  const scale = 600 / 595;
  const dx = 60 / scale, dy = -80 / scale;
  check("T2b press does not throw", !threw, threw);
  check("T2b drag moves the text box", Math.abs(objects[0].x - (before.x + dx)) < 0.05 && Math.abs(objects[0].y - (before.y + dy)) < 0.05,
    `got (${objects[0].x.toFixed(2)},${objects[0].y.toFixed(2)}) want (${(before.x + dx).toFixed(2)},${(before.y + dy).toFixed(2)})`);
  selectedIds.length = 0; selectedIds.push("t1");
  board.paintOverlay();
  await tick();
}

/* T2: drag the text box with the TEXT tool via the textarea */
{
  tool = "text";
  await reseed();
  const area = layer.querySelector(".edit-obj.is-selected textarea");
  const before = { x: objects[0].x, y: objects[0].y };
  fire(area, "pointerdown", { clientX: VX(190), clientY: VY(124) });
  fire(layer, "pointermove", { clientX: VX(190) + 60, clientY: VY(124) + 80 });
  fire(layer, "pointerup", { clientX: VX(190) + 60, clientY: VY(124) + 80 });
  await tick();
  const scale = 600 / 595;
  const dx = 60 / scale, dy = -80 / scale;
  check("T2 drag moves the text box", Math.abs(objects[0].x - (before.x + dx)) < 0.05 && Math.abs(objects[0].y - (before.y + dy)) < 0.05,
    `got (${objects[0].x.toFixed(2)},${objects[0].y.toFixed(2)}) want (${(before.x + dx).toFixed(2)},${(before.y + dy).toFixed(2)})`);
}

/* T3: SE handle resizes */
{
  await reseed();
  const grip = layer.querySelector('[data-handle="se"]');
  check("T3 setup: SE grip exists", !!grip);
  const bw = objects[0].width, bh = objects[0].height;
  fire(grip, "pointerdown", { clientX: VX(280), clientY: VY(100) });
  fire(layer, "pointermove", { clientX: VX(280) + 59.5, clientY: VY(100) + 42.1 });
  fire(layer, "pointerup", {});
  await tick();
  check("T3 resize grows the box", objects[0].width > bw + 40 && objects[0].height > bh + 40,
    `w ${bw}->${objects[0].width.toFixed(1)} h ${bh}->${objects[0].height.toFixed(1)}`);
}

/* T4: rotate grip rotates */
{
  await reseed();
  const grip = layer.querySelector('[data-handle="rotate"]');
  check("T4 setup: rotate grip exists", !!grip);
  const before = objects[0].rotation || 0;
  fire(grip, "pointerdown", { clientX: VX(190), clientY: VY(200) });
  fire(layer, "pointermove", { clientX: VX(260), clientY: VY(200) });
  fire(layer, "pointerup", {});
  await tick();
  check("T4 rotate changes rotation", (objects[0].rotation || 0) !== before, `rot=${objects[0].rotation}`);
}

/* T5: typing in the canvas textarea updates the object live */
{
  await reseed();
  const area = layer.querySelector(".edit-obj.is-selected textarea");
  area.value = "hello world";
  fire(area, "input", {});
  await tick();
  check("T5 typing updates obj.text", objects[0].text === "hello world", `text=${JSON.stringify(objects[0].text)}`);
}

console.log(failures ? `\n${failures} FAILURES` : "\nall interaction checks passed");
process.exit(failures ? 1 : 0);
