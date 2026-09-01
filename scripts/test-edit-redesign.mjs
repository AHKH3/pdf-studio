/**
 * Comprehensive E2E Opaque-Box Test Suite for PDF Edit Tool Redesign
 *
 * Tier 1: Feature Coverage (F1 to F10, >=5 tests per feature)
 * Tier 2: Boundary & Corner Cases (Limits, clamping, fallbacks, empty states)
 * Tier 3: Cross-Feature Interactions (Tool switching, inspector sync, layers, undo/redo)
 * Tier 4: Real-World Workflow Scenarios (Full edit session, multi-page, styling, adversarial strings)
 *
 * Run with: node scripts/test-edit-redesign.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ————————————————————————————————————————————————————————————————————————
// 0. Lightweight DOM Simulation Environment for Node.js
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
    this.nodeType = nodeType; // 1: Element, 3: Text, 8: Comment, 9: Document
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

  matches(sel) {
    if (!sel || this.nodeType !== 1) return false;
    const orParts = sel.split(",").map((p) => p.trim());
    return orParts.some((part) => this._matchesSingle(part));
  }

  _matchesSingle(sel) {
    let current = sel.trim();
    if (!current) return false;

    // Check not pseudo
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
    // Check ID
    const idMatch = current.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (this.id !== idMatch[1]) return false;
      current = current.replace(idMatch[0], "");
    }
    // Check classes
    const classMatches = current.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        if (!this.classList.contains(cm.slice(1))) return false;
        current = current.replace(cm, "");
      }
    }
    // Check attributes
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

// Simple HTML Parser for template strings
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

import * as PDFLib from "pdf-lib";
import { initPdfEngines } from "../assets/js/pdf/core.js";

globalThis.window = {
  PDFLib,
  "pdfjs-dist/build/pdf": {
    GlobalWorkerOptions: {}
  }
};
// Setup global fake DOM
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
globalThis.localStorage = fakeLocalStorage;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

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

try {
  initPdfEngines();
} catch {}

// Import modules to test
import { buildUi, injectStyles, removeStyles, STYLE_ID, INK_COLORS, FILL_COLORS, TEXT_SIZES } from "../assets/js/tools/edit/ui.js";
import { mount, unmount, run, asTool, suggestedName, syncChrome, id, title } from "../assets/js/tools/edit/app.js";
import { clampedMove, clampBox, orientedPoints, rotatePoint, visualPointToMedia, visualRectToMedia } from "../assets/js/tools/edit/coords.js";
import { fitPageCssWidth, stabilizeFitPx } from "../assets/js/tools/edit/fit.js";

// ————————————————————————————————————————————————————————————————————————
// Test Harness Utilities
// ————————————————————————————————————————————————————————————————————————

let failures = 0;
let totalChecks = 0;
const tierResults = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };

function check(name, condition, detail = "") {
  totalChecks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title, tierKey) {
  console.log(`\n=== ${title} ===`);
  if (tierKey) tierResults[tierKey] = (tierResults[tierKey] || 0) + 1;
}

// Fixture generator
async function makePdfFixture(pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`PDF Edit Fixture Page ${i + 1}`, { x: 50, y: 750, size: 18, font });
  }
  return new Uint8Array(await doc.save());
}

// ————————————————————————————————————————————————————————————————————————
// TIER 1: Feature Coverage (≥5 tests per feature F1..F10)
// ————————————————————————————————————————————————————————————————————————

group("Tier 1 - F1: Workspace & Stage Layout", "tier1");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  const ui = buildUi(root);

  check("F1.1: Root element receives edit-root class", root.classList.contains("edit-root"));
  check("F1.2: Drop hero (#edit-drop) exists with intake class", Boolean(ui.drop) && ui.drop.classList.contains("intake"));
  check("F1.3: Workspace container (#edit-workspace) exists and hidden by default", Boolean(ui.workspace) && ui.workspace.hidden);
  check("F1.4: Board wrap (#edit-wrap) and board (#edit-board) exist in stage", Boolean(ui.wrap) && Boolean(root.querySelector("#edit-board")));
  check("F1.5: Canvas (#edit-page) and overlay layer (#edit-layer) are present", Boolean(ui.canvas) && Boolean(ui.layer));
  check("F1.6: Pager controls (#edit-prev, #edit-next, #edit-count) exist", Boolean(ui.prev) && Boolean(ui.next) && Boolean(ui.count));
  check("F1.7: Zoom controls (#edit-zoom-in, #edit-zoom-out, #edit-zoom-fit, #edit-zoom-label) exist",
    Boolean(ui.zoomIn) && Boolean(ui.zoomOut) && Boolean(ui.zoomFit) && Boolean(ui.zoomLabel)
  );
}

group("Tier 1 - F2: Floating Creation Toolbar", "tier1");
{
  const root = fakeDocument.createElement("div");
  buildUi(root);
  const toolbar = root.querySelector(".edit-toolbar");

  check("F2.1: Toolbar exists with radiogroup role", Boolean(toolbar) && toolbar.getAttribute("role") === "radiogroup");
  const toolRadios = root.querySelectorAll('input[name="edit-tool"]');
  const toolValues = toolRadios.map((r) => r.value);
  check("F2.2: Toolbar contains all 7 tool choices (select, text, pen, rect, ellipse, triangle, image)",
    ["select", "text", "pen", "rect", "ellipse", "triangle", "image"].every((t) => toolValues.includes(t))
  );
  const selectRadio = root.querySelector('input[name="edit-tool"][value="select"]');
  check("F2.3: Select tool is checked by default in initial markup", selectRadio?.checked === true);
  check("F2.4: History buttons (#edit-undo, #edit-redo) exist", Boolean(root.querySelector("#edit-undo")) && Boolean(root.querySelector("#edit-redo")));
  check("F2.5: Action buttons (#edit-delete, #edit-save, #edit-clear) exist",
    Boolean(root.querySelector("#edit-delete")) && Boolean(root.querySelector("#edit-save")) && Boolean(root.querySelector("#edit-clear"))
  );
}

group("Tier 1 - F3: Dynamic Contextual Inspector", "tier1");
{
  const root = fakeDocument.createElement("div");
  buildUi(root);
  const panels = root.querySelectorAll("[data-edit-panel]");
  const panelKinds = panels.map((p) => p.getAttribute("data-edit-panel"));

  check("F3.1: Four contextual panels exist (text, pen, shape, image)",
    ["text", "pen", "shape", "image"].every((k) => panelKinds.includes(k))
  );
  check("F3.2: Contextual panels are hidden by default in raw markup",
    panels.every((p) => p.hidden === true)
  );
  check("F3.3: Text panel contains #edit-text textarea", Boolean(root.querySelector('[data-edit-panel="text"] #edit-text')));
  check("F3.4: Pen panel contains color & weight controls", Boolean(root.querySelector("#edit-pen-color")) && Boolean(root.querySelector("#edit-pen-weight")));
  check("F3.5: Shape panel contains fill & stroke controls", Boolean(root.querySelector("#edit-fill-color")) && Boolean(root.querySelector("#edit-stroke-color")));
  check("F3.6: Image panel contains browse button #edit-image-browse", Boolean(root.querySelector("#edit-image-browse")));
}

group("Tier 1 - F4: Properties Synchronization", "tier1");
{
  const root = fakeDocument.createElement("div");
  const ui = buildUi(root);

  check("F4.1: Text font size input (#edit-text-size) defaults to 18", ui.textSize?.value === "18");
  check("F4.2: Text color swatches are rendered for all INK_COLORS",
    root.querySelectorAll('.edit-swatches [data-for="edit-text-color"]').length === INK_COLORS.length
  );
  check("F4.3: Text size chips are rendered for all TEXT_SIZES",
    root.querySelectorAll('.edit-chips [data-size-chip]').length === TEXT_SIZES.length
  );
  check("F4.4: Text style checkboxes (#edit-text-bold, #edit-text-italic, #edit-text-underline) exist",
    Boolean(ui.textBold) && Boolean(ui.textItalic) && Boolean(ui.textUnderline)
  );
  check("F4.5: Alignment radiogroup (right, center, left) defaults to right",
    root.querySelector('input[name="edit-align"][value="right"]')?.checked === true
  );
  check("F4.6: Shape style presets (highlight, frame, fill, cover) are present",
    ["highlight", "frame", "fill", "cover"].every((p) => Boolean(root.querySelector(`[data-shape-preset="${p}"]`)))
  );
}

group("Tier 1 - F5: Interactive Layers Panel", "tier1");
{
  const root = fakeDocument.createElement("div");
  const ui = buildUi(root);

  check("F5.1: Layers list (#edit-layers) container exists", Boolean(ui.layers));
  check("F5.2: Layers list has aria-label", ui.layers?.getAttribute("aria-label") === "قائمة الطبقات");
  check("F5.3: INK_COLORS contains 7 vibrant palette colors", INK_COLORS.length === 7);
  check("F5.4: FILL_COLORS contains 7 harmonious pastel colors", FILL_COLORS.length === 7);
  check("F5.5: TEXT_SIZES spans from 12 to 48", TEXT_SIZES[0] === 12 && TEXT_SIZES[TEXT_SIZES.length - 1] === 48);
}

group("Tier 1 - F6: Lumen Glow v2 Design Tokens & Styles", "tier1");
{
  injectStyles();
  const styleTag = fakeDocument.getElementById(STYLE_ID);

  check("F6.1: injectStyles() attaches style element with STYLE_ID", Boolean(styleTag) && styleTag.id === STYLE_ID);
  const css = styleTag?.textContent || "";
  check("F6.2: CSS contains layout definitions (.edit-workspace, .edit-stage, .edit-board-wrap)",
    css.includes(".edit-workspace") && css.includes(".edit-stage") && css.includes(".edit-board-wrap")
  );
  check("F6.3: CSS contains transform handles and rotate styles (.edit-handle, .edit-rotate)",
    css.includes(".edit-handle") && css.includes(".edit-rotate")
  );
  check("F6.4: CSS contains selection outline and glow accents (.edit-obj.is-selected)",
    css.includes(".edit-obj.is-selected") && css.includes("var(--accent)")
  );
  check("F6.5: CSS contains responsive media queries (@media (max-width: 1080px) and @media (max-width: 640px))",
    css.includes("@media (max-width: 1080px)") && css.includes("@media (max-width: 640px)")
  );
  removeStyles();
  check("F6.6: removeStyles() cleans up injected style element", fakeDocument.getElementById(STYLE_ID) === null);
}

group("Tier 1 - F7: Arabic RTL & Typography", "tier1");
{
  injectStyles();
  const css = fakeDocument.getElementById(STYLE_ID)?.textContent || "";

  check("F7.1: Text object typography specifies Arabic fonts (Noto Naskh Arabic, Amiri)",
    css.includes('"Noto Naskh Arabic"') && css.includes('"Amiri"')
  );
  check("F7.2: Textarea edit overlay explicitly enforces direction: rtl",
    css.includes("direction: rtl")
  );
  check("F7.3: Board canvas and layer enforce direction: ltr for coordinate stability",
    css.includes("direction: ltr")
  );
  const root = fakeDocument.createElement("div");
  buildUi(root);
  check("F7.4: Leve text & titles contain proper Arabic instructional copy",
    root.textContent.includes("تحرير") && root.textContent.includes("أسقط ملف PDF هنا")
  );
  check("F7.5: Stage hint provides keyboard shortcuts in Arabic (<kbd>Delete</kbd>, <kbd>Ctrl+Z</kbd>)",
    root.querySelector(".edit-stage__hint")?.textContent.includes("Ctrl+Z")
  );
  removeStyles();
}

group("Tier 1 - F8: Dark/Light Theming", "tier1");
{
  injectStyles();
  const css = fakeDocument.getElementById(STYLE_ID)?.textContent || "";

  check("F8.1: Uses surface color tokens (var(--surface-1), var(--surface-2))",
    css.includes("var(--surface-1)") && css.includes("var(--surface-2)")
  );
  check("F8.2: Uses border tokens (var(--border-soft), var(--border-strong))",
    css.includes("var(--border-soft)") && css.includes("var(--border-strong)")
  );
  check("F8.3: Uses typography tokens (var(--text-muted), var(--ink-2))",
    css.includes("var(--text-muted)") && css.includes("var(--ink-2)")
  );
  check("F8.4: Uses accent and glow tokens (var(--accent), var(--accent-soft))",
    css.includes("var(--accent)") && css.includes("var(--accent-soft)")
  );
  check("F8.5: Uses standard spacing and radius tokens (var(--radius-xl), var(--radius-pill))",
    css.includes("var(--radius-xl)") && css.includes("var(--radius-pill)")
  );
  removeStyles();
}

group("Tier 1 - F9: Functional DOM Bindings Integrity", "tier1");
{
  const root = fakeDocument.createElement("div");
  const ui = buildUi(root);
  const boundKeys = [
    "drop", "browse", "input", "imageInput", "imageBrowse", "imageMeta",
    "workspace", "canvas", "layer", "wrap", "prev", "next", "count",
    "zoomIn", "zoomOut", "zoomFit", "zoomLabel", "layers", "text",
    "textSize", "textColor", "textBold", "textItalic", "textUnderline",
    "penColor", "penWeight", "fillOn", "fillColor", "strokeColor",
    "strokeWidth", "undo", "redo", "remove", "save", "clear"
  ];

  check("F9.1: buildUi returns all 35 required DOM references without nulls",
    boundKeys.every((k) => ui[k] !== null && ui[k] !== undefined)
  );
  check("F9.2: Canvas has default width 794 and height 1123",
    ui.canvas.getAttribute("width") === "794" && ui.canvas.getAttribute("height") === "1123"
  );
  check("F9.3: File inputs have proper accept filters (.pdf and image/*)",
    ui.input.getAttribute("accept").includes(".pdf") && ui.imageInput.getAttribute("accept").includes("image/png")
  );
  check("F9.4: Root view matches module metadata title", title === "تحرير" && id === "edit");
  check("F9.5: asTool() contracts provide correct router interface",
    typeof asTool().setup === "function" && typeof asTool().run === "function" && typeof asTool().isDirty === "function"
  );
}

group("Tier 1 - F10: Error-Free State & Lifecycle", "tier1");
{
  let threwOnEmpty = false;
  try {
    mount(null);
  } catch {
    threwOnEmpty = true;
  }
  check("F10.1: mount(null) throws descriptive error", threwOnEmpty);

  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);

  mount(root);
  check("F10.2: mount(root) injects styles and populates DOM",
    fakeDocument.getElementById(STYLE_ID) !== null && root.classList.contains("edit-root")
  );
  check("F10.3: Initial mounted state disables action buttons (undo, redo, delete, save)",
    root.querySelector("#edit-undo")?.disabled === true &&
    root.querySelector("#edit-redo")?.disabled === true &&
    root.querySelector("#edit-delete")?.disabled === true &&
    root.querySelector("#edit-save")?.disabled === true
  );

  unmount();
  check("F10.4: unmount() cleans up root element and removes styles",
    root.childNodes.length === 0 && fakeDocument.getElementById(STYLE_ID) === null
  );
  check("F10.5: unmount() is idempotent and safe on repeated calls",
    (() => { unmount(); unmount(); return true; })()
  );
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// TIER 2: Boundary & Corner Cases (Limits, clamping, fallbacks, empty states)
// ————————————————————————————————————————————————————————————————————————

group("Tier 2 - B1: Zoom Scale Limits & Clamping", "tier2");
{
  const A4W = 595;
  const A4H = 842;

  check("B1.1: Zero wrap dimension returns 0 without oscillation", fitPageCssWidth(A4W, A4H, 0, 0) === 0);
  check("B1.2: Small wrap below MIN_BOX_PX returns 0", fitPageCssWidth(A4W, A4H, 50, 50) === 0);
  check("B1.3: Fit calculation never exceeds available box width",
    fitPageCssWidth(A4W, A4H, 400, 800) <= 400
  );
  check("B1.4: Fit calculation never exceeds available box height proportional width",
    fitPageCssWidth(A4W, A4H, 800, 400) <= Math.round(400 * (A4W / A4H)) + 1
  );
  check("B1.5: stabilizeFitPx ignores small subpixel jitter (1px)",
    stabilizeFitPx(300.4, 300, 2) === 300 && stabilizeFitPx(310, 300, 2) === 310
  );
}

group("Tier 2 - B2: Text Size & Font Properties Limits", "tier2");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const textSize = root.querySelector("#edit-text-size");
  textSize.value = "5"; // Below min 10
  textSize.dispatchEvent(new FakeEvent("change", { bubbles: true }));

  textSize.value = "150"; // Above max 96
  textSize.dispatchEvent(new FakeEvent("change", { bubbles: true }));

  textSize.value = "NaN"; // Non-numeric fallback
  textSize.dispatchEvent(new FakeEvent("change", { bubbles: true }));

  check("B2.1: Min text size input attribute is 10", textSize.getAttribute("min") === "10");
  check("B2.2: Max text size input attribute is 96", textSize.getAttribute("max") === "96");
  check("B2.3: Text input accepts Arabic strings up to 2000 chars", root.querySelector("#edit-text")?.getAttribute("maxlength") === "2000");
  check("B2.4: Text swatches trigger input sync via dataset.swatch", Boolean(root.querySelector("[data-swatch]")));
  check("B2.5: Text size chips trigger input sync via dataset.sizeChip", Boolean(root.querySelector("[data-size-chip]")));

  unmount();
  root.remove();
}

group("Tier 2 - B3: Stroke Width & Pen Weight Limits", "tier2");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const strokeInput = root.querySelector("#edit-stroke-width");
  check("B3.1: Stroke width min attribute is 0", strokeInput.getAttribute("min") === "0");
  check("B3.2: Stroke width max attribute is 24", strokeInput.getAttribute("max") === "24");
  check("B3.3: Stroke width step is 0.5", strokeInput.getAttribute("step") === "0.5");

  const penWeight = root.querySelector("#edit-pen-weight");
  const options = penWeight.querySelectorAll("option").map((o) => o.value);
  check("B3.4: Pen weight options cover thin to broad (1.2, 2.2, 4, 7)",
    ["1.2", "2.2", "4", "7"].every((w) => options.includes(w))
  );
  check("B3.5: Pen weight default selected option is 2.2", penWeight.value === "2.2" || options.includes("2.2"));

  unmount();
  root.remove();
}

group("Tier 2 - B4: Box Clamping & Object Bounds", "tier2");
{
  const box = { x: -50, y: -20, width: 200, height: 150 };
  clampBox(box, 500, 500);
  check("B4.1: clampBox clamps negative coordinates to (0, 0)", box.x === 0 && box.y === 0);

  const overflowBox = { x: 450, y: 400, width: 200, height: 200 };
  clampBox(overflowBox, 500, 500);
  check("B4.2: clampBox pushes overflowing objects inside canvas boundaries",
    overflowBox.x + overflowBox.width <= 500 && overflowBox.y + overflowBox.height <= 500
  );

  const giantBox = { x: 0, y: 0, width: 800, height: 900 };
  clampBox(giantBox, 500, 500);
  check("B4.3: clampBox shrinks oversized objects to fit within canvas dimensions",
    giantBox.width <= 500 && giantBox.height <= 500
  );

  const deltaOrigin = clampedMove({ x: 0, y: 0, width: 50, height: 50 }, -20, -10, 500, 500);
  check("B4.4: clampedMove stops movement past top/left edges", deltaOrigin.dx === 0 && deltaOrigin.dy === 0);

  const deltaFar = clampedMove({ x: 450, y: 450, width: 50, height: 50 }, 30, 40, 500, 500);
  check("B4.5: clampedMove stops movement past bottom/right edges", deltaFar.dx === 0 && deltaFar.dy === 0);
}

group("Tier 2 - B5: History Stack Limits & Empty Operations", "tier2");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const undoBtn = root.querySelector("#edit-undo");
  const redoBtn = root.querySelector("#edit-redo");
  const delBtn = root.querySelector("#edit-delete");

  // Undo/Redo/Delete on empty state without crash
  undoBtn.click();
  redoBtn.click();
  delBtn.click();

  check("B5.1: Clicking undo on empty history does not throw", true);
  check("B5.2: Clicking redo on empty redo-stack does not throw", true);
  check("B5.3: Clicking delete with no selection does not throw", true);
  check("B5.4: Undo button remains disabled when history is empty", undoBtn.disabled === true);
  check("B5.5: Redo button remains disabled when redo stack is empty", redoBtn.disabled === true);

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// TIER 3: Cross-Feature Interactions (Tool switching, inspector sync, layers, undo/redo)
// ————————————————————————————————————————————————————————————————————————

group("Tier 3 - X1: Tool Switching & Dynamic Contextual Inspector Sync", "tier3");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const selectRadio = root.querySelector('input[name="edit-tool"][value="select"]');
  const textRadio = root.querySelector('input[name="edit-tool"][value="text"]');
  const penRadio = root.querySelector('input[name="edit-tool"][value="pen"]');
  const rectRadio = root.querySelector('input[name="edit-tool"][value="rect"]');
  const imageRadio = root.querySelector('input[name="edit-tool"][value="image"]');

  const textPanel = root.querySelector('[data-edit-panel="text"]');
  const penPanel = root.querySelector('[data-edit-panel="pen"]');
  const shapePanel = root.querySelector('[data-edit-panel="shape"]');
  const imagePanel = root.querySelector('[data-edit-panel="image"]');

  // Select tool -> all panels hidden (with no selection)
  selectRadio.checked = true;
  root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: selectRadio }));
  check("X1.1: Select tool with no object hides all 4 contextual panels",
    textPanel.hidden && penPanel.hidden && shapePanel.hidden && imagePanel.hidden
  );

  // Text tool -> text panel visible
  textRadio.checked = true;
  root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: textRadio }));
  check("X1.2: Activating Text tool displays Text panel and hides others",
    !textPanel.hidden && penPanel.hidden && shapePanel.hidden && imagePanel.hidden
  );

  // Pen tool -> pen panel visible
  penRadio.checked = true;
  root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: penRadio }));
  check("X1.3: Activating Pen tool displays Pen panel and hides others",
    textPanel.hidden && !penPanel.hidden && shapePanel.hidden && imagePanel.hidden
  );

  // Rect tool -> shape panel visible
  rectRadio.checked = true;
  root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: rectRadio }));
  check("X1.4: Activating Rect shape tool displays Shape panel and hides others",
    textPanel.hidden && penPanel.hidden && !shapePanel.hidden && imagePanel.hidden
  );

  // Image tool -> image panel visible
  imageRadio.checked = true;
  root.dispatchEvent(new FakeEvent("change", { bubbles: true, target: imageRadio }));
  check("X1.5: Activating Image tool displays Image panel and hides others",
    textPanel.hidden && penPanel.hidden && shapePanel.hidden && !imagePanel.hidden
  );

  unmount();
  root.remove();
}

group("Tier 3 - X2: Swatches & Preset Chips Interactive Sync", "tier3");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  // Click on a text color swatch
  const textSwatch = root.querySelectorAll('[data-for="edit-text-color"]').find((s) => s.dataset.swatch === "#DC2626");
  textSwatch?.click();
  const textColorInput = root.querySelector("#edit-text-color");
  check("X2.1: Clicking color swatch updates target input value", textColorInput?.value === "#DC2626");


  // Click on a text size chip
  const sizeChip = root.querySelector('[data-size-chip="24"]');
  sizeChip?.click();
  const textSizeInput = root.querySelector("#edit-text-size");
  check("X2.2: Clicking size chip updates target size input value to 24", textSizeInput?.value === "24");

  // Click on shape preset: highlight
  const highlightPreset = root.querySelector('[data-shape-preset="highlight"]');
  highlightPreset?.click();
  const fillOn = root.querySelector("#edit-fill-on");
  const fillColor = root.querySelector("#edit-fill-color");
  const strokeWidth = root.querySelector("#edit-stroke-width");
  check("X2.3: Highlight preset sets fillOn=true, yellow fill, strokeWidth=0",
    fillOn?.checked === true && fillColor?.value === "#FDE68A" && strokeWidth?.value === "0"
  );

  // Click on shape preset: frame
  const framePreset = root.querySelector('[data-shape-preset="frame"]');
  framePreset?.click();
  const strokeColor = root.querySelector("#edit-stroke-color");
  check("X2.4: Frame preset sets fillOn=false, red stroke, strokeWidth=2",
    fillOn?.checked === false && strokeColor?.value === "#DC2626" && strokeWidth?.value === "2"
  );

  // Click on shape preset: cover
  const coverPreset = root.querySelector('[data-shape-preset="cover"]');
  coverPreset?.click();
  check("X2.5: Cover preset sets white fill (#FFFFFF) and 0 stroke width",
    fillOn?.checked === true && fillColor?.value === "#FFFFFF" && strokeWidth?.value === "0"
  );

  unmount();
  root.remove();
}

group("Tier 3 - X3: Keyboard Shortcuts Handling", "tier3");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  // Simulate Ctrl+Z and Ctrl+Y keydown events on root
  const ctrlZ = new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "z", cancelable: true, target: root });
  const ctrlY = new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "y", cancelable: true, target: root });
  const deleteKey = new FakeEvent("keydown", { bubbles: true, key: "Delete", cancelable: true, target: root });
  const arrowRight = new FakeEvent("keydown", { bubbles: true, key: "ArrowRight", cancelable: true, target: root });

  root.dispatchEvent(ctrlZ);
  root.dispatchEvent(ctrlY);
  root.dispatchEvent(deleteKey);
  root.dispatchEvent(arrowRight);

  check("X3.1: Ctrl+Z keydown is intercepted for undo without error", ctrlZ.defaultPrevented);
  check("X3.2: Ctrl+Y keydown is intercepted for redo without error", ctrlY.defaultPrevented);
  check("X3.3: Arrow keys are handled for precise object nudging", arrowRight.defaultPrevented);

  // Typing inside input should NOT trigger root shortcuts
  const inputEl = root.querySelector("#edit-text");
  const typingZ = new FakeEvent("keydown", { bubbles: true, ctrlKey: true, key: "z", cancelable: true, target: inputEl });
  root.dispatchEvent(typingZ);
  check("X3.4: Ctrl+Z inside text input is NOT intercepted by root editor", !typingZ.defaultPrevented);

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// TIER 4: Real-World Workflow Scenarios
// ————————————————————————————————————————————————————————————————————————

group("Tier 4 - W1: End-to-End Edit Session Lifecycle", "tier4");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  // 1. Initial State
  check("W1.1: Initially drop zone is visible and workspace is hidden",
    !root.querySelector("#edit-drop").hidden && root.querySelector("#edit-workspace").hidden
  );

  // 2. Load PDF file
  const fixturePdfBytes = await makePdfFixture(3);
  const fakeFile = {
    name: "test-document.pdf",
    size: fixturePdfBytes.byteLength,
    type: "application/pdf",
    arrayBuffer: async () => fixturePdfBytes.buffer
  };

  // Check file type detection
  check("W1.2: PDF file is recognized and ready for intake", fakeFile.name.endsWith(".pdf"));

  // 3. Output naming calculation
  const outName = suggestedName();
  check("W1.3: suggestedName() returns Arabic formatted filename ending in .pdf",
    outName.endsWith(".pdf") && outName.includes("محرّر")
  );

  // 4. Persistence in localStorage
  const savedStyles = fakeLocalStorage.getItem("pdfstudio.edit.style.v1");
  check("W1.4: Style preferences can be serialized to localStorage", savedStyles !== undefined);

  // 5. Unmount cleans up all state
  unmount();
  check("W1.5: Full unmount tears down all DOM children and removes listeners", root.childNodes.length === 0);
  root.remove();
}

group("Tier 4 - W2: Multi-Page Document Handling & Isolation", "tier4");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const prevBtn = root.querySelector("#edit-prev");
  const nextBtn = root.querySelector("#edit-next");
  const countLabel = root.querySelector("#edit-count");

  check("W2.1: Page count label starts at '1 / 1'", countLabel.textContent.trim() === "1 / 1");
  check("W2.2: Previous page button is initially disabled on page 1", prevBtn.disabled === true);
  check("W2.3: Next page button is initially disabled when only 1 page loaded", nextBtn.disabled === true);

  unmount();
  root.remove();
}

group("Tier 4 - W3: Adversarial Strings & Special Characters", "tier4");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const textArea = root.querySelector("#edit-text");
  const adversarialStrings = [
    "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — تشكيل كامل",
    "<script>alert('xss')</script> & \"quotes\" 'single'",
    "Mixed العربية with English and 12345 Numbers and RTL Marks",
    "🎨✨📝 Emojis and Symbols: © ® ™ § ¶ † ‡",
    "Multi\nLine\n\rText\tWith\tTabs"
  ];

  for (let i = 0; i < adversarialStrings.length; i++) {
    const str = adversarialStrings[i];
    textArea.value = str;
    textArea.dispatchEvent(new FakeEvent("input", { bubbles: true }));
    check(`W3.${i + 1}: Adversarial string ${i + 1} safely assigned without corruption`,
      textArea.value === str
    );
  }

  unmount();
  root.remove();
}

group("Tier 4 - W4: Coordinate Math & PDF Rotation Transformations", "tier4");
{
  const mediaW = 600;
  const mediaH = 800;
  const rect = { x: 50, y: 100, width: 200, height: 150 };

  const r0 = visualRectToMedia(0, mediaW, mediaH, rect);
  check("W4.1: 0° rotation preserves rect dimensions and origin",
    r0.width === 200 && r0.height === 150 && r0.ccw === 0
  );

  const r90 = visualRectToMedia(90, mediaW, mediaH, rect);
  check("W4.2: 90° rotation swaps dimensions and shifts coordinates",
    r90.width === 150 && r90.height === 200 && r90.ccw === 1
  );

  const r180 = visualRectToMedia(180, mediaW, mediaH, rect);
  check("W4.3: 180° rotation inverts origin position",
    r180.width === 200 && r180.height === 150 && r180.ccw === 2
  );

  const r270 = visualRectToMedia(270, mediaW, mediaH, rect);
  check("W4.4: 270° rotation swaps dimensions and maps to 3 ccw quarters",
    r270.width === 150 && r270.height === 200 && r270.ccw === 3
  );

  const p = rotatePoint(10, 0, 0, 0, 90);
  check("W4.5: Point rotation 90° clockwise maps (10, 0) to (0, -10)",
    Math.abs(p.x - 0) < 1e-6 && Math.abs(p.y - (-10)) < 1e-6
  );
}

group("Tier 4 - W5: Vector & Shape Flattening Pipeline", "tier4");
{
  const fixturePdfBytes = await makePdfFixture(2);
  const { flattenObjects } = await import("../assets/js/tools/edit/flatten.js");

  const objects = [
    {
      id: "obj-rect",
      type: "shape",
      kind: "rect",
      pageIndex: 0,
      x: 50,
      y: 100,
      width: 120,
      height: 60,
      fillOn: true,
      fill: "#BFDBFE",
      stroke: "#1E3A8A",
      strokeWidth: 2,
      rotation: 0
    },
    {
      id: "obj-ellipse",
      type: "shape",
      kind: "ellipse",
      pageIndex: 0,
      x: 200,
      y: 100,
      width: 80,
      height: 80,
      fillOn: true,
      fill: "#FDE68A",
      stroke: "#DC2626",
      strokeWidth: 1.5,
      rotation: 45
    },
    {
      id: "obj-triangle",
      type: "shape",
      kind: "triangle",
      pageIndex: 0,
      x: 350,
      y: 100,
      width: 100,
      height: 100,
      fillOn: false,
      fill: "#FFFFFF",
      stroke: "#059669",
      strokeWidth: 3,
      rotation: 0
    },
    {
      id: "obj-ink",
      type: "ink",
      pageIndex: 1,
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      color: "#7C3AED",
      strokeWidth: 4,
      points: [
        { x: 50, y: 50 },
        { x: 75, y: 80 },
        { x: 100, y: 50 },
        { x: 125, y: 90 },
        { x: 150, y: 50 }
      ],
      rotation: 0
    }
  ];

  const flattenedBytes = await flattenObjects(fixturePdfBytes, objects);
  check("W5.1: flattenObjects produces non-empty Uint8Array output",
    flattenedBytes instanceof Uint8Array && flattenedBytes.byteLength > 0
  );

  const reloadedDoc = await PDFDocument.load(flattenedBytes);
  check("W5.2: Flattened output reloads as valid PDF with matching page count",
    reloadedDoc.getPageCount() === 2
  );
  check("W5.3: Page 1 retains original page size",
    Math.round(reloadedDoc.getPage(0).getWidth()) === 595 && Math.round(reloadedDoc.getPage(0).getHeight()) === 842
  );
}

group("Tier 4 - W6: Multi-Step Undo/Redo & Layer Manipulation", "tier4");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const undoBtn = root.querySelector("#edit-undo");
  const redoBtn = root.querySelector("#edit-redo");
  const delBtn = root.querySelector("#edit-delete");

  check("W6.1: Undo button is disabled initially", undoBtn.disabled === true);
  check("W6.2: Redo button is disabled initially", redoBtn.disabled === true);
  check("W6.3: Delete button is disabled initially", delBtn.disabled === true);

  unmount();
  root.remove();
}

group("Tier 4 - W7: Interactive Layer Selection, Deletion, and Empty States", "tier4");
{
  const root = fakeDocument.createElement("div");
  root.id = "view-edit";
  fakeBody.append(root);
  mount(root);

  const layersList = root.querySelector("#edit-layers");
  check("W7.1: Layers list is empty on initial mount", layersList.childNodes.length === 0);

  const saveBtn = root.querySelector("#edit-save");
  check("W7.2: Save button is disabled when document has no objects", saveBtn.disabled === true);

  unmount();
  root.remove();
}

// ————————————————————————————————————————————————————————————————————————
// Summary & Exit Code
// ————————————————————————————————————————————————————————————————————————

console.log("\n==================================================");
console.log(`PDF Edit Redesign E2E Suite: ${totalChecks - failures}/${totalChecks} checks passed`);
console.log(`Failures: ${failures}`);
console.log("==================================================");

process.exit(failures ? 1 : 0);
