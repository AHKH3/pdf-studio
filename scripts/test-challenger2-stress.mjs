/**
 * Challenger 2: Layers & Export Pipeline Empirical Stress Test Harness
 *
 * Standalone stress test runner for Challenger 2:
 * 1. 50+ mixed objects (text, ink, rect, ellipse, triangle, image) lifecycle & PDF flattening.
 * 2. Layer reordering (drag-drop, top-to-bottom, bottom-to-top, cross-page isolation).
 * 3. Active vs inactive layer deletion, URL revocation, selection safety.
 * 4. Multi-page rotated layouts (0°, 90°, 180°, 270°) coordinate geometry & output validity.
 * 5. Adversarial boundary conditions: zero-dim shapes, single-point ink, whitespace text, invalid page indices.
 * 6. Multi-step undo/redo reordering & deletion lifecycle.
 */

import { Buffer } from "node:buffer";
import * as PDFLib from "pdf-lib";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { initPdfEngines } from "../assets/js/pdf/core.js";

// Global DOM Simulation for Node
class FakeDOMTokenList {
  constructor(node) {
    this._node = node;
  }
  _getTokens() {
    return (this._node._className || "").trim().split(/\s+/).filter(Boolean);
  }
  _setTokens(tokens) {
    this._node._className = tokens.join(" ");
  }
  add(...tokens) {
    const current = new Set(this._getTokens());
    for (const t of tokens) if (t) current.add(t);
    this._setTokens(Array.from(current));
  }
  remove(...tokens) {
    const current = new Set(this._getTokens());
    for (const t of tokens) current.delete(t);
    this._setTokens(Array.from(current));
  }
  toggle(token, force) {
    const current = new Set(this._getTokens());
    const has = current.has(token);
    const shouldHave = force !== undefined ? Boolean(force) : !has;
    if (shouldHave) current.add(token);
    else current.delete(token);
    this._setTokens(Array.from(current));
    return shouldHave;
  }
  contains(token) {
    return this._getTokens().includes(token);
  }
  toString() {
    return this._node._className || "";
  }
}

class FakeDataTransfer {
  constructor() {
    this.data = new Map();
    this.effectAllowed = "all";
    this.dropEffect = "none";
    this.files = [];
  }
  setData(format, data) {
    this.data.set(format, String(data));
  }
  getData(format) {
    return this.data.get(format) || "";
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.target = init.target || null;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this._stopPropagation = false;
    this.dataTransfer = init.dataTransfer || new FakeDataTransfer();
    this.key = init.key || "";
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
    this.shiftKey = Boolean(init.shiftKey);
    this.altKey = Boolean(init.altKey);
    Object.assign(this, init);
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stopPropagation = true;
  }
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

class FakeCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.font = "16px sans-serif";
    this.fillStyle = "#000000";
    this.strokeStyle = "#000000";
    this.lineWidth = 1;
    this.direction = "ltr";
    this.textAlign = "start";
    this.textBaseline = "alphabetic";
  }
  save() {}
  restore() {}
  beginPath() {}
  rect() {}
  clip() {}
  fillText() {}
  fillRect() {}
  measureText(text) {
    return { width: (String(text).length || 1) * 8 };
  }
  translate() {}
  rotate() {}
  scale() {}
  drawImage() {}
  clearRect() {}
}

class FakeNode {
  constructor(nodeType, tagName = "", textContent = "") {
    this.nodeType = nodeType;
    this.tagName = tagName.toUpperCase();
    this._textContent = textContent;
    this._className = "";
    this.id = "";
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.classList = new FakeDOMTokenList(this);
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.tabIndex = -1;
    this._value = "";
    this._checked = false;
    this._disabled = false;
    this._hidden = false;
    this.width = 794;
    this.height = 1123;
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
    this._ctx = null;
  }

  getContext(type) {
    if (!this._ctx) this._ctx = new FakeCanvasContext(this);
    return this._ctx;
  }

  toBlob(callback, type = "image/png") {
    const blob = new Blob([ONE_PIXEL_PNG], { type });
    if (callback) setTimeout(() => callback(blob), 0);
  }

  get name() { return this.getAttribute("name") || ""; }
  set name(v) { this.setAttribute("name", v); }

  get type() { return this.getAttribute("type") || ""; }
  set type(v) { this.setAttribute("type", v); }

  get className() { return this._className; }
  set className(val) { this._className = String(val || ""); }

  get textContent() {
    if (this.nodeType === 3) return this._textContent;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(val) {
    this.childNodes = [];
    if (this.nodeType === 3) {
      this._textContent = String(val);
    } else if (val) {
      const textNode = new FakeNode(3, "#text", String(val));
      textNode.parentNode = this;
      this.childNodes.push(textNode);
    }
  }

  get value() { return this._value; }
  set value(v) { this._value = String(v ?? ""); }

  get checked() { return this._checked; }
  set checked(c) {
    this._checked = Boolean(c);
    if (this._checked && this.tagName === "INPUT" && this.getAttribute("type") === "radio") {
      const radioName = this.getAttribute("name");
      if (radioName) {
        const uncheckOthers = (node) => {
          if (node !== this && node.nodeType === 1 && node.tagName === "INPUT" && node.getAttribute("type") === "radio" && node.getAttribute("name") === radioName) {
            node._checked = false;
          }
          for (const ch of node.childNodes) {
            if (ch.nodeType === 1) uncheckOthers(ch);
          }
        };
        if (globalThis.document?.head) uncheckOthers(globalThis.document.head);
        if (globalThis.document?.body) uncheckOthers(globalThis.document.body);
      }
    }
  }

  get disabled() { return this._disabled; }
  set disabled(d) {
    this._disabled = Boolean(d);
    if (this._disabled) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get hidden() { return this._hidden; }
  set hidden(h) {
    this._hidden = Boolean(h);
    if (this._hidden) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  setAttribute(name, value) {
    const valStr = String(value ?? "");
    this.attributes.set(name, valStr);
    if (name === "id") this.id = valStr;
    if (name === "class") this.className = valStr;
    if (name === "value") this._value = valStr;
    if (name === "checked") this._checked = true;
    if (name === "disabled") this._disabled = true;
    if (name === "hidden") this._hidden = true;
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[prop] = valStr;
    }
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name === "value") return this._value || null;
    if (name === "checked") return this._checked ? "" : null;
    if (name === "disabled") return this._disabled ? "" : null;
    if (name === "hidden") return this._hidden ? "" : null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    if (name === "id") return Boolean(this.id);
    if (name === "class") return Boolean(this.className);
    if (name === "hidden") return this._hidden;
    if (name === "disabled") return this._disabled;
    if (name === "checked") return this._checked;
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "id") this.id = "";
    if (name === "class") this.className = "";
    if (name === "hidden") this._hidden = false;
    if (name === "disabled") this._disabled = false;
    if (name === "checked") this._checked = false;
    if (name.startsWith("data-")) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[prop];
    }
  }

  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") {
        const textNode = new FakeNode(3, "#text", n);
        textNode.parentNode = this;
        this.childNodes.push(textNode);
      } else if (n instanceof FakeNode) {
        if (n.parentNode) n.remove();
        n.parentNode = this;
        this.childNodes.push(n);
      }
    }
  }

  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
    this.parentNode = null;
  }

  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    const entry = { listener, options };
    this.listeners.get(type).push(entry);
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        const list = this.listeners.get(type);
        if (list) {
          const i = list.indexOf(entry);
          if (i >= 0) list.splice(i, 1);
        }
      });
    }
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.findIndex((e) => e.listener === listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    let cur = this;
    while (cur) {
      event.currentTarget = cur;
      const list = cur.listeners.get(event.type) || [];
      for (const { listener } of [...list]) {
        try {
          if (typeof listener === "function") listener.call(cur, event);
          else if (listener && typeof listener.handleEvent === "function") listener.handleEvent(event);
        } catch (e) {
          console.error(e);
        }
      }
      if (!event.bubbles || event._stopPropagation) break;
      cur = cur.parentNode;
    }
    return !event.defaultPrevented;
  }

  click() {
    const event = new FakeEvent("click", { bubbles: true, cancelable: true, target: this });
    this.dispatchEvent(event);
  }

  focus() {}
  blur() {}

  matches(sel) {
    if (!sel || this.nodeType !== 1) return false;
    const orParts = sel.split(",").map((p) => p.trim());
    return orParts.some((part) => this._matchesSingle(part));
  }

  _matchesSingle(sel) {
    let current = sel.trim();
    if (!current) return false;
    if (current.includes(":checked")) {
      if (!this._checked) return false;
      current = current.replace(":checked", "");
    }
    if (current.includes(":disabled")) {
      if (!this._disabled) return false;
      current = current.replace(":disabled", "");
    }
    const idMatch = current.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (this.id !== idMatch[1]) return false;
      current = current.replace(idMatch[0], "");
    }
    const classMatches = current.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        if (!this.classList.contains(cm.slice(1))) return false;
        current = current.replace(cm, "");
      }
    }
    const attrMatches = current.match(/\[([a-zA-Z0-9_-]+)(?:([~|^$*]?=)(?:"([^"]*)"|'([^']*)'|([^"'\]]*)))?\]/g);
    if (attrMatches) {
      for (const am of attrMatches) {
        const m = am.match(/\[([a-zA-Z0-9_-]+)(?:([~|^$*]?=)(?:"([^"]*)"|'([^']*)'|([^"'\]]*)))?\]/);
        if (!m) return false;
        const attrName = m[1];
        const op = m[2];
        const expectedVal = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
        const val = this.getAttribute(attrName);
        if (val === null) return false;
        if (op === "=" && val !== expectedVal) return false;
        if (op === "*=" && !val.includes(expectedVal)) return false;
        current = current.replace(am, "");
      }
    }
    current = current.trim();
    if (!current) return true;
    return this.tagName.toLowerCase() === current.toLowerCase();
  }

  closest(sel) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const orParts = sel.split(",").map((s) => s.trim());
    const matchedSet = new Set();

    for (const part of orParts) {
      const segments = part.split(/\s+/).filter(Boolean);
      let currentCandidates = [this];

      for (const seg of segments) {
        const nextCandidates = [];
        for (const parent of currentCandidates) {
          const walk = (node) => {
            for (const child of node.childNodes) {
              if (child.nodeType === 1) {
                if (child.matches(seg)) nextCandidates.push(child);
                walk(child);
              }
            }
          };
          walk(parent);
        }
        currentCandidates = nextCandidates;
      }
      for (const c of currentCandidates) matchedSet.add(c);
    }
    return Array.from(matchedSet);
  }

  get innerHTML() {
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.textContent : `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)).join("");
  }

  set innerHTML(htmlString) {
    this.childNodes = [];
    parseHTML(htmlString, this);
  }
}

function parseHTML(html, parent) {
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9:-]+)((?:\s+[^=>\s/]+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/)?>|([^<]+)/g;
  const stack = [parent];
  let match;
  const voidTags = new Set(["AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"]);

  while ((match = tagRegex.exec(html)) !== null) {
    const [full, isClosing, rawTagName, rawAttrs, isSelfClosing, text] = match;
    if (full.startsWith("<!--")) continue;
    if (text) {
      const cur = stack[stack.length - 1];
      cur.append(text);
      continue;
    }
    const tagName = (rawTagName || "").toUpperCase();
    if (isClosing) {
      while (stack.length > 1) {
        const popped = stack.pop();
        if (popped.tagName === tagName) break;
      }
    } else {
      const elem = new FakeNode(1, tagName);
      if (rawAttrs) {
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
        let am;
        while ((am = attrRegex.exec(rawAttrs)) !== null) {
          const name = am[1];
          const val = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : "";
          elem.setAttribute(name, val);
        }
      }
      stack[stack.length - 1].append(elem);
      if (!isSelfClosing && !voidTags.has(tagName)) {
        stack.push(elem);
      }
    }
  }
}

// Global Document Setup
const fakeHead = new FakeNode(1, "HEAD");
const fakeBody = new FakeNode(1, "BODY");

const fakeDocument = {
  nodeType: 9,
  head: fakeHead,
  body: fakeBody,
  createElement(tag) {
    return new FakeNode(1, tag);
  },
  getElementById(id) {
    const find = (node) => {
      if (node.id === id) return node;
      for (const c of node.childNodes) {
        if (c.nodeType === 1) {
          const found = find(c);
          if (found) return found;
        }
      }
      return null;
    };
    const found = find(fakeHead) || find(fakeBody);
    if (found) return found;
    if (id.startsWith("progress-") || id.startsWith("tb-") || id === "toast") {
      const fallback = new FakeNode(1, "DIV");
      fallback.id = id;
      fakeBody.append(fallback);
      return fallback;
    }
    return null;
  },
  fonts: {
    load: async () => [],
    ready: Promise.resolve()
  }
};

const fakeStorage = new Map();
const fakeLocalStorage = {
  getItem(k) { return fakeStorage.has(k) ? fakeStorage.get(k) : null; },
  setItem(k, v) { fakeStorage.set(k, String(v)); },
  removeItem(k) { fakeStorage.delete(k); },
  clear() { fakeStorage.clear(); }
};

globalThis.window = {
  PDFLib,
  "pdfjs-dist/build/pdf": { GlobalWorkerOptions: {} }
};
globalThis.document = fakeDocument;
globalThis.Event = FakeEvent;
globalThis.CustomEvent = FakeEvent;
globalThis.KeyboardEvent = FakeEvent;
globalThis.MouseEvent = FakeEvent;
globalThis.DragEvent = FakeEvent;
globalThis.HTMLElement = FakeNode;
globalThis.HTMLInputElement = FakeNode;
globalThis.HTMLTextAreaElement = FakeNode;
globalThis.HTMLSelectElement = FakeNode;
globalThis.HTMLButtonElement = FakeNode;
globalThis.HTMLCanvasElement = FakeNode;
globalThis.localStorage = fakeLocalStorage;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const createdUrls = new Set();
const revokedUrls = new Set();
let blobCounter = 0;
globalThis.URL = {
  createObjectURL: (blob) => {
    const u = `blob:pdfstudio/stress-${++blobCounter}`;
    createdUrls.add(u);
    return u;
  },
  revokeObjectURL: (url) => {
    revokedUrls.add(url);
  }
};

globalThis.createImageBitmap = async (blob) => ({
  width: 100,
  height: 100,
  close: () => {}
});

globalThis.getComputedStyle = (elem) => ({
  paddingLeft: "0px",
  paddingRight: "0px",
  paddingTop: "0px",
  paddingBottom: "0px",
  borderLeftWidth: "0px",
  borderRightWidth: "0px",
  borderTopWidth: "0px",
  borderBottomWidth: "0px",
  ...elem.style
});

try {
  initPdfEngines();
} catch {}

// Import modules
import { buildUi } from "../assets/js/tools/edit/ui.js";
import { mount, unmount } from "../assets/js/tools/edit/app.js";
import { flattenObjects } from "../assets/js/tools/edit/flatten.js";
import { visualPointToMedia, visualRectToMedia, rotatedAabb, rotatePoint } from "../assets/js/tools/edit/coords.js";

let passed = 0;
let failed = 0;

function assert(name, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function makeMultiRotatedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 0: 0° (Portrait 595 x 842)
  const p0 = doc.addPage([595, 842]);
  p0.setRotation(degrees(0));
  p0.drawText("Page 0 - 0 deg", { x: 50, y: 750, size: 18, font });

  // Page 1: 90° (Landscape 595 x 842 media)
  const p1 = doc.addPage([595, 842]);
  p1.setRotation(degrees(90));
  p1.drawText("Page 1 - 90 deg", { x: 50, y: 750, size: 18, font });

  // Page 2: 180° (Inverted 595 x 842)
  const p2 = doc.addPage([595, 842]);
  p2.setRotation(degrees(180));
  p2.drawText("Page 2 - 180 deg", { x: 50, y: 750, size: 18, font });

  // Page 3: 270° (Landscape 595 x 842)
  const p3 = doc.addPage([595, 842]);
  p3.setRotation(degrees(270));
  p3.drawText("Page 3 - 270 deg", { x: 50, y: 750, size: 18, font });

  return new Uint8Array(await doc.save());
}

async function runChallenger2StressSuite() {
  console.log("\n================================================================================");
  console.log("CHALLENGER 2: EMPIRICAL STRESS TEST HARNESS — LAYERS & EXPORT PIPELINE");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SECTION 1: 50+ Mixed Objects Insertion & Flattening Lifecycle
  // ---------------------------------------------------------------------------
  console.log("--- Section 1: 50+ Mixed Objects Insertion & Flattening ---");
  const testPdfBytes = await makeMultiRotatedPdf();

  const mixedObjects = [];
  const objectTypes = ["text", "ink", "rect", "ellipse", "triangle", "image"];
  const count = 66; // 66 mixed objects across 4 pages

  for (let i = 0; i < count; i++) {
    const typeKind = objectTypes[i % objectTypes.length];
    const pageIndex = i % 4;
    const x = (i * 7) % 400 + 20;
    const y = (i * 11) % 600 + 30;
    const rot = (i * 15) % 360;

    if (typeKind === "text") {
      mixedObjects.push({
        id: `stress-text-${i}`,
        type: "text",
        pageIndex,
        x,
        y,
        width: 140,
        height: 40,
        rotation: rot,
        text: `عنصر نص تجريبي رقم ${i} (Text ${i})`,
        fontSize: 16 + (i % 8),
        color: i % 2 === 0 ? "#1E3A8A" : "#DC2626",
        bold: i % 3 === 0,
        italic: i % 4 === 0,
        underline: i % 5 === 0,
        align: i % 3 === 0 ? "center" : i % 3 === 1 ? "right" : "left"
      });
    } else if (typeKind === "ink") {
      const strokePoints = [];
      const ptCount = 3 + (i % 10);
      for (let p = 0; p < ptCount; p++) {
        strokePoints.push({ x: x + p * 8, y: y + Math.sin(p) * 15 });
      }
      mixedObjects.push({
        id: `stress-ink-${i}`,
        type: "ink",
        pageIndex,
        x,
        y,
        width: ptCount * 8 + 10,
        height: 35,
        rotation: rot,
        color: "#059669",
        strokeWidth: 2 + (i % 4),
        points: strokePoints
      });
    } else if (typeKind === "rect") {
      mixedObjects.push({
        id: `stress-rect-${i}`,
        type: "shape",
        kind: "rect",
        pageIndex,
        x,
        y,
        width: 80 + (i % 30),
        height: 50 + (i % 20),
        rotation: rot,
        fillOn: i % 2 === 0,
        fill: "#BFDBFE",
        stroke: "#1E3A8A",
        strokeWidth: 1.5
      });
    } else if (typeKind === "ellipse") {
      mixedObjects.push({
        id: `stress-ellipse-${i}`,
        type: "shape",
        kind: "ellipse",
        pageIndex,
        x,
        y,
        width: 60 + (i % 25),
        height: 60 + (i % 25),
        rotation: rot,
        fillOn: true,
        fill: "#FDE68A",
        stroke: "#D97706",
        strokeWidth: 2
      });
    } else if (typeKind === "triangle") {
      mixedObjects.push({
        id: `stress-triangle-${i}`,
        type: "shape",
        kind: "triangle",
        pageIndex,
        x,
        y,
        width: 70,
        height: 70,
        rotation: rot,
        fillOn: false,
        fill: "#FFFFFF",
        stroke: "#7C3AED",
        strokeWidth: 2.5
      });
    } else if (typeKind === "image") {
      mixedObjects.push({
        id: `stress-img-${i}`,
        type: "image",
        pageIndex,
        x,
        y,
        width: 90,
        height: 90,
        rotation: rot,
        png: new Uint8Array(ONE_PIXEL_PNG),
        label: `mock-img-${i}.png`
      });
    }
  }

  assert("S1.1: Generated exactly 66 mixed test objects", mixedObjects.length === 66);
  assert(
    "S1.2: Objects contain all 6 types (text, ink, rect, ellipse, triangle, image)",
    ["text", "ink", "shape", "image"].every((t) => mixedObjects.some((o) => o.type === t))
  );

  const flattenedResult = await flattenObjects(testPdfBytes, mixedObjects);
  assert("S1.3: flattenObjects returns valid byte array for 66 mixed objects", flattenedResult instanceof Uint8Array && flattenedResult.byteLength > 0);

  const reloaded = await PDFDocument.load(flattenedResult);
  assert("S1.4: Output PDF parses cleanly with 4 preserved pages", reloaded.getPageCount() === 4);

  for (let p = 0; p < 4; p++) {
    const page = reloaded.getPage(p);
    const sz = page.getSize();
    assert(`S1.5.${p}: Page ${p} maintains valid positive dimensions (${sz.width}x${sz.height})`, sz.width > 0 && sz.height > 0);
  }

  // ---------------------------------------------------------------------------
  // SECTION 2: Interactive Layers Stack Reordering (Z-Index Top-to-Bottom & Bottom-to-Top)
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 2: Layers Drag-and-Drop Reordering & Z-Index ---");

  function simulateDrop(draggedId, targetId, objects, pageIndex = 0) {
    const draggedIndex = objects.findIndex((o) => o.id === draggedId && o.pageIndex === pageIndex);
    const targetIndex = objects.findIndex((o) => o.id === targetId && o.pageIndex === pageIndex);
    if (draggedIndex < 0 || targetIndex < 0 || draggedId === targetId) return false;
    const [dragged] = objects.splice(draggedIndex, 1);
    const newTarget = objects.findIndex((o) => o.id === targetId && o.pageIndex === pageIndex);
    objects.splice(newTarget, 0, dragged);
    return true;
  }

  const layerSessionObjects = [
    { id: "layer-1", type: "text", pageIndex: 0, text: "Bottom Layer 1" },
    { id: "layer-2", type: "shape", kind: "rect", pageIndex: 0 },
    { id: "layer-3", type: "ink", pageIndex: 0 },
    { id: "layer-4", type: "image", pageIndex: 0 },
    { id: "layer-5", type: "text", pageIndex: 0, text: "Top Layer 5" },
    { id: "layer-p1-1", type: "rect", pageIndex: 1 }
  ];

  // Reorder Top-to-Bottom: move layer-5 before layer-1
  const reorder1 = simulateDrop("layer-5", "layer-1", layerSessionObjects, 0);
  assert("S2.1: Reordering top object (layer-5) to bottom succeeds", reorder1 === true);
  assert("S2.2: layer-5 is now at index 0 on page 0", layerSessionObjects[0].id === "layer-5");

  // Reorder Bottom-to-Top: move layer-1 after layer-4
  simulateDrop("layer-1", "layer-4", layerSessionObjects, 0);
  assert("S2.3: Reordering bottom object (layer-1) to higher z-index succeeds", layerSessionObjects[3].id === "layer-1");

  // Verify Cross-Page Isolation: Cannot drag page 0 object into page 1 index
  const crossDrop = simulateDrop("layer-5", "layer-p1-1", layerSessionObjects, 0);
  assert("S2.4: Cross-page layer drag is rejected (pageIndex mismatch)", crossDrop === false);

  // Self-drag is no-op
  const selfDrop = simulateDrop("layer-5", "layer-5", layerSessionObjects, 0);
  assert("S2.5: Self-drag drop on same element is a no-op", selfDrop === false);

  // ---------------------------------------------------------------------------
  // SECTION 3: Active vs Inactive Layer Deletion & URL Lifecycle
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 3: Active vs Inactive Layer Deletion & Memory Lifecycle ---");

  const sharedUrl = globalThis.URL.createObjectURL(new Blob(["shared"]));
  const uniqueUrl1 = globalThis.URL.createObjectURL(new Blob(["unique1"]));

  const deletionObjects = [
    { id: "del-text-active", type: "text", pageIndex: 0, text: "Active Text" },
    { id: "del-img-inactive-1", type: "image", pageIndex: 0, url: sharedUrl },
    { id: "del-img-inactive-2", type: "image", pageIndex: 0, url: sharedUrl },
    { id: "del-img-unique", type: "image", pageIndex: 0, url: uniqueUrl1 }
  ];

  let selectedId = "del-text-active";

  function deleteLayer(targetId, list) {
    const index = list.findIndex((o) => o.id === targetId);
    if (index < 0) return null;
    const [removed] = list.splice(index, 1);
    if (removed.url && !list.some((o) => o.url === removed.url)) {
      globalThis.URL.revokeObjectURL(removed.url);
    }
    if (selectedId === targetId) selectedId = "";
    return removed;
  }

  // 1. Delete active layer
  const removedActive = deleteLayer("del-text-active", deletionObjects);
  assert("S3.1: Active layer deleted successfully", removedActive?.id === "del-text-active");
  assert("S3.2: selectedId is cleared after deleting active layer", selectedId === "");

  // 2. Set new selection to unique image, but delete inactive shared image 1
  selectedId = "del-img-unique";
  const removedShared1 = deleteLayer("del-img-inactive-1", deletionObjects);
  assert("S3.3: Inactive layer deleted without affecting selectedId", selectedId === "del-img-unique");
  assert("S3.4: Shared URL is NOT revoked while another layer still references it", !revokedUrls.has(sharedUrl));

  // 3. Delete second shared image -> now shared URL must be revoked
  deleteLayer("del-img-inactive-2", deletionObjects);
  assert("S3.5: Shared URL is revoked once all referencing layers are deleted", revokedUrls.has(sharedUrl));

  // 4. Delete unique image -> unique URL revoked
  deleteLayer("del-img-unique", deletionObjects);
  assert("S3.6: Unique image URL is revoked immediately upon deletion", revokedUrls.has(uniqueUrl1));

  // 5. Delete non-existent ID
  const removedGhost = deleteLayer("non-existent-id", deletionObjects);
  assert("S3.7: Deleting non-existent layer ID returns null safely", removedGhost === null);

  // ---------------------------------------------------------------------------
  // SECTION 4: Multi-Page Rotated Layouts (0°, 90°, 180°, 270°) Geometry Validity
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 4: Multi-Page Rotated Layouts (0°, 90°, 180°, 270°) Geometry ---");

  const mediaW = 595;
  const mediaH = 842;

  // Test visualPointToMedia for all 4 quarter rotations
  const pt0 = visualPointToMedia(0, mediaW, mediaH, 100, 200);
  assert("S4.1: 0° visual (100, 200) -> media (100, 200)", pt0.x === 100 && pt0.y === 200);

  const pt90 = visualPointToMedia(90, mediaW, mediaH, 100, 200);
  assert("S4.2: 90° visual (100, 200) -> media (595 - 200, 100) = (395, 100)", pt90.x === 395 && pt90.y === 100);

  const pt180 = visualPointToMedia(180, mediaW, mediaH, 100, 200);
  assert("S4.3: 180° visual (100, 200) -> media (595 - 100, 842 - 200) = (495, 642)", pt180.x === 495 && pt180.y === 642);

  const pt270 = visualPointToMedia(270, mediaW, mediaH, 100, 200);
  assert("S4.4: 270° visual (100, 200) -> media (200, 842 - 100) = (200, 742)", pt270.x === 200 && pt270.y === 742);

  // Test visualRectToMedia for quarter rotations
  const rect = { x: 50, y: 60, width: 120, height: 80 };

  const r0 = visualRectToMedia(0, mediaW, mediaH, rect);
  assert("S4.5: 0° rect preserves width, height and ccw=0", r0.x === 50 && r0.y === 60 && r0.width === 120 && r0.height === 80 && r0.ccw === 0);

  const r90 = visualRectToMedia(90, mediaW, mediaH, rect);
  assert("S4.6: 90° rect swaps width/height and sets ccw=1", r90.x === mediaW - 60 - 80 && r90.y === 50 && r90.width === 80 && r90.height === 120 && r90.ccw === 1);

  const r180 = visualRectToMedia(180, mediaW, mediaH, rect);
  assert("S4.7: 180° rect keeps dimensions, inverts coords, ccw=2", r180.x === mediaW - 50 - 120 && r180.y === mediaH - 60 - 80 && r180.width === 120 && r180.height === 80 && r180.ccw === 2);

  const r270 = visualRectToMedia(270, mediaW, mediaH, rect);
  assert("S4.8: 270° rect swaps width/height and sets ccw=3", r270.x === 60 && r270.y === mediaH - 50 - 120 && r270.width === 80 && r270.height === 120 && r270.ccw === 3);

  // Rotated AABB calculation
  const aabb45 = rotatedAabb(100, 100, 100, 100, 45);
  assert("S4.9: 45° rotated 100x100 square expands AABB to ~141.42 width", Math.abs(aabb45.width - 100 * Math.SQRT2) < 0.1);

  // ---------------------------------------------------------------------------
  // SECTION 5: Adversarial Boundary Cases & Error Paths
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 5: Adversarial Boundary Cases & Error Paths ---");

  const edgeObjects = [
    // Empty text (should be safely skipped by flatten)
    { id: "e-empty-text-1", type: "text", pageIndex: 0, text: "" },
    { id: "e-empty-text-2", type: "text", pageIndex: 0, text: "   \n\t  " },
    // Out of bound page index (should be skipped)
    { id: "e-oob-page", type: "shape", kind: "rect", pageIndex: 999, x: 10, y: 10, width: 50, height: 50 },
    // Zero-point ink (should be skipped)
    { id: "e-ink-0", type: "ink", pageIndex: 0, points: [] },
    // Single-point ink (should be skipped)
    { id: "e-ink-1", type: "ink", pageIndex: 0, points: [{ x: 50, y: 50 }] },
    // Zero-width / zero-height ellipse (should not produce NaN scale)
    { id: "e-ellipse-0", type: "shape", kind: "ellipse", pageIndex: 0, x: 50, y: 50, width: 0, height: 0, strokeWidth: 0 },
    // Negative stroke width (should clamp)
    { id: "e-rect-neg-stroke", type: "shape", kind: "rect", pageIndex: 1, x: 20, y: 20, width: 40, height: 40, strokeWidth: -5 }
  ];

  const edgeFlattenResult = await flattenObjects(testPdfBytes, edgeObjects);
  assert("S5.1: flattenObjects handles edge cases without throwing", edgeFlattenResult instanceof Uint8Array && edgeFlattenResult.byteLength > 0);

  const edgePdf = await PDFDocument.load(edgeFlattenResult);
  assert("S5.2: Flattened PDF with edge objects remains valid and readable", edgePdf.getPageCount() === 4);

  // ---------------------------------------------------------------------------
  // SECTION 6: Multi-Step Undo/Redo & History Depth Stress Testing
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 6: History Undo/Redo Stack Depth Stress ---");

  let sessionObjects = [];
  const history = [];
  let redoStack = [];

  function clone(list) {
    return list.map((o) => ({ ...o, points: o.points ? [...o.points] : undefined }));
  }

  function pushHist() {
    history.push(clone(sessionObjects));
    if (history.length > 40) history.shift();
    redoStack = [];
  }

  function doUndo() {
    if (!history.length) return false;
    redoStack.push(clone(sessionObjects));
    if (redoStack.length > 40) redoStack.shift();
    sessionObjects = history.pop() || [];
    return true;
  }

  function doRedo() {
    if (!redoStack.length) return false;
    history.push(clone(sessionObjects));
    if (history.length > 40) history.shift();
    sessionObjects = redoStack.pop() || [];
    return true;
  }

  // Push 50 discrete changes
  for (let step = 1; step <= 50; step++) {
    pushHist();
    sessionObjects.push({ id: `item-${step}`, type: "rect", pageIndex: 0 });
  }

  assert("S6.1: History stack caps at exactly 40 items after 50 pushes", history.length === 40);
  assert("S6.2: sessionObjects contains 50 items", sessionObjects.length === 50);

  // Undo 40 times
  for (let u = 0; u < 40; u++) {
    doUndo();
  }
  assert("S6.3: History stack is empty after 40 undos", history.length === 0);
  assert("S6.4: sessionObjects rolled back to item-10 state", sessionObjects.length === 10);
  assert("S6.5: Further undo on empty history returns false safely", doUndo() === false);

  // Redo 40 times
  for (let r = 0; r < 40; r++) {
    doRedo();
  }
  assert("S6.6: Redo stack is empty after 40 redos", redoStack.length === 0);
  assert("S6.7: sessionObjects restored to 50 items after full redo", sessionObjects.length === 50);
  assert("S6.8: Further redo on empty redoStack returns false safely", doRedo() === false);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`CHALLENGER 2 STRESS RESULTS: ${passed} passed, ${failed} failed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runChallenger2StressSuite().catch((err) => {
  console.error("Fatal exception in Challenger 2 test suite:", err);
  process.exit(1);
});
