#!/usr/bin/env node
/**
 * Runtime checks for v1.2 shell behaviour: boot-to-hero, force close with
 * unsaved work, --background-update, and second-instance lock.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let ok = 0;
let fail = 0;
function check(name, cond, hint = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
    ok += 1;
  } else {
    console.log(`  FAIL ${name}${hint ? ` — ${hint}` : ""}`);
    fail += 1;
  }
}

function group(title) {
  console.log(`\n${title}`);
}

const DIRTY_TOOLS = [];
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "vendor") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

group("shell — dirty-tool contract");
{
  const files = walk(path.join(root, "assets", "js", "tools"));
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/\bisDirty\s*:/.test(src)) continue;
    const rel = path.relative(root, file);
    DIRTY_TOOLS.push(rel);
  }
  check("أدوات isDirty موجودة (edit + organize على الأقل)", DIRTY_TOOLS.some((f) => f.includes("edit")) && DIRTY_TOOLS.some((f) => f.includes("organize")));
  const router = fs.readFileSync(path.join(root, "assets", "js", "ui", "router.js"), "utf8");
  check("hasUnsavedWork يمر على tool.isDirty", /for \(const tool of tools\.values\(\)\)/.test(router) && /tool\.isDirty\?\.\(\)/.test(router));
  console.log(`  info dirty tools: ${DIRTY_TOOLS.length} — ${DIRTY_TOOLS.map((f) => f.replace(/\\/g, "/")).join(", ")}`);
}

function electronBin() {
  try {
    return require("electron");
  } catch {
    return null;
  }
}

function spawnApp(args, env, { timeoutMs = 25000 } = {}) {
  const bin = electronBin();
  if (!bin) throw new Error("electron binary missing");
  const child = spawn(bin, args, {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  const onData = (buf) => {
    out += buf.toString();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const killer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  const done = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, out });
    });
    child.on("error", (error) => {
      clearTimeout(killer);
      resolve({ code: 1, signal: null, out: out + String(error) });
    });
  });
  return { child, done, getOut: () => out };
}

function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pdfstudio-shell-"));
}

function hasDisplay() {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY);
}

const bin = electronBin();
if (!bin) {
  group("shell — runtime");
  check("electron binary", false, "npm install first");
  console.log(`\n${ok}/${ok + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

group("shell — background-update (no window)");
{
  const dir = tmpUserData();
  const t0 = Date.now();
  const { done } = spawnApp([root, `--user-data-dir=${dir}`, "--background-update"], {}, { timeoutMs: 15000 });
  const res = await done;
  const elapsed = Date.now() - t0;
  check("الخلفية تخرج بسرعة (unpackaged)", res.code === 0 && elapsed < 8000, `code=${res.code} ${elapsed}ms`);
  check("لا جاهزية نافذة في الوضع الخلفي", !/ready-to-show/.test(res.out), res.out.slice(-200));
  check("سجل تخطي unpackaged", /background-update skipped \(unpackaged\)/.test(res.out), res.out.slice(-300));
  fs.rmSync(dir, { recursive: true, force: true });
}

if (!hasDisplay()) {
  group("shell — gui skipped (no DISPLAY)");
  check("تخطي فحوصات الإقلاع/الإغلاق بدون شاشة", true);
  console.log(`\n${ok}/${ok + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

const displayEnv = process.env.DISPLAY ? {} : { DISPLAY: ":1" };

group("shell — boot to hero");
{
  const dir = tmpUserData();
  const { done } = spawnApp(
    [root, `--user-data-dir=${dir}`],
    { ...displayEnv, PDF_STUDIO_TEST: "boot" },
    { timeoutMs: 40000 }
  );
  const res = await done;
  const hero = res.out.match(/hero-ms (\d+)/);
  const fcp = res.out.match(/fcp-ms (\d+|null)/);
  const tools = res.out.match(/\[test\] tools (\d+) unsaved (\S+)/);
  const heroMs = hero ? Number(hero[1]) : NaN;
  check("الإقلاع يصل للهيرو", Boolean(hero) && res.code === 0, res.out.slice(-400));
  check("زمن الهيرو < 1.2s", Number.isFinite(heroMs) && heroMs < 1200, `heroMs=${heroMs} fcp=${fcp?.[1]}`);
  check("الأدوات تُحمَّل بعد الهيرو", tools && Number(tools[1]) >= 12, tools ? tools[0] : "no tools line");
  check("لا عمل غير محفوظ عند الإقلاع", tools && tools[2] === "false", tools ? tools[0] : "");
  fs.rmSync(dir, { recursive: true, force: true });
}

group("shell — close with unsaved work");
{
  const dir = tmpUserData();
  const { done } = spawnApp(
    [root, `--user-data-dir=${dir}`],
    { ...displayEnv, PDF_STUDIO_TEST: "close-clean" },
    { timeoutMs: 25000 }
  );
  const res = await done;
  check("إغلاق نظيف ينهي العملية", res.code === 0, `code=${res.code}`);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpUserData();
  const { done } = spawnApp(
    [root, `--user-data-dir=${dir}`],
    {
      ...displayEnv,
      PDF_STUDIO_TEST: "close-unsaved-stay",
      PDF_STUDIO_TEST_UNSAVED: "stay"
    },
    { timeoutMs: 25000 }
  );
  const res = await done;
  check("عمل غير محفوظ + البقاء يبقي النافذة", /\[test\] stayed true/.test(res.out) && res.code === 0, res.out.slice(-300));
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpUserData();
  const { done } = spawnApp(
    [root, `--user-data-dir=${dir}`],
    {
      ...displayEnv,
      PDF_STUDIO_TEST: "close-unsaved-close",
      PDF_STUDIO_TEST_UNSAVED: "close"
    },
    { timeoutMs: 25000 }
  );
  const res = await done;
  check("عمل غير محفوظ + إغلاق حتمي ينهي العملية", res.code === 0, `code=${res.code} ${res.out.slice(-200)}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

group("shell — second-instance lock vs background-update");
{
  const dir = tmpUserData();
  const first = spawnApp(
    [root, `--user-data-dir=${dir}`],
    { ...displayEnv, PDF_STUDIO_SINGLE_INSTANCE: "1", PDF_STUDIO_TEST: "hold" },
    { timeoutMs: 35000 }
  );
  const holding = await new Promise((resolve) => {
    const deadline = Date.now() + 20000;
    const tick = () => {
      if (/\[test\] holding/.test(first.getOut())) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
  check("النسخة الأولى وصلت للهيرو وأمسكت القفل", holding, first.getOut().slice(-300));

  const second = spawnApp(
    [root, `--user-data-dir=${dir}`, "--background-update"],
    { ...displayEnv, PDF_STUDIO_SINGLE_INSTANCE: "1" },
    { timeoutMs: 12000 }
  );
  const secondRes = await second.done;
  await new Promise((r) => setTimeout(r, 400));
  const firstOut = first.getOut();
  check("النسخة الخلفية تخرج لأن القفل مأخوذ", secondRes.code === 0 || /lock held/.test(secondRes.out), `code=${secondRes.code}`);
  check("النسخة المفتوحة لا تُركَّز بسبب التحديث الخلفي", /ignoring background-update \(app already open\)/.test(firstOut), firstOut.slice(-400));
  check("النسخة المفتوحة ما زالت حية", !/\[test\] stayed/.test(firstOut) && first.child.exitCode == null);

  try {
    first.child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  await first.done;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${ok}/${ok + fail} checks passed`);
process.exit(fail ? 1 : 0);
