/**
 * Rebuilds the inline SVG sprite in index.html from Hugeicons Stroke Rounded paths.
 * Run: node scripts/generate-icon-sprite.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICON_MAP = {
  "icon-app": "DraftingCompassIcon",
  "icon-index": "GridTableIcon",
  "icon-scan": "ScanImageIcon",
  "icon-images": "Image01Icon",
  "icon-merge": "GitMergeIcon",
  "icon-organize": "Layers01Icon",
  "icon-split": "SplitIcon",
  "icon-compress": "ArrowShrink02Icon",
  "icon-watermark": "Stamp01Icon",
  "icon-numbers": "LeftToRightListNumberIcon",
  "icon-pdf-to-images": "ImageDownloadIcon",
  "icon-sun": "Sun03Icon",
  "icon-moon": "Moon02Icon",
  "icon-upload": "Upload04Icon",
  "icon-download": "Download04Icon",
  "icon-trash": "Delete02Icon",
  "icon-grip": "DragDropVerticalIcon",
  "icon-rotate": "RotateClockwiseIcon",
  "icon-file": "File01Icon",
  "icon-check": "CheckmarkCircle02Icon",
  "icon-alert": "AlertCircleIcon",
  "icon-close": "Cancel01Icon",
  "icon-crop": "CropIcon",
  "icon-ruler": "RulerIcon",
  "icon-zip": "Zip01Icon",
  "icon-arrow": "ArrowLeft01Icon",
  "icon-plus": "PlusSignIcon",
  "icon-enhance": "MagicWand02Icon",
  "icon-contrast": "ContrastIcon",
  "icon-quad": "VectorSquareIcon",
  "icon-lock": "SquareLock02Icon",
  "icon-edit": "PencilEdit02Icon"
};

const STRIP_ATTRS = new Set(["stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "key"]);

function camelToKebab(name) {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function attrsToString(attrs) {
  return Object.entries(attrs)
    .filter(([key]) => !STRIP_ATTRS.has(key))
    .map(([key, value]) => `${camelToKebab(key)}="${value}"`)
    .join(" ");
}

function iconToSymbol(id, iconData) {
  const children = iconData
    .map(([tag, attrs]) => {
      const attrStr = attrsToString(attrs);
      return attrStr ? `<${tag} ${attrStr}/>` : `<${tag}/>`;
    })
    .join("");
  return `    <symbol id="${id}" viewBox="0 0 24 24">${children}</symbol>`;
}

const root = dirname(fileURLToPath(import.meta.url));

const symbols = [];
for (const [id, moduleName] of Object.entries(ICON_MAP)) {
  const mod = await import(`@hugeicons/core-free-icons/${moduleName}`);
  const data = mod.default ?? mod[moduleName];
  if (!Array.isArray(data)) throw new Error(`Unexpected icon shape for ${moduleName}`);
  symbols.push(iconToSymbol(id, data));
}

const spriteBlock = `<svg class="sprite" aria-hidden="true">\n${symbols.join("\n")}\n  </svg>`;

const indexPath = join(root, "..", "index.html");
const html = readFileSync(indexPath, "utf8");
const spritePattern = /<svg class="sprite" aria-hidden="true">[\s\S]*?<\/svg>/;
if (!spritePattern.test(html)) {
  console.error("Could not find the sprite block in index.html");
  process.exit(1);
}
writeFileSync(indexPath, html.replace(spritePattern, spriteBlock), "utf8");
console.log(`icons: wrote ${symbols.length} symbols into index.html`);
