import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, saveFile, withExtension } from "../lib/files.js";
import { loadWritable, textToPng } from "../pdf/core.js";
import { confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { PagePreview } from "./preview.js";
import { confirmLarge, readPdfFile, reportFailure, reportSave } from "./shared.js";

/** @type {{ name: string; bytes: Uint8Array; pages: number; size: number; password: string } | null} */
let doc = null;
/** @type {PagePreview | null} */
let preview = null;
let redrawTimer = 0;
let saved = true;

const INPUTS = ["watermark-text", "watermark-position", "watermark-opacity", "watermark-size", "watermark-angle", "watermark-color"];

function settings() {
  const value = (id) => /** @type {HTMLInputElement} */ (el(id)).value;
  return {
    text: value("watermark-text").trim(),
    position: value("watermark-position"),
    opacity: Math.min(1, Math.max(0.05, (Number(value("watermark-opacity")) || 18) / 100)),
    size: Math.min(220, Math.max(16, Number(value("watermark-size")) || 76)),
    angle: Math.min(90, Math.max(-90, Number(value("watermark-angle")) || 0)),
    color: value("watermark-color")
  };
}

function placements(config, pageWidth, pageHeight, stampWidth, stampHeight) {
  const inset = Math.min(pageWidth, pageHeight) * 0.06;
  const centred = { x: (pageWidth - stampWidth) / 2, y: (pageHeight - stampHeight) / 2 };

  switch (config.position) {
    case "top-right":
      return [{ x: pageWidth - stampWidth - inset, y: pageHeight - stampHeight - inset }];
    case "top-left":
      return [{ x: inset, y: pageHeight - stampHeight - inset }];
    case "bottom-right":
      return [{ x: pageWidth - stampWidth - inset, y: inset }];
    case "bottom-left":
      return [{ x: inset, y: inset }];
    case "tile": {
      const stepX = Math.max(stampWidth * 1.35, pageWidth / 3);
      const stepY = Math.max(stampHeight * 2.4, pageHeight / 5);
      const spots = [];
      for (let y = -stampHeight; y < pageHeight + stampHeight; y += stepY) {
        for (let x = -stampWidth; x < pageWidth + stampWidth; x += stepX) {
          spots.push({ x, y });
        }
      }
      return spots;
    }
    default:
      return [centred];
  }
}

function drawPreview() {
  if (!preview?.page) return;
  const config = settings();
  if (!config.text) {
    preview.draw();
    return;
  }

  preview.draw((ctx, scale) => {
    const font = `600 ${config.size * scale}px "Playfair Display", "Noto Naskh Arabic", serif`;
    ctx.font = font;
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = config.color;
    ctx.globalAlpha = config.opacity;

    const textWidth = ctx.measureText(config.text).width;
    const boxWidth = textWidth + config.size * scale;
    const boxHeight = config.size * scale * 1.9;
    const radians = (config.angle * Math.PI) / 180;
    const stampWidth = Math.abs(boxWidth * Math.cos(radians)) + Math.abs(boxHeight * Math.sin(radians));
    const stampHeight = Math.abs(boxWidth * Math.sin(radians)) + Math.abs(boxHeight * Math.cos(radians));

    const spots = placements(config, preview.canvas.width, preview.canvas.height, stampWidth, stampHeight);
    for (const spot of spots) {
      ctx.save();
      ctx.translate(spot.x + stampWidth / 2, preview.canvas.height - (spot.y + stampHeight / 2));
      ctx.rotate(-radians);
      ctx.fillText(config.text, 0, 0);
      ctx.restore();
    }
  });
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  saved = false;
  redrawTimer = window.setTimeout(drawPreview, 90);
}

function showDoc() {
  el("watermark-panel").hidden = false;
  el("watermark-drop").hidden = true;
  setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
  setName(`${baseName(doc.name)}-بعلامة.pdf`);
  setRunEnabled(true);
  setState("idle");
}

/** @param {File[]} files */
async function load(files) {
  const file = files[0];
  if (!file) return;
  if (doc && !(await confirmReplace(doc.name))) return;

  const loaded = await readPdfFile(file);
  if (!loaded) return;

  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    doc = loaded;
    saved = false;
    showDoc();
    await preview.load(loaded.bytes, loaded.password);
    drawPreview();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

function clear() {
  doc = null;
  saved = true;
  preview?.reset();
  el("watermark-panel").hidden = true;
  el("watermark-drop").hidden = false;
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function requestClear() {
  if (!doc) return;
  if (!(await confirmDiscard(watermarkTool.name))) return;
  clear();
}

async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clear();
  await load([file]);
}

async function run() {
  if (!doc) return;
  const config = settings();
  if (!config.text) {
    setState("error", "اكتب النص");
    toast("اكتب نص العلامة المائية أولاً.", "info");
    el("watermark-text")?.focus();
    return;
  }
  if (!(await confirmLarge(doc.pages, "إضافة العلامة"))) return;

  setState("busy");
  startProgress({ title: "إضافة العلامة المائية", desc: "نرسم النص فوق كل صفحة." });
  try {
    const png = await textToPng(config.text, {
      size: config.size,
      color: config.color,
      angle: config.angle,
      opacity: config.opacity
    });

    const target = await loadWritable(doc.bytes);
    const stamp = await target.embedPng(png);
    const stampWidth = stamp.width / 3;
    const stampHeight = stamp.height / 3;
    const pages = target.getPages();

    for (const [index, page] of pages.entries()) {
      throwIfCancelled();
      if (index % 4 === 0) await yieldToUi();
      if (index % 4 === 0) {
        updateProgress({ percent: (index / pages.length) * 100, detail: `صفحة ${index + 1} من ${pages.length}` });
      }
      const { width, height } = page.getSize();
      for (const spot of placements(config, width, height, stampWidth, stampHeight)) {
        page.drawImage(stamp, { x: spot.x, y: spot.y, width: stampWidth, height: stampHeight });
      }
    }

    throwIfCancelled();
    updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, `تمت إضافة العلامة على ${pages.length} صفحة.`);
  } catch (error) {
    reportFailure(error, "تعذّرت إضافة العلامة المائية.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const watermarkTool = {
  id: "watermark",
  name: "علامة",
  icon: "icon-watermark",
  input: "PDF",
  actionLabel: "ختم",

  setup() {
    preview = new PagePreview("watermark-canvas");
    wireIntake({
      dropId: "watermark-drop",
      inputId: "watermark-input",
      browseId: "watermark-browse",
      accept: "pdf",
      onFiles: load
    });
    for (const id of INPUTS) el(id)?.addEventListener("input", scheduleRedraw);
    el("watermark-clear")?.addEventListener("click", requestClear);
  },

  enter() {
    if (doc) {
      showDoc();
      drawPreview();
    } else {
      clear();
    }
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
