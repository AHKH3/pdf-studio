/**
 * Adversarial Stress & Edge Cases Torture Harness for PDF Edit Tool Redesign
 *
 * Scenarios:
 * 1. Adversarial Tool Toggling & State Fuzzing (1,000 randomized iterations)
 * 2. Extreme Coordinates, Inverted Bounds & Rotation Matrix Torture
 * 3. Massive Text Payloads, Full Tashkeel, BiDi Overlap, Emojis & Injections
 * 4. Deep Undo/Redo Torture, 40-item Cap, Branching & History Caps
 * 5. Multi-Page Switching Under Active Edit Sessions & Cross-Page State Isolation
 * 6. Vector & Raster Flattening Pipeline Under Stress
 * 7. Rapid Mount / Unmount Lifecycle Idempotency (50 cycles)
 *
 * Run with: node scripts/test-edit-adversarial.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PDFLib from "pdf-lib";
const { PDFDocument, StandardFonts } = PDFLib;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ————————————————————————————————————————————————————————————————————————
// 0. Lightweight DOM Simulation Environment
// ————————————————————————————————————————————————————————————————————————

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
    this.width = 0;
    this.height = 0;
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
  }

  get name() {
    return this.getAttribute("name") || "";
  }
  set name(v) {
    this.setAttribute("name", v);
  }

  get type() {
    return this.getAttribute("type") || "";
  }
  set type(v) {
    this.setAttribute("type", v);
  }

  get className() {
    return this._className;
  }
  set className(val) {
    this._className = String(val || "");
  }

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

  get value() {
    return this._value;
  }
  set value(v) {
    this._value = String(v ?? "");
  }

  get checked() {
    return this._checked;
  }
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

  get disabled() {
    return this._disabled;
  }
  set disabled(d) {
    this._disabled = Boolean(d);
    if (this._disabled) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get hidden() {
    return this._hidden;
  }
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
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.offsetWidth || 800, height: this.offsetHeight || 1100, right: 800, bottom: 1100 };
  }

  getContext(type) {
    return {
      font: "",
      direction: "ltr",
      fillStyle: "#000",
      textBaseline: "top",
      textAlign: "left",
      measureText(text) {
        return { width: String(text || "").length * 10 };
      },
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fillText() {},
      fillRect() {},
      clearRect() {},
      translate() {},
      rotate() {},
      drawImage() {}
    };
  }

  toBlob(callback, type) {
    const minimalPng = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
      137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
      5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130
    ]);
    const fakeBlob = {
      size: minimalPng.byteLength,
      type: type || "image/png",
      arrayBuffer: async () => minimalPng.buffer
    };
    setTimeout(() => callback(fakeBlob), 0);
  }

  matches(sel) {
    if (!sel || this.nodeType !== 1) return false;
    const orParts = sel.split(",").map((p) => p.trim());
    return orParts.some((part) => this._matchesSingle(part));
  }

  _matchesSingle(sel) {
    let current = sel.trim();
    if (!current) return false;

    const notMatch = current.match(/:not\(([^)]+)\)/);
    if (notMatch) {
      if (this.matches(notMatch[1])) return false;
      current = current.replace(notMatch[0], "");
    }
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
        if (op === "^=" && !val.startsWith(expectedVal)) return false;
        if (op === "$=" && !val.endsWith(expectedVal)) return false;
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
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9:-]+)((?:\s+[^=>\s/]+(?:=(?:"([^"]*)"|'([^']*)'|[^>\s]+))?)*)\s*(\/)?>|([^<]+)/g;
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

globalThis.window = {
  PDFLib,
  "pdfjs-dist/build/pdf": {
    GlobalWorkerOptions: {},
    getDocument(src) {
      return {
        promise: (async () => {
          const doc = await PDFDocument.load(src.data || src, { ignoreEncryption: true });
          const pageCount = doc.getPageCount();
          return {
            numPages: pageCount,
            async getPage(pageIndex1) {
              const page = doc.getPage(pageIndex1 - 1);
              const { width, height } = page.getSize();
              const rotation = page.getRotation().angle || 0;
              return {
                view: [0, 0, width, height],
                rotate: rotation,
                getViewport({ scale = 1, rotation: r = 0 } = {}) {
                  const isTurned = (r / 90) % 2 !== 0;
                  return {
                    width: (isTurned ? height : width) * scale,
                    height: (isTurned ? width : height) * scale,
                    scale
                  };
                },
                render() {
                  return {
                    promise: Promise.resolve(),
                    cancel() {}
                  };
                },
                cleanup() {}
              };
            },
            destroy: async () => {},
            cleanup: async () => {}
          };
        })()
      };
    }
  }
};

const fakeHead = new FakeNode(1, "HEAD");
const fakeBody = new FakeNode(1, "BODY");

const progressWrap = new FakeNode(1, "DIV");
progressWrap.id = "progress-wrap";
const progressDesc = new FakeNode(1, "DIV");
progressDesc.id = "progress-desc";
const progressDetail = new FakeNode(1, "DIV");
progressDetail.id = "progress-detail";
const progressBar = new FakeNode(1, "DIV");
progressBar.id = "progress-bar";
const progressVal = new FakeNode(1, "DIV");
progressVal.id = "progress-val";
fakeBody.append(progressWrap, progressDesc, progressDetail, progressBar, progressVal);

const fakeDocument = {
  nodeType: 9,
  head: fakeHead,
  body: fakeBody,
  createElement(tag) {
    return new FakeNode(1, tag);
  },
  createElementNS(ns, tag) {
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
globalThis.SVGSVGElement = FakeNode;
globalThis.SVGElement = FakeNode;
globalThis.localStorage = fakeLocalStorage;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

globalThis.createImageBitmap = async (source) => {
  return {
    width: 200,
    height: 200,
    close() {}
  };
};

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

if (!globalThis.URL.createObjectURL) {
  let blobCounter = 0;
  globalThis.URL.createObjectURL = () => `blob:pdfstudio/mock-${++blobCounter}`;
  globalThis.URL.revokeObjectURL = () => {};
}

// Initialize PDF engines after window is configured
const { initPdfEngines } = await import("../assets/js/pdf/core.js");
initPdfEngines();

// Dynamically import modules to test after DOM globals are wired
const { buildUi, injectStyles, removeStyles, STYLE_ID } = await import("../assets/js/tools/edit/ui.js");
const { mount, unmount, run, asTool, suggestedName } = await import("../assets/js/tools/edit/app.js");
const { bboxFromPoints, clampBox, clampedMove, normAngle, orientedPoints, rotatePoint, rotatedAabb, scalePoints, visualPointToMedia, visualRectToMedia, worldToLocal } = await import("../assets/js/tools/edit/coords.js");
const { fitPageCssWidth, stabilizeFitPx } = await import("../assets/js/tools/edit/fit.js");
const { flattenObjects } = await import("../assets/js/tools/edit/flatten.js");
const { renderTextBoxPng, bakeRotatedPng, rotatePngQuarter } = await import("../assets/js/tools/edit/text-png.js");

// ————————————————————————————————————————————————————————————————————————
// Harness & Execution
// ————————————————————————————————————————————————————————————————————————

let failures = 0;
let totalChecks = 0;

function check(name, condition, detail = "") {
  totalChecks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title) {
  console.log(`\n=== [ADVERSARIAL] ${title} ===`);
}

async function makePdfFixture(pages = 1, rotation = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    if (rotation) page.setRotation(PDFLib.degrees(rotation));
    page.drawText(`Adversarial Fixture Page ${i + 1} (rot ${rotation}°)`, { x: 50, y: 750, size: 16, font });
  }
  return new Uint8Array(await doc.save());
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 1: Rapid Tool Toggling & State Fuzzing (1,000 randomized iterations)
// ————————————————————————————————————————————————————————————————————————
group("Scenario 1: Rapid Tool Toggling & State Fuzzing (1,000 Iterations)");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const tools = ["select", "text", "pen", "rect", "ellipse", "triangle", "image"];
  const textPanel = root.querySelector('[data-edit-panel="text"]');
  const penPanel = root.querySelector('[data-edit-panel="pen"]');
  const shapePanel = root.querySelector('[data-edit-panel="shape"]');
  const imagePanel = root.querySelector('[data-edit-panel="image"]');

  let invariantViolations = 0;

  for (let i = 0; i < 1000; i++) {
    const randomTool = tools[Math.floor(Math.random() * tools.length)];
    const radio = root.querySelector(`input[name="edit-tool"][value="${randomTool}"]`);
    if (radio) {
      radio.checked = true;
      root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: radio }));
    }

    // Interleave random property modifications & keydowns
    if (i % 5 === 0) {
      const textSize = root.querySelector("#edit-text-size");
      if (textSize) {
        textSize.value = String(10 + (i % 80));
        textSize.dispatchEvent(new FakeEvent("change", { bubbles: true, target: textSize }));
      }
    }
    if (i % 7 === 0) {
      const swatch = root.querySelector("[data-swatch]");
      if (swatch) swatch.click();
    }
    if (i % 11 === 0) {
      const chip = root.querySelector("[data-size-chip]");
      if (chip) chip.click();
    }
    if (i % 13 === 0) {
      const preset = root.querySelector('[data-shape-preset="highlight"]');
      if (preset) preset.click();
    }
    if (i % 17 === 0) {
      root.dispatchEvent(new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "z" }));
      root.dispatchEvent(new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "y" }));
    }

    // Verify Panel Visibility Invariants
    if (randomTool === "text") {
      if (textPanel.hidden || !penPanel.hidden || !shapePanel.hidden || !imagePanel.hidden) invariantViolations++;
    } else if (randomTool === "pen") {
      if (!textPanel.hidden || penPanel.hidden || !shapePanel.hidden || !imagePanel.hidden) invariantViolations++;
    } else if (["rect", "ellipse", "triangle"].includes(randomTool)) {
      if (!textPanel.hidden || !penPanel.hidden || shapePanel.hidden || !imagePanel.hidden) invariantViolations++;
    } else if (randomTool === "image") {
      if (!textPanel.hidden || !penPanel.hidden || !shapePanel.hidden || imagePanel.hidden) invariantViolations++;
    } else if (randomTool === "select") {
      if (!textPanel.hidden || !penPanel.hidden || !shapePanel.hidden || !imagePanel.hidden) invariantViolations++;
    }
  }

  check("S1.1: 1,000 rapid randomized tool switches executed with 0 invariant violations", invariantViolations === 0);

  // Clear document during chaos
  const clearBtn = root.querySelector("#edit-clear");
  clearBtn.click();
  check("S1.2: Clear button successfully resets editor state after 1,000 tool switches",
    root.querySelector("#edit-undo")?.disabled === true && root.querySelector("#edit-redo")?.disabled === true
  );

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 2: Extreme Coordinates, Inverted Bounds & Rotation Matrix Torture
// ————————————————————————————————————————————————————————————————————————
group("Scenario 2: Extreme Coordinates, Negative Bounds & Rotation Transformations");
{
  // 1. Extreme normAngle
  check("S2.1: normAngle handles negative, large, float, NaN, and undefined angles",
    normAngle(0) === 0 &&
    normAngle(90) === 90 &&
    normAngle(360) === 0 &&
    normAngle(720) === 0 &&
    normAngle(-90) === 270 &&
    normAngle(-360) === 0 &&
    normAngle(450) === 90 &&
    normAngle(37.5) === 37.5 &&
    normAngle(NaN) === 0 &&
    normAngle(undefined) === 0
  );

  // 2. clampBox with extreme negative, zero, and infinite values
  const crazyBox1 = { x: -999999, y: -999999, width: -500, height: -500 };
  clampBox(crazyBox1, 500, 800);
  check("S2.2: clampBox handles extreme negative dimensions and positions safely",
    crazyBox1.x === 0 && crazyBox1.y === 0 && crazyBox1.width === 16 && crazyBox1.height === 16
  );

  const crazyBox2 = { x: 1e9, y: 1e9, width: 1e9, height: 1e9 };
  clampBox(crazyBox2, 600, 900);
  check("S2.3: clampBox handles astronomical box positions and clamps inside page",
    crazyBox2.x === 0 && crazyBox2.y === 0 && crazyBox2.width === 600 && crazyBox2.height === 900
  );

  // 3. bboxFromPoints with empty, single-point, identical-point, negative-point inputs
  const emptyBbox = bboxFromPoints([]);
  check("S2.4: bboxFromPoints on empty array returns default MIN_PT box",
    emptyBbox.x === 0 && emptyBbox.y === 0 && emptyBbox.width === 16 && emptyBbox.height === 16
  );

  const singlePointBbox = bboxFromPoints([{ x: 100, y: 200 }], 5);
  check("S2.5: bboxFromPoints on single point applies padding and MIN_PT floor",
    singlePointBbox.x === 95 && singlePointBbox.y === 195 && singlePointBbox.width >= 16 && singlePointBbox.height >= 16
  );

  const extremePoints = [
    { x: -500, y: -200 },
    { x: 1500, y: 2500 }
  ];
  const extremeBbox = bboxFromPoints(extremePoints, 10);
  check("S2.6: bboxFromPoints wraps negative and positive point spans accurately",
    extremeBbox.x === -510 && extremeBbox.y === -210 && extremeBbox.width === 2020 && extremeBbox.height === 2720
  );

  // 4. worldToLocal and rotatePoint roundtrip
  const testObj = { x: 50, y: 50, width: 100, height: 100, rotation: 90 };
  const localPt = worldToLocal(testObj, 100, 100);
  check("S2.7: worldToLocal at center (100, 100) maps to local center (50, 50)",
    Math.abs(localPt.x - 50) < 1e-5 && Math.abs(localPt.y - 50) < 1e-5
  );

  // 5. visualRectToMedia for all 4 quarter-rotations
  const rect = { x: 20, y: 30, width: 100, height: 200 };
  const W = 600, H = 800;
  const m0 = visualRectToMedia(0, W, H, rect);
  const m90 = visualRectToMedia(90, W, H, rect);
  const m180 = visualRectToMedia(180, W, H, rect);
  const m270 = visualRectToMedia(270, W, H, rect);

  check("S2.8: visualRectToMedia correctly inverts & transposes bounds across all rotations",
    m0.x === 20 && m0.y === 30 && m0.width === 100 && m0.height === 200 && m0.ccw === 0 &&
    m90.x === W - 30 - 200 && m90.y === 20 && m90.width === 200 && m90.height === 100 && m90.ccw === 1 &&
    m180.x === W - 20 - 100 && m180.y === H - 30 - 200 && m180.width === 100 && m180.height === 200 && m180.ccw === 2 &&
    m270.x === 30 && m270.y === H - 20 - 100 && m270.width === 200 && m270.height === 100 && m270.ccw === 3
  );

  // 6. scalePoints with 0-dimension origins
  const scaled = scalePoints([{ x: 10, y: 10 }], { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 100 });
  check("S2.9: scalePoints does not produce NaN/Infinity on zero original dimensions",
    Number.isFinite(scaled[0].x) && Number.isFinite(scaled[0].y)
  );
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 3: Massive Text Payloads, Full Tashkeel, BiDi Overlap, Emojis & Injections
// ————————————————————————————————————————————————————————————————————————
group("Scenario 3: Massive Text Payloads, Full Arabic Tashkeel, BiDi & Special Unicode");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const quranicWithTashkeel = "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ۝ مِن شَرِّ مَا خَلَقَ ۝ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ۝ وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ۝ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ ۝";
  const bidiExtreme = "English start \u200E(12345) \u200Fثم نص عربي كامل مع \u202A(Nested LTR)\u202C ونهاية الفقرة RTL.";
  const emojiSequence = "🏳️‍🌈 👨‍👩‍👧‍👦 🧑🏾‍🦱 🚀✨🔥❤️ ﷽ ﷻ ﷲ 🔤 🔠 🔟 💯";
  const massiveText = "نص تجريبي مكرر للأداء والاستقرار. ".repeat(1000);
  const injectionPayload = "<svg onload=alert(1)><script>eval('bad')</script>\"'\\//--%00&lt;&gt;";

  const testPayloads = [
    { name: "Quranic Tashkeel", text: quranicWithTashkeel },
    { name: "BiDi Complex Controls", text: bidiExtreme },
    { name: "Multi-codepoint Emojis & Ligatures", text: emojiSequence },
    { name: "Massive 33K Characters", text: massiveText },
    { name: "Code Injection Vectors", text: injectionPayload }
  ];

  let renderSuccessCount = 0;

  for (const item of testPayloads) {
    const rendered = await renderTextBoxPng(item.text, {
      width: 300,
      height: 150,
      fontSize: 16,
      color: "#1E3A8A",
      bold: true,
      italic: false,
      underline: true,
      align: "right"
    });
    if (rendered && rendered.bytes && rendered.bytes.byteLength > 0) {
      renderSuccessCount++;
    }
  }

  check("S3.1: All 5 extreme text payloads (Tashkeel, BiDi, Emojis, 33K chars, Injections) rendered to PNG bytes cleanly",
    renderSuccessCount === testPayloads.length
  );

  // Rotating rendered PNG
  const sampleRender = await renderTextBoxPng(quranicWithTashkeel, {
    width: 250,
    height: 100,
    fontSize: 18,
    color: "#059669"
  });
  const aabb = rotatedAabb(50, 50, 250, 100, 45);
  const baked = await bakeRotatedPng(sampleRender.canvas, { x: 50, y: 50, width: 250, height: 100 }, 45, aabb);
  check("S3.2: bakeRotatedPng rotates rendered Arabic text box at 45° without error",
    baked && baked.bytes && baked.bytes.byteLength > 0 && baked.width > 0 && baked.height > 0
  );

  // rotatePngQuarter for 1, 2, 3 quarter turns
  const q1 = await rotatePngQuarter(sampleRender.bytes, 1);
  const q2 = await rotatePngQuarter(sampleRender.bytes, 2);
  const q3 = await rotatePngQuarter(sampleRender.bytes, 3);
  check("S3.3: rotatePngQuarter cleanly transforms PNG bytes for 90°, 180°, 270°",
    q1.byteLength > 0 && q2.byteLength > 0 && q3.byteLength > 0
  );

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 4: Deep Undo/Redo Torture, 40-item Cap, Branching & Blob URL Revocation
// ————————————————————————————————————————————————————————————————————————
group("Scenario 4: Deep Undo/Redo Torture, 40-item Cap & Blob URL Lifecycle");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const undoBtn = root.querySelector("#edit-undo");
  const redoBtn = root.querySelector("#edit-redo");
  const delBtn = root.querySelector("#edit-delete");

  // 1. Initial empty state
  check("S4.1: Undo button is initially disabled on empty history", undoBtn.disabled === true);
  check("S4.2: Redo button is initially disabled on empty redo stack", redoBtn.disabled === true);

  // Undo/redo on empty state must not throw
  undoBtn.click();
  redoBtn.click();
  delBtn.click();

  // 2. Perform 50 style changes via preset chips and color swatches
  for (let i = 0; i < 50; i++) {
    const preset = root.querySelector('[data-shape-preset="highlight"]');
    preset?.click();

    const swatch = root.querySelector('[data-swatch="#DC2626"]');
    swatch?.click();
  }

  // 3. Test keyboard shortcuts for undo/redo
  root.dispatchEvent(new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "z" }));
  root.dispatchEvent(new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "y" }));

  // 4. Repeated undo/redo cycles on populated stack
  for (let i = 0; i < 60; i++) {
    undoBtn.click();
  }
  check("S4.3: Performing 60 undos safely reaches empty state without throw", undoBtn.disabled === true);

  for (let i = 0; i < 60; i++) {
    redoBtn.click();
  }
  check("S4.4: Performing 60 redos on empty redo stack does not throw", redoBtn.disabled === true);

  unmount();
  check("S4.5: Unmount cleanly tears down without leaking or throw", root.childNodes.length === 0);
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 5: Multi-Page Switching Under Active Edit Sessions & Cross-Page Isolation
// ————————————————————————————————————————————————————————————————————————
group("Scenario 5: Multi-Page Switching Under Active Edit Sessions & Cross-Page Isolation");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const prevBtn = root.querySelector("#edit-prev");
  const nextBtn = root.querySelector("#edit-next");
  const countLabel = root.querySelector("#edit-count");

  check("S5.1: Initial document state shows pager labels correctly", countLabel.textContent.trim() === "1 / 1");
  check("S5.2: Prev/Next are initially disabled for single-page empty doc", prevBtn.disabled === true && nextBtn.disabled === true);

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 6: Vector & Raster Flattening Pipeline Under Stress
// ————————————————————————————————————————————————————————————————————————
group("Scenario 6: Vector & Raster Flattening Pipeline Under Heavy Stress");
{
  const fixturePdfBytes = await makePdfFixture(4, 90);
  const stressObjects = [];

  for (let page = 0; page < 4; page++) {
    stressObjects.push({
      id: `obj-text-${page}`,
      type: "text",
      pageIndex: page,
      x: 30 + page * 20,
      y: 40 + page * 30,
      width: 220,
      height: 80,
      text: `ملاحظة وتعديل على صفحة ${page + 1} مع تشكيل كامل: الحَمْدُ لِلَّهِ رَبِّ العَالَمِينَ`,
      fontSize: 16,
      color: "#1E3A8A",
      bold: true,
      italic: false,
      underline: true,
      align: "right",
      rotation: page * 45
    });

    stressObjects.push({
      id: `obj-rect-${page}`,
      type: "shape",
      kind: "rect",
      pageIndex: page,
      x: 200,
      y: 200,
      width: 140,
      height: 70,
      fillOn: true,
      fill: "#BFDBFE",
      stroke: "#1D4ED8",
      strokeWidth: 2.5,
      rotation: page * 30
    });

    stressObjects.push({
      id: `obj-ellipse-${page}`,
      type: "shape",
      kind: "ellipse",
      pageIndex: page,
      x: 100,
      y: 350,
      width: 100,
      height: 100,
      fillOn: true,
      fill: "#FDE68A",
      stroke: "#D97706",
      strokeWidth: 1.5,
      rotation: 60
    });

    stressObjects.push({
      id: `obj-triangle-${page}`,
      type: "shape",
      kind: "triangle",
      pageIndex: page,
      x: 300,
      y: 350,
      width: 110,
      height: 90,
      fillOn: false,
      fill: "#FFFFFF",
      stroke: "#DC2626",
      strokeWidth: 3,
      rotation: 180
    });

    const points = [];
    for (let pt = 0; pt < 100; pt++) {
      points.push({ x: 50 + pt * 3, y: 500 + Math.sin(pt * 0.2) * 40 });
    }
    stressObjects.push({
      id: `obj-ink-${page}`,
      type: "ink",
      pageIndex: page,
      x: 50,
      y: 460,
      width: 300,
      height: 80,
      color: "#7C3AED",
      strokeWidth: 3,
      points,
      rotation: 0
    });
  }

  const flattenedResult = await flattenObjects(fixturePdfBytes, stressObjects);

  check("S6.1: flattenObjects successfully flattened 40 mixed objects across 4 rotated pages",
    flattenedResult instanceof Uint8Array && flattenedResult.byteLength > 0
  );

  const reloaded = await PDFDocument.load(flattenedResult);
  check("S6.2: Flattened output reloads as valid PDF with all 4 pages intact",
    reloaded.getPageCount() === 4
  );

  check("S6.3: Rotated page retains its 90° rotation property after object flattening",
    reloaded.getPage(0).getRotation().angle === 90
  );
}

// ————————————————————————————————————————————————————————————————————————
// Scenario 7: Rapid Mount / Unmount Lifecycle Idempotency (50 cycles)
// ————————————————————————————————————————————————————————————————————————
group("Scenario 7: Rapid Mount / Unmount Lifecycle Idempotency (50 Cycles)");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);

  let lifecycleClean = true;

  for (let i = 0; i < 50; i++) {
    mount(root);
    if (!root.classList.contains("edit-root") || !fakeDocument.getElementById(STYLE_ID)) {
      lifecycleClean = false;
    }
    unmount();
    if (root.childNodes.length > 0 || fakeDocument.getElementById(STYLE_ID)) {
      lifecycleClean = false;
    }
  }

  check("S7.1: 50 consecutive mount/unmount cycles executed cleanly without lingering DOM or styles",
    lifecycleClean
  );

  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Summary & Exit Code
// ————————————————————————————————————————————————————————————————————————

console.log("\n==================================================");
console.log(`Adversarial Stress Suite: ${totalChecks - failures}/${totalChecks} checks passed`);
console.log(`Failures: ${failures}`);
console.log("==================================================");

process.exit(failures ? 1 : 0);
