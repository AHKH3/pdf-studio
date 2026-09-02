import { el, yieldToUi } from "../dom.js";
import { baseName, humanSize, saveFile, withExtension } from "../lib/files.js";
import { hexToRgb, lib, loadWritable, textToPng } from "../pdf/core.js";
import { confirmDiscard, confirmReplace } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, updateProgress } from "../ui/feedback.js";
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

const INPUTS = [
  "numbers-template",
  "numbers-position",
  "numbers-start",
  "numbers-size",
  "numbers-margin",
  "numbers-color",
  "numbers-skip-first"
];

const TEMPLATES = {
  plain: (n) => `${n}`,
  dash: (n) => `- ${n} -`,
  total: (n, total) => `${n} / ${total}`,
  brackets: (n) => `[ ${n} ]`,
  page: (n) => `صفحة ${n}`
};

function settings() {
  const value = (id) => /** @type {HTMLInputElement} */ (el(id)).value;
  return {
    template: value("numbers-template"),
    position: value("numbers-position"),
    start: Math.max(1, Number(value("numbers-start")) || 1),
    size: Math.min(64, Math.max(8, Number(value("numbers-size")) || 16)),
    margin: Math.min(120, Math.max(12, Number(value("numbers-margin")) || 34)),
    color: value("numbers-color"),
    skipFirst: /** @type {HTMLInputElement} */ (el("numbers-skip-first")).checked
  };
}

function place(config, pageIndex, pageWidth, pageHeight, textWidth, textHeight) {
  let position = config.position;
  if (position === "bottom-outer") {
    position = (pageIndex + 1) % 2 === 1 ? "bottom-left" : "bottom-right";
  }
  const top = position.startsWith("top");
  const y = top ? pageHeight - config.margin - textHeight : config.margin;
  const x = position.endsWith("right")
    ? pageWidth - config.margin - textWidth
    : position.endsWith("left")
      ? config.margin
      : (pageWidth - textWidth) / 2;
  return { x, y };
}

function drawPreview() {
  if (!preview?.page || !doc) return;
  const config = settings();
  const label = (TEMPLATES[config.template] ?? TEMPLATES.plain)(config.start, doc.pages);
  const skip = config.skipFirst;

  preview.draw((ctx, scale) => {
    if (skip) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#000000";
      ctx.font = `500 ${13 * Math.max(1, scale * 0.9)}px "Playfair Display", "Noto Naskh Arabic", "Amiri", serif`;
      ctx.direction = "rtl";
      ctx.textAlign = "center";
      ctx.fillText("الصفحة الأولى بلا رقم", preview.canvas.width / 2, preview.canvas.height - 12);
      return;
    }
    ctx.font = `500 ${config.size * scale}px "Playfair Display", "Noto Naskh Arabic", "Amiri", serif`;
    ctx.fillStyle = config.color;
    ctx.direction = config.template === "page" ? "rtl" : "ltr";
    ctx.textBaseline = "alphabetic";
    const textWidth = ctx.measureText(label).width;
    const textHeight = config.size * scale;
    const spot = place(config, 0, preview.canvas.width, preview.canvas.height, textWidth, textHeight);
    ctx.fillText(label, spot.x, preview.canvas.height - spot.y - textHeight * 0.2);
  });
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  saved = false;
  redrawTimer = window.setTimeout(drawPreview, 90);
}

function syncNote() {
  const note = el("numbers-note");
  if (!note) return;
  const arabic = /** @type {HTMLSelectElement} */ (el("numbers-template")).value === "page";
  note.textContent = arabic
    ? "النمط العربي يُرسم كصورة صغيرة على كل صفحة (الخطوط القياسية داخل PDF لا تدعم العربية)، فيستغرق وقتاً أطول ولا يكون قابلاً للبحث."
    : "الأرقام تُكتب كنص حقيقي داخل الملف، فتبقى قابلة للبحث والنسخ.";
}

function showDoc() {
  el("numbers-panel").hidden = false;
  el("numbers-drop").hidden = true;
  setSource({ label: doc.name, pages: String(doc.pages), size: humanSize(doc.size) });
  setName(`${baseName(doc.name)}-مرقّم.pdf`);
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
  el("numbers-panel").hidden = true;
  el("numbers-drop").hidden = false;
  setSource({});
  setRunEnabled(false);
  setState("waiting");
}

async function requestClear() {
  if (!doc) return;
  if (!(await confirmDiscard(numbersTool.name))) return;
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
  if (!(await confirmLarge(doc.pages, "ترقيم الصفحات"))) return;
  const config = settings();
  const { StandardFonts, degrees } = lib();
  const arabic = config.template === "page";
  const isNonWinAnsi = (text) => /[^\u0020-\u007E]/.test(text);

  setState("busy");
  startProgress({ title: "ترقيم الصفحات", desc: arabic ? "نرسم رقماً عربياً على كل صفحة." : "نكتب الأرقام داخل الملف." });
  try {
    const target = await loadWritable(doc.bytes);
    const pages = target.getPages();
    let font = null;
    const color = hexToRgb(config.color);
    const total = pages.length;
    const build = TEMPLATES[config.template] ?? TEMPLATES.plain;
    let printed = 0;

    for (const [index, page] of pages.entries()) {
      throwIfCancelled();
      if (config.skipFirst && index === 0) continue;
      await yieldToUi();
      updateProgress({ percent: (index / total) * 100, detail: `صفحة ${index + 1} من ${total}` });

      const label = build(config.start + index - (config.skipFirst ? 1 : 0), total);
      const { width, height } = page.getSize();
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      const isSideways = angle === 90 || angle === 270;
      const visualW = isSideways ? height : width;
      const visualH = isSideways ? width : height;

      const needsImage = arabic || isNonWinAnsi(label);
      if (needsImage) {
        const png = await textToPng(label, { size: config.size, color: config.color, angle: 0, opacity: 1 });
        const image = await target.embedPng(png);
        const stampWidth = image.width / 3;
        const stampHeight = image.height / 3;
        const spot = place(config, index, visualW, visualH, stampWidth, stampHeight);
        let px = spot.x;
        let py = spot.y;
        let rot = 0;
        if (angle === 90) {
          px = width - spot.y;
          py = spot.x;
          rot = 90;
        } else if (angle === 180) {
          px = width - spot.x;
          py = height - spot.y;
          rot = 180;
        } else if (angle === 270) {
          px = spot.y;
          py = height - spot.x;
          rot = 270;
        }
        page.drawImage(image, {
          x: px,
          y: py,
          width: stampWidth,
          height: stampHeight,
          rotate: rot && degrees ? degrees(rot) : undefined
        });
      } else {
        if (!font) font = await target.embedFont(StandardFonts.Helvetica);
        const textWidth = font.widthOfTextAtSize(label, config.size);
        const spot = place(config, index, visualW, visualH, textWidth, config.size);
        let px = spot.x;
        let py = spot.y;
        let rot = 0;
        if (angle === 90) {
          px = width - spot.y;
          py = spot.x;
          rot = 90;
        } else if (angle === 180) {
          px = width - spot.x;
          py = height - spot.y;
          rot = 180;
        } else if (angle === 270) {
          px = spot.y;
          py = height - spot.x;
          rot = 270;
        }
        page.drawText(label, {
          x: px,
          y: py,
          size: config.size,
          font,
          color,
          rotate: rot && degrees ? degrees(rot) : undefined
        });
      }
      printed += 1;
    }

    throwIfCancelled();
    updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, `تم ترقيم ${printed} صفحة.`);
  } catch (error) {
    reportFailure(error, "تعذّر الترقيم.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const numbersTool = {
  id: "numbers",
  name: "ترقيم",
  icon: "icon-numbers",
  input: "PDF",
  actionLabel: "ترقيم",

  setup() {
    preview = new PagePreview("numbers-canvas");
    wireIntake({
      dropId: "numbers-drop",
      inputId: "numbers-input",
      browseId: "numbers-browse",
      accept: "pdf",
      onFiles: load
    });
    for (const id of INPUTS) {
      el(id)?.addEventListener("input", () => {
        syncNote();
        scheduleRedraw();
      });
    }
    el("numbers-clear")?.addEventListener("click", requestClear);
    syncNote();
  },

  enter() {
    if (doc) {
      showDoc();
      drawPreview();
    } else {
      clear();
    }
    syncNote();
  },
  isDirty: () => Boolean(doc) && !saved,
  acceptFiles,
  run
};
