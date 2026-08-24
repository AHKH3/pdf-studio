/**
 * Parses every first-party source file. Cheap standing in for a linter: it
 * catches the typos that would otherwise only surface as a blank window.
 */
import { readFile, readdir, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([
  "node_modules",
  ".git",
  "release",
  "vendor",
  "fonts",
  "branding",
  ".cursor",
  "tmp",
  ".tmp",
  ".tmp-grid"
]);

/** @param {string} dir @param {string[]} out */
async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function checkScript(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?["'](\.[^"']+)["']/g;
const EXPORT_NAME_RE =
  /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /export\s+\{([^}]+)\}/g;
const EXPORT_FROM_RE = /export\s+\{([^}]+)\}\s+from\s+["'](\.[^"']+)["']/g;
const DEFAULT_EXPORT_RE = /export\s+default\b/;

const sourceCache = new Map();

async function readSource(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, await readFile(file, "utf8"));
  return sourceCache.get(file);
}

function resolveFrom(fromFile, spec) {
  const abs = path.resolve(path.dirname(fromFile), spec);
  return abs.endsWith(".js") || abs.endsWith(".mjs") ? abs : `${abs}.js`;
}

function parseImportedNames(clause) {
  if (!clause) return { names: [], default: false, namespace: false };
  const trimmed = clause.replace(/\btype\s+/g, "").trim();
  if (trimmed.startsWith("*")) return { names: [], default: false, namespace: true };
  const names = [];
  let hasDefault = false;
  if (!trimmed.startsWith("{") && /^[A-Za-z_$][\w$]*/.test(trimmed)) hasDefault = true;
  const brace = trimmed.match(/\{([^}]*)\}/);
  if (brace) {
    for (const part of brace[1].split(",")) {
      const orig = part.trim().split(/\s+as\s+/)[0].trim();
      if (orig && orig !== "default") names.push(orig);
      if (orig === "default") hasDefault = true;
    }
  }
  return { names, default: hasDefault, namespace: false };
}

async function collectExports(file, seen = new Set()) {
  if (seen.has(file)) return { names: new Set(), hasDefault: false };
  seen.add(file);
  const source = await readSource(file);
  const names = new Set();
  let hasDefault = DEFAULT_EXPORT_RE.test(source);
  for (const match of source.matchAll(EXPORT_NAME_RE)) names.add(match[1]);
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    if (/from\s+["']/.test(match[0])) continue;
    for (const part of match[1].split(",")) {
      const orig = part.trim().split(/\s+as\s+/)[0].trim();
      if (orig) names.add(orig);
    }
  }
  for (const match of source.matchAll(EXPORT_FROM_RE)) {
    const inner = await collectExports(resolveFrom(file, match[2]), seen);
    for (const part of match[1].split(",")) {
      const orig = part.trim().split(/\s+as\s+/)[0].trim();
      if (orig) names.add(orig);
      void inner;
    }
  }
  return { names, hasDefault };
}

/** A missing named export in the renderer graph blanks the window. */
async function checkRendererImports() {
  const queue = (await walk(path.join(ROOT, "assets", "js"))).filter(
    (file) => !file.includes(`${path.sep}vendor${path.sep}`)
  );
  const visited = new Set();
  const missing = [];

  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    let source;
    try {
      source = await readSource(file);
    } catch {
      missing.push(path.relative(ROOT, file));
      continue;
    }
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[2];
      if (!spec.startsWith(".")) continue;
      const target = resolveFrom(file, spec);
      queue.push(target);
      const imported = parseImportedNames(match[1] || "");
      if (imported.namespace) continue;
      let exported;
      try {
        exported = await collectExports(target);
      } catch {
        missing.push(`${path.relative(ROOT, file)} -> ${spec}`);
        continue;
      }
      if (imported.default && !exported.hasDefault) {
        missing.push(`${path.relative(ROOT, file)} default from ${spec}`);
      }
      for (const name of imported.names) {
        if (!exported.names.has(name)) {
          missing.push(`${path.relative(ROOT, file)} { ${name} } from ${spec}`);
        }
      }
    }
  }
  return missing;
}

/** Flags element ids the scripts reach for that the markup never defines. */
async function checkIds() {
  const html = await readFile(path.join(ROOT, "index.html"), "utf8");
  const defined = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]));
  const files = (await walk(path.join(ROOT, "assets", "js"))).filter((f) => !f.includes("vendor"));
  const missing = new Map();

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bel\("([a-z0-9-]+)"\)/gi)) {
      if (!defined.has(match[1])) {
        if (!missing.has(match[1])) missing.set(match[1], []);
        missing.get(match[1]).push(path.relative(ROOT, file));
      }
    }
  }
  return missing;
}

/**
 * electron-builder's Go parser rejects a UTF-8 BOM in package.json
 * (ERR_ELECTRON_BUILDER_CANNOT_EXECUTE), so no shipped text file may carry one.
 */
async function checkBom() {
  const offenders = [];
  for (const name of ["package.json", "package-lock.json", ".gitignore", "index.html"]) {
    const handle = await open(path.join(ROOT, name), "r").catch(() => null);
    if (!handle) continue;
    try {
      const bytes = Buffer.alloc(3);
      await handle.read(bytes, 0, 3, 0);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offenders.push(name);
    } finally {
      await handle.close();
    }
  }
  return offenders;
}

async function main() {
  const files = await walk(ROOT);
  let failed = 0;

  for (const file of files) {
    try {
      checkScript(file);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${path.relative(ROOT, file)}`);
      console.error(String(error.message).split("\n").slice(0, 4).join("\n"));
    }
  }
  console.log(`syntax: ${files.length - failed}/${files.length} files parse`);

  const missing = await checkIds();
  if (missing.size) {
    failed += 1;
    console.error("\nids referenced in JS but absent from index.html:");
    for (const [id, where] of missing) console.error(`  #${id} — ${[...new Set(where)].join(", ")}`);
  } else {
    console.log("ids: every el() lookup exists in index.html");
  }

  const brokenImports = await checkRendererImports();
  if (brokenImports.length) {
    failed += 1;
    console.error("\nrenderer import graph:");
    for (const item of brokenImports) console.error(`  ${item}`);
  } else {
    console.log("imports: renderer graph resolves");
  }

  const bomFiles = await checkBom();
  if (bomFiles.length) {
    failed += 1;
    console.error("\nutf-8 BOM (breaks electron-builder):");
    for (const name of bomFiles) console.error(`  ${name}`);
  } else {
    console.log("bom: package.json and friends are clean");
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
