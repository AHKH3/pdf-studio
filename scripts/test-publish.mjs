/**
 * Guards the publish channel: static landing (GitHub Pages, no third-party
 * services), tag-driven GitHub Releases (Windows NSIS only), and
 * electron-updater silent install + relaunch for installed builds.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function group(name, body) {
  console.log(`\n${name}`);
  body();
}

const pkg = JSON.parse(read("package.json"));
const landing = read("landing/index.html");
const pagesYml = read(".github/workflows/pages.yml");
const releaseYml = read(".github/workflows/release.yml");
const mainCjs = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const updater = read("assets/js/ui/updater.js");
const decisions = read("docs/DECISIONS.md");

group("package.json", () => {
  check("version is semver", /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
  check(
    "description is Arabic UTF-8",
    pkg.description.includes("أدوات PDF") && pkg.description.includes("سطح مكتب"),
    JSON.stringify(pkg.description)
  );
  check("electron-updater is a runtime dependency", Boolean(pkg.dependencies?.["electron-updater"]));
  check("publish provider is GitHub AHKH3/pdf-studio", pkg.build?.publish?.provider === "github" && pkg.build.publish.owner === "AHKH3" && pkg.build.publish.repo === "pdf-studio");
  const winTargets = pkg.build?.win?.target || [];
  check("Windows target is NSIS only", winTargets.length === 1 && winTargets[0] === "nsis", JSON.stringify(winTargets));
  check("Portable target is absent (owner policy)", !winTargets.includes("portable"));
  check("NSIS artifact is PDFStudio-Setup", pkg.build?.nsis?.artifactName === "PDFStudio-Setup.${ext}");
  check("win-level artifactName is unset", !pkg.build?.win?.artifactName);
  check("Linux build config is absent (owner policy)", !pkg.build?.linux);
  check("dist:linux script is absent (owner policy)", !pkg.scripts?.["dist:linux"]);
  check("dist script is Windows NSIS", pkg.scripts?.dist === "electron-builder --win nsis");
});

group("NSIS silent one-click (AHK-43)", () => {
  const nsis = pkg.build?.nsis || {};
  check("oneClick is true (no Next/Next wizard)", nsis.oneClick === true, JSON.stringify(nsis.oneClick));
  check("allowToChangeInstallationDirectory is false", nsis.allowToChangeInstallationDirectory === false);
  check("perMachine is false (per-user)", nsis.perMachine === false);
  check("allowElevation is false (no UAC/global prompt path)", nsis.allowElevation === false);
  check("runAfterFinish is true", nsis.runAfterFinish === true);
  check("NSIS includes Task Scheduler hook", nsis.include === "build/installer.nsh");
  check("decision recorded", /تحديث NSIS صامت بالكامل/.test(decisions));
});

group("landing (GitHub Pages, no external services)", () => {
  check("no Google Fonts CSS", !/fonts\.googleapis\.com/i.test(landing));
  check("no fonts.gstatic", !/fonts\.gstatic\.com/i.test(landing));
  check("no jsDelivr/unpkg/cdnjs", !/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)/i.test(landing));
  check("favicon is inside landing/", /rel="icon"[^>]+href="branding\/app-icon-192\.png"/.test(landing));
  check("apple-touch-icon is inside landing/", /rel="apple-touch-icon"[^>]+href="branding\/app-icon-512\.png"/.test(landing));
  check("no parent-folder asset URLs", !/\.\.\/assets\//.test(landing));
  check("local Noto Naskh @font-face", /fonts\/noto-naskh-arabic\.woff2/.test(landing));
  check("icon 192 exists", existsSync(path.join(ROOT, "landing/branding/app-icon-192.png")));
  check("icon 512 exists", existsSync(path.join(ROOT, "landing/branding/app-icon-512.png")));
  check("local font file exists", existsSync(path.join(ROOT, "landing/fonts/noto-naskh-arabic.woff2")));
  check("Windows Setup download URL", landing.includes("releases/latest/download/PDFStudio-Setup.exe"));
  check("no Portable download URL (owner policy)", !/PDFStudio-Portable/i.test(landing));
  check("no Linux AppImage download URL (owner policy)", !/AppImage/i.test(landing));
  check("hero copy is Windows-only", /Windows 10 \/ 11/.test(landing) && !/Windows 10 \/ 11 و Linux/.test(landing));
});

group("pages.yml", () => {
  check("deploys the landing folder", /path:\s*landing/.test(pagesYml));
  check("runs on main", /branches:[\s\S]*main/.test(pagesYml));
  check("uses GitHub Pages actions", /actions\/upload-pages-artifact/.test(pagesYml) && /actions\/deploy-pages/.test(pagesYml));
});

group("release.yml", () => {
  check("triggers on v* tags", /tags:[\s\S]*v\*/.test(releaseYml));
  check("Windows runner", /windows-latest/.test(releaseYml));
  check("publishes Windows NSIS only", /electron-builder --win nsis/.test(releaseYml));
  check("no Linux release job", !/ubuntu-latest/.test(releaseYml));
  check("publishes with electron-builder", /electron-builder/.test(releaseYml) && /--publish always/.test(releaseYml));
});

group("electron-updater silent + relaunch", () => {
  check(
    "gated on app.isPackaged",
    /!app\.isPackaged/.test(mainCjs) &&
      (/if\s*\(\s*!app\.isPackaged\s*&&\s*runMode\s*===\s*"ui"\s*\)\s*return/.test(mainCjs) ||
        /!app\.isPackaged\s*\|\|\s*!autoUpdater/.test(mainCjs))
  );
  check("silent download", /autoUpdater\.autoDownload\s*=\s*true/.test(mainCjs));
  check("autoInstallOnAppQuit disabled (we force relaunch)", /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/.test(mainCjs));
  check("helper uses quitAndInstall(true, true)", /quitAndInstall\(\s*true\s*,\s*true\s*\)/.test(mainCjs));
  check("no quitAndInstall(true, false) paths", !/quitAndInstall\(\s*true\s*,\s*false\s*\)/.test(mainCjs));
  check("installDownloadedUpdateAndRelaunch helper exists", /function installDownloadedUpdateAndRelaunch\s*\(/.test(mainCjs));
  check("background-update flag exists", /BACKGROUND_UPDATE_FLAG\s*=\s*"--background-update"/.test(mainCjs));
  check("preload exposes status + restart", /onUpdateStatus/.test(preload) && /restartToUpdate/.test(preload));
  check("renderer asks to restart", /restartToUpdate/.test(updater) && /إعادة التشغيل/.test(updater));
});

console.log(`\npublish: ${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
