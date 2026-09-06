"use strict";
// afterPack hook: stamp the Windows exe with our icon + product metadata.
//
// Why not electron-builder's built-in editing? `signAndEditExecutable` is
// false in package.json because electron-builder's winCodeSign bundle cannot
// be extracted on machines without symlink privileges (its darwin dylib
// entries fail with "A required privilege is not held by the client").
// This hook performs the same resource edit with the standalone `rcedit`
// binary (devDependency, no symlinks, no signing involved) so the shipped
// exe — taskbar, title bar, shortcuts, installer file properties — never
// shows the default Electron icon or "Electron" version strings.
const path = require("path");

async function applyExeIcon(context) {
  if (context.electronPlatformName !== "win32") return;
  const root = path.join(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));
  const productName = pkg.productName || pkg.name;
  const exeName =
    (context.packager &&
      context.packager.appInfo &&
      context.packager.appInfo.productFilename) ||
    productName;
  const exe = path.join(context.appOutDir, `${exeName}.exe`);
  const { rcedit } = await import("rcedit");
  await rcedit(exe, {
    icon: path.join(root, "build", "icon.ico"),
    "file-version": pkg.version,
    "product-version": pkg.version,
    "version-string": {
      CompanyName: pkg.author || "",
      FileDescription: productName,
      InternalName: `${exeName}.exe`,
      OriginalFilename: `${exeName}.exe`,
      ProductName: productName
    }
  });
  console.log(`[afterPack] stamped exe icon + version info: ${exe}`);
}

exports.default = applyExeIcon;
