/**
 * Guards the publish channel: static landing (GitHub Pages, no third-party
 * services), tag-driven GitHub Releases (Win NSIS+Portable + Linux AppImage),
 * and electron-updater for installed builds only.
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

group("package.json", () => {
  check("version is 1.0.14", pkg.version === "1.0.14", pkg.version);
  check(
    "description is Arabic UTF-8",
    pkg.description.includes("أدوات PDF") && pkg.description.includes("سطح مكتب"),
    JSON.stringify(pkg.description)
  );
  check("electron-updater is a runtime dependency", Boolean(pkg.dependencies?.["electron-updater"]));
  check("publish provider is GitHub AHKH3/pdf-studio", pkg.build?.publish?.provider === "github" && pkg.build.publish.owner === "AHKH3" && pkg.build.publish.repo === "pdf-studio");
  const winTargets = pkg.build?.win?.target || [];
  check("Windows targets include NSIS", winTargets.includes("nsis"));
  check("Windows targets include Portable", winTargets.includes("portable"));
  check("NSIS artifact is PDFStudio-Setup", pkg.build?.nsis?.artifactName === "PDFStudio-Setup.${ext}");
  check("Portable artifact is PDFStudio-Portable", pkg.build?.portable?.artifactName === "PDFStudio-Portable.${ext}");
  check("win-level artifactName is unset (avoids colliding Setup/Portable names)", !pkg.build?.win?.artifactName);
  const linuxTargets = pkg.build?.linux?.target || [];
  check("Linux target is AppImage", linuxTargets.includes("AppImage"));
  check("Linux artifact is PDFStudio.${ext}", pkg.build?.linux?.artifactName === "PDFStudio.${ext}");
  check("dist:linux script exists", typeof pkg.scripts?.["dist:linux"] === "string");
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
  check("Windows Portable download URL", landing.includes("releases/latest/download/PDFStudio-Portable.exe"));
  check("Linux AppImage download URL", landing.includes("releases/latest/download/PDFStudio.AppImage"));
});

group("pages.yml", () => {
  check("deploys the landing folder", /path:\s*landing/.test(pagesYml));
  check("runs on main", /branches:[\s\S]*main/.test(pagesYml));
  check("uses GitHub Pages actions", /actions\/upload-pages-artifact/.test(pagesYml) && /actions\/deploy-pages/.test(pagesYml));
});

group("release.yml", () => {
  check("triggers on v* tags", /tags:[\s\S]*v\*/.test(releaseYml));
  check("Windows runner", /windows-latest/.test(releaseYml));
  check("Linux runner", /ubuntu-latest/.test(releaseYml));
  check("publishes with electron-builder", /electron-builder/.test(releaseYml) && /--publish always/.test(releaseYml));
});

group("electron-updater (packaged only)", () => {
  check("gated on app.isPackaged", /if\s*\(\s*!app\.isPackaged\s*\|\|\s*!autoUpdater\s*\)\s*return/.test(mainCjs));
  check("silent download", /autoUpdater\.autoDownload\s*=\s*true/.test(mainCjs));
  check("install on quit", /autoUpdater\.autoInstallOnAppQuit\s*=\s*true/.test(mainCjs));
  check("preload exposes status + restart", /onUpdateStatus/.test(preload) && /restartToUpdate/.test(preload));
  check("renderer asks to restart", /restartToUpdate/.test(updater) && /إعادة التشغيل/.test(updater));
});

console.log(`\npublish: ${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
