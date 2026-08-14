/**
 * Downloads the app's typefaces once and stores them under assets/fonts so the
 * app renders identically with no network. Run again only to change the faces.
 *
 * Google Fonts CSS API is used as a *download* source. The app itself never
 * references fonts.googleapis.com — only local woff2 via assets/css/fonts.css.
 */
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "fonts");
const CSS_OUT = path.join(ROOT, "assets", "css", "fonts.css");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

/** Google Fonts faces — one woff2 per (family, axis, subset, unicode-range slice). */
const GOOGLE_FACES = [
  { family: "Amiri", axis: "wght@400;700", slug: "amiri", subsets: ["arabic", "latin"] },
  { family: "Noto Sans Arabic", axis: "wght@400..700", slug: "noto-sans-arabic", subsets: ["arabic"] },
  { family: "Noto Naskh Arabic", axis: "wght@400..700", slug: "noto-naskh-arabic", subsets: ["arabic"] },
  { family: "Playfair Display", axis: "wght@400..800", slug: "playfair-display", subsets: ["latin", "latin-ext"] }
];

/**
 * Geist is not on Google Fonts. Pull the variable files from fontsource
 * (jsDelivr), which vendors the official Vercel OFL release.
 */
const GEIST_FILES = [
  {
    family: "Geist",
    slug: "geist-latin",
    weight: "100 900",
    style: "normal",
    range:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    urls: [
      "https://cdn.jsdelivr.net/fontsource/fonts/geist:vf@5.2.5/latin-wght-normal.woff2",
      "https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.2.5/files/geist-latin-wght-normal.woff2"
    ]
  },
  {
    family: "Geist",
    slug: "geist-latin-ext",
    weight: "100 900",
    style: "normal",
    range:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    urls: [
      "https://cdn.jsdelivr.net/fontsource/fonts/geist:vf@5.2.5/latin-ext-wght-normal.woff2",
      "https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.2.5/files/geist-latin-ext-wght-normal.woff2"
    ]
  }
];

const KEEP_PREFIXES = [
  "amiri-",
  "noto-sans-arabic-",
  "noto-naskh-arabic-",
  "playfair-display-",
  "geist-"
];

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseFaces(css) {
  const blocks = css.split("@font-face").slice(1);
  return blocks.map((block) => ({
    family: /font-family:\s*'([^']+)'/.exec(block)?.[1] ?? "",
    style: /font-style:\s*([^;]+)/.exec(block)?.[1]?.trim() ?? "normal",
    weight: /font-weight:\s*([^;]+)/.exec(block)?.[1]?.trim() ?? "400",
    range: /unicode-range:\s*([^;]+)/.exec(block)?.[1]?.trim() ?? "",
    url: /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1] ?? ""
  }));
}

function faceRule({ family, style, weight, file, range }) {
  return [
    "@font-face {",
    `  font-family: '${family}';`,
    `  font-style: ${style};`,
    `  font-weight: ${weight};`,
    "  font-display: swap;",
    `  src: url('../fonts/${file}') format('woff2');`,
    range ? `  unicode-range: ${range};` : null,
    "}"
  ]
    .filter(Boolean)
    .join("\n");
}

async function downloadFirst(urls, dest) {
  if (existsSync(dest)) return;
  let lastError = null;
  for (const url of urls) {
    try {
      const buf = await fetchBuffer(url);
      await writeFile(dest, buf);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`all mirrors failed for ${dest}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const rules = [];

  for (const face of GOOGLE_FACES) {
    for (const subset of face.subsets) {
      const query = `family=${face.family.replace(/ /g, "+")}:${face.axis}&display=swap&subset=${subset}`;
      const css = await fetchText(`https://fonts.googleapis.com/css2?${query}`);
      const parsed = parseFaces(css).filter((entry) => entry.url);
      let index = 0;
      for (const entry of parsed) {
        const name = `${face.slug}-${subset}-${index}.woff2`;
        const dest = path.join(OUT, name);
        if (!existsSync(dest)) {
          const res = await fetch(entry.url, { headers: { "User-Agent": UA } });
          if (!res.ok) throw new Error(`${res.status} ${entry.url}`);
          await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        }
        rules.push(
          faceRule({
            family: entry.family,
            style: entry.style,
            weight: entry.weight,
            file: name,
            range: entry.range
          })
        );
        index += 1;
      }
      console.log(`fonts: ${face.family} (${subset}) — ${parsed.length} files`);
    }
  }

  for (const face of GEIST_FILES) {
    const name = `${face.slug}.woff2`;
    await downloadFirst(face.urls, path.join(OUT, name));
    rules.push(
      faceRule({
        family: face.family,
        style: face.style,
        weight: face.weight,
        file: name,
        range: face.range
      })
    );
    console.log(`fonts: Geist (${face.slug})`);
  }

  const header = "/* Generated by scripts/fetch-fonts.mjs — do not edit by hand. */\n";
  await writeFile(CSS_OUT, `${header}\n${rules.join("\n\n")}\n`, "utf8");
  console.log(`fonts: wrote assets/css/fonts.css (${rules.length} faces)`);

  const kept = [];
  for (const file of await readdir(OUT)) {
    if (!file.endsWith(".woff2")) continue;
    if (KEEP_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      kept.push(file);
      continue;
    }
    await unlink(path.join(OUT, file));
    console.log(`fonts: removed stale ${file}`);
  }
  console.log(`fonts: ${kept.length} files kept`);
}

main().catch((error) => {
  console.error("fetch-fonts failed:", error.message);
  process.exit(1);
});
