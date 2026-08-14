import { el } from "./dom.js";
import { initPdfEngines } from "./pdf/core.js";
import { initFeedback, toast } from "./ui/feedback.js";
import { enterHub, initHub } from "./ui/hub.js";
import { guardWindowDrops } from "./ui/intake.js";
import { initKeys } from "./ui/keys.js";
import { initRouter, registerTools } from "./ui/router.js";
import { initTheme } from "./ui/theme.js";
import { initTitleBlock } from "./ui/titleblock.js";

/** @param {typeof import("./tools/crop/manifest.js").default} manifest */
function wiredManifest(manifest) {
  return {
    id: manifest.id,
    name: manifest.name || manifest.title,
    icon: manifest.icon,
    input: manifest.input,
    actionLabel: manifest.actionLabel,
    outputName: manifest.outputName,
    setup: () => manifest.mount(),
    enter: () => manifest.enter(),
    leave: () => manifest.leave?.(),
    run: () => manifest.run(),
    acceptFiles: (files) => manifest.acceptFiles?.(files)
  };
}

/** @type {import("./ui/router.js").Tool} */
const startTool = {
  id: "start",
  name: "البداية",
  icon: "icon-app",
  input: "",
  op: "—",
  hidden: true,
  setup: initHub,
  enter: enterHub
};

/**
 * One failed tool module must not take down drop, theme, or the rest of the hub.
 * @type {Array<[string, () => Promise<import("./ui/router.js").Tool>]>}
 */
const TOOL_LOADERS = [
  ["scan", () => import("./tools/scan.js").then((m) => m.scanTool)],
  ["images", () => import("./tools/images.js").then((m) => m.imagesTool)],
  ["merge", () => import("./tools/merge.js").then((m) => m.mergeTool)],
  ["organize", () => import("./tools/organize.js").then((m) => m.organizeTool)],
  ["split", () => import("./tools/split.js").then((m) => m.splitTool)],
  ["compress", () => import("./tools/compress.js").then((m) => m.compressTool)],
  ["watermark", () => import("./tools/watermark.js").then((m) => m.watermarkTool)],
  ["numbers", () => import("./tools/numbers.js").then((m) => m.numbersTool)],
  ["rasterize", () => import("./tools/rasterize.js").then((m) => m.rasterizeTool)],
  ["sign", () => import("./tools/sign/manifest.js").then((m) => m.asTool())],
  ["protect", () => import("./tools/protect/manifest.js").then((m) => m.protectTool)],
  ["crop", () => import("./tools/crop/manifest.js").then((m) => wiredManifest(m.default))],
  ["extract-images", () => import("./tools/extract-images/manifest.js").then((m) => m.extractImagesTool)],
  ["ocr", () => import("./tools/ocr/manifest.js").then((m) => wiredManifest(m.default))]
];

async function loadTools() {
  const loaded = await Promise.all(
    TOOL_LOADERS.map(async ([id, load]) => {
      try {
        const tool = await load();
        if (!tool?.id) throw new Error("missing tool id");
        return tool;
      } catch (error) {
        console.error(`تعذّر تحميل الأداة ${id}`, error);
        return null;
      }
    })
  );
  return loaded.filter(Boolean);
}

async function boot() {
  try {
    initPdfEngines();
  } catch (error) {
    console.error(error);
    document.body.innerHTML =
      '<p style="padding:2rem;font:1rem system-ui">تعذّر تحميل مكوّنات PDF. شغّل الأمر npm install ثم أعد فتح التطبيق.</p>';
    return;
  }

  initFeedback();
  initTitleBlock();
  initTheme(/** @type {HTMLButtonElement | null} */ (el("theme-toggle")));
  guardWindowDrops();
  initKeys();

  const tools = [startTool];
  try {
    tools.push(...(await loadTools()));
  } catch (error) {
    console.error(error);
  }

  registerTools(tools);
  initRouter();

  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.name === "CancelledError") {
      event.preventDefault();
      return;
    }
    console.error(event.reason);
    toast("حدث خطأ غير متوقع. راجع وحدة التحكّم للتفاصيل.", "error");
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot());
else void boot();
