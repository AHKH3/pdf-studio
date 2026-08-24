/**
 * Dead-CSS audit for assets/css/app.css against index.html + all renderer JS.
 * A rule is flagged only when NONE of its selectors appears anywhere in the
 * HTML or JS corpus (string match on the class/id/element name), which makes
 * the report conservative: anything dynamically composed still shows up as a
 * literal somewhere and is therefore never reported.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cssPath = join(root, "assets", "css", "app.css");
const css = readFileSync(cssPath, "utf8");

// --- gather corpus -------------------------------------------------------
const corpus = [readFileSync(join(root, "index.html"), "utf8")];
const jsDirs = ["assets/js"];
while (jsDirs.length) {
  const dir = jsDirs.shift();
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) jsDirs.push(full);
    else if (/\.(js|mjs|cjs|html)$/.test(entry)) corpus.push(readFileSync(full, "utf8"));
  }
}
const haystack = corpus.join("\n");

// --- parse selectors -----------------------------------------------------
// Strip comments, then walk top-level rules (no @media nesting handling needed
// beyond keeping inner rules — we simply capture every `sel {` occurrence).
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const ruleRe = /([^{}]+)\{/g;
let match;
const dead = [];
const seen = new Set();

while ((match = ruleRe.exec(noComments))) {
  const raw = match[1].trim();
  if (!raw || raw.startsWith("@") === false && raw.includes(";")) continue; // declaration junk
  if (/^@(media|supports|keyframes|font-face|layer|property)/.test(raw) && raw.startsWith("@")) continue;

  // Skip @keyframes inner steps (from, to, 0%, 50%, etc.) — the regex picks them up
  // as bare selectors but they are not real selectors.
  if (/^(from|to|\d+%)$/.test(raw)) continue;

  const selectors = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const selector of selectors) {
    if (seen.has(selector)) continue;
    seen.add(selector);

    // Extract matchable tokens from the selector.
    const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    const ids = [...selector.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
    const elements = [...selector.matchAll(/(^|[\s>+~(])([a-z]+)(?=[\s>+~:.#[{]|$)/g)]
      .map((m) => m[2])
      .filter((tag) => !["and", "not", "is", "where", "has"].includes(tag));

    let alive = false;
    for (const cls of classes) {
      if (haystack.includes(cls)) { alive = true; break; }
      // Template-literal construction: if JS builds "foo--${var}", treat all foo--* as alive.
      const prefix = cls.split("--")[0];
      if (prefix && haystack.includes(`${prefix}--`)) { alive = true; break; }
    }
    if (!alive) for (const id of ids) {
      if (haystack.includes(id)) { alive = true; break; }
    }
    if (!alive && !classes.length && !ids.length) {
      for (const tag of elements) {
        const re = new RegExp(`<${tag}[\\s>]`);
        if (re.test(haystack) || haystack.includes(tag)) { alive = true; break; }
      }
      if (!alive && /@(keyframes)/.test(raw)) alive = true;
    }
    // Pseudo-class-only safety: state hooks toggled by classList strings.
    if (!alive) continue;
    continue;
  }

  // A rule is dead only if EVERY comma branch is unmatchable.
  const branchesDead = selectors.map((selector) => {
    const classes = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    const ids = [...selector.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
    if (classes.length) return classes.every((cls) => {
      if (haystack.includes(cls)) return false;
      // Template-literal construction: if JS builds "foo--${var}", treat all foo--* as alive.
      const prefix = cls.split("--")[0];
      if (prefix && haystack.includes(`${prefix}--`)) return false;
      return true;
    });
    if (ids.length) return ids.every((id) => !haystack.includes(id));
    const tagMatch = selector.match(/(^|[\s>+~])([a-z][a-z0-9]*)(?=[:\s.[{,]|$)/);
    if (!tagMatch) return false;
    return !new RegExp(`<${tagMatch[2]}[\\s>]`).test(haystack);
  });
  if (branchesDead.length && branchesDead.every(Boolean) && !/^@/.test(raw.trim())) {
    dead.push(raw.replace(/\s+/g, " ").slice(0, 120));
  }
}

console.log(`dead rules: ${dead.length}`);
for (const rule of dead) console.log(`  ${rule}`);
