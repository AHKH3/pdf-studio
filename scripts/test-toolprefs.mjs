/**
 * Pin context-menu label must appear once. The HTML fallback is a text node
 * next to the icon; updating the label used to append a <span> without
 * removing that text, so the phrase doubled: «تثبيت في الأعلى تثبيت في الأعلى».
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setPinButtonLabel } from "../assets/js/ui/toolprefs.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

class FakeNode {
  constructor(nodeType, tagName, textContent = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.textContent = textContent;
    this.className = "";
    this.childNodes = [];
    this.parent = null;
  }
  matches(sel) {
    return sel.split(",").map((part) => part.trim()).some((part) => {
      if (part === "span") return this.tagName === "SPAN";
      if (part.startsWith(".")) return this.className.split(/\s+/).includes(part.slice(1));
      return false;
    });
  }
  querySelector(sel) {
    for (const child of this.childNodes) {
      if (child.nodeType === 1 && child.matches(sel)) return child;
    }
    return null;
  }
  append(node) {
    node.parent = this;
    this.childNodes.push(node);
  }
  remove() {
    if (!this.parent) return;
    const index = this.parent.childNodes.indexOf(this);
    if (index >= 0) this.parent.childNodes.splice(index, 1);
    this.parent = null;
  }
}

globalThis.document = {
  createElement(tag) {
    return new FakeNode(1, tag.toUpperCase());
  }
};

function pinButtonFromHtmlFallback() {
  const btn = new FakeNode(1, "BUTTON");
  btn.append(new FakeNode(1, "SVG"));
  btn.append(new FakeNode(3, "#text", " تثبيت في الأعلى"));
  return btn;
}

function visibleText(btn) {
  return btn.childNodes
    .map((node) => (node.nodeType === 3 || node.tagName === "SPAN" ? node.textContent : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

console.log("\ntoolprefs pin menu label (AHK-39)");

{
  const btn = pinButtonFromHtmlFallback();
  setPinButtonLabel(btn, false);
  check(
    "unpinned label is a single «تثبيت في الأعلى»",
    visibleText(btn) === "تثبيت في الأعلى",
    `got «${visibleText(btn)}»`
  );
}

{
  const btn = pinButtonFromHtmlFallback();
  setPinButtonLabel(btn, true);
  check(
    "pinned label is a single «إلغاء التثبيت»",
    visibleText(btn) === "إلغاء التثبيت",
    `got «${visibleText(btn)}»`
  );
}

{
  const btn = pinButtonFromHtmlFallback();
  setPinButtonLabel(btn, false);
  setPinButtonLabel(btn, true);
  setPinButtonLabel(btn, false);
  check(
    "reopening the menu does not stack copies",
    visibleText(btn) === "تثبيت في الأعلى",
    `got «${visibleText(btn)}»`
  );
}

{
  const btn = new FakeNode(1, "BUTTON");
  btn.append(new FakeNode(1, "SVG"));
  const span = new FakeNode(1, "SPAN", "تثبيت في الأعلى");
  span.className = "ctxmenu__label";
  btn.append(span);
  setPinButtonLabel(btn, true);
  check(
    "existing .ctxmenu__label is rewritten, not appended",
    visibleText(btn) === "إلغاء التثبيت" && btn.childNodes.filter((n) => n.tagName === "SPAN").length === 1,
    `got «${visibleText(btn)}» spans=${btn.childNodes.filter((n) => n.tagName === "SPAN").length}`
  );
}

{
  const html = await readFile(path.join(ROOT, "index.html"), "utf8");
  const pinBlock = html.match(/data-ctx="pin"[^>]*>([\s\S]*?)<\/button>/);
  check("index.html has a pin menu item", Boolean(pinBlock));
  const inner = pinBlock?.[1] || "";
  const copies = inner.match(/تثبيت في الأعلى/g) || [];
  check("markup contains the pin phrase once", copies.length === 1, `count=${copies.length}`);
  check(
    "markup wraps the pin phrase in .ctxmenu__label so JS can replace it",
    /<span\b[^>]*class="[^"]*ctxmenu__label[^"]*"[^>]*>\s*تثبيت في الأعلى/.test(inner),
    inner.replace(/\s+/g, " ").trim().slice(0, 120)
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
