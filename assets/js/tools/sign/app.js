import { baseName, humanSize, isImageFile, isPdfFile, readBytes, saveFile, withExtension } from "../../lib/files.js";
import { endProgress, isCancellation, startProgress, toast } from "../../ui/feedback.js";
import { getName, setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { reportFailure as reportFailureToChrome, reportSave as reportSaveToChrome, uid } from "../shared.js";
import { flattenStamps } from "./flatten.js";
import { attachPad } from "./pad.js";
import { canvasToTrimmedPng, rasterizeImageFile, renderTextPng } from "./png.js";
import { createBoard } from "./preview.js";
import { buildUi, formatStampDate, injectStyles, removeStyles, todayInputValue } from "./ui.js";

export const id = "sign";
export const title = "توقيع وختم";

const KIND_LABEL = {
  draw: "توقيع مرسوم",
  name: "نص",
  image: "صورة",
  date: "تاريخ"
};

/** @typedef {{
 *   id: string;
 *   kind: "draw" | "name" | "image" | "date";
 *   pageIndex: number;
 *   x: number; y: number; width: number; height: number; aspect: number;
 *   png: Uint8Array;
 *   url: string;
 *   label: string;
 * }} Stamp */

const session = {
  /** @type {HTMLElement | null} */
  root: null,
  /** @type {AbortController | null} */
  ac: null,
  /** @type {ReturnType<typeof buildUi> | null} */
  ui: null,
  /** @type {ReturnType<typeof createBoard> | null} */
  board: null,
  /** @type {ReturnType<typeof attachPad> | null} */
  pad: null,
  fileName: "",
  /** @type {Uint8Array | null} */
  bytes: null,
  pages: 0,
  size: 0,
  pageIndex: 0,
  /** @type {Stamp[]} */
  stamps: [],
  selectedId: "",
  /** @type {{ bytes: Uint8Array; width: number; height: number; name: string } | null} */
  pendingImage: null
};

function hasTitleblock() {
  return Boolean(document.getElementById("tb-run"));
}

/** @param {unknown} error @param {string} fallbackMessage */
function reportFailure(error, fallbackMessage) {
  if (!hasTitleblock()) {
    if (isCancellation(error)) {
      toast("تم إيقاف العملية.", "info");
      return;
    }
    console.error(error);
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    toast(`${fallbackMessage}${detail}`, "error");
    return;
  }
  reportFailureToChrome(error, fallbackMessage);
}

/** @param {boolean} saved @param {string} message */
function reportSave(saved, message) {
  if (!hasTitleblock()) {
    toast(saved ? message : "أُلغي الحفظ", saved ? "done" : "info");
    return;
  }
  reportSaveToChrome(saved, message);
}

export function suggestedName() {
  const fromBlock = hasTitleblock() ? getName() : "";
  if (fromBlock) return withExtension(fromBlock, "pdf");
  return withExtension(`${baseName(session.fileName || "مستند")}-موقع`, "pdf");
}

export function syncChrome() {
  if (!hasTitleblock()) return;
  if (session.bytes) {
    setSource({
      label: session.fileName,
      pages: String(session.pages),
      size: humanSize(session.size)
    });
    setName(`${baseName(session.fileName)}-موقع.pdf`);
    setRunEnabled(session.stamps.length > 0);
    setState(session.stamps.length ? "idle" : "waiting");
  } else {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
  }
}

function activeTool() {
  const picked = session.root?.querySelector('input[name="sign-tool"]:checked');
  return /** @type {HTMLInputElement | null} */ (picked)?.value || "draw";
}

function showToolPanels() {
  const tool = activeTool();
  for (const panel of session.root?.querySelectorAll("[data-sign-panel]") ?? []) {
    /** @type {HTMLElement} */ (panel).hidden = panel.getAttribute("data-sign-panel") !== tool;
  }
  if (tool === "draw" && session.ui?.workspace && !session.ui.workspace.hidden && !session.pad?.isDirty()) {
    session.pad?.fit();
  }
}

function revokeUrl(url) {
  if (!url) return;
  if (session.stamps.some((stamp) => stamp.url === url)) return;
  URL.revokeObjectURL(url);
}

function renderList() {
  const host = session.ui?.list;
  if (!host) return;
  host.replaceChildren();
  const onPage = session.stamps.filter((stamp) => stamp.pageIndex === session.pageIndex);
  if (!onPage.length) {
    const empty = document.createElement("p");
    empty.className = "sign-list__empty";
    empty.textContent = "لا أختام على هذه الصفحة بعد. أنشئ ختماً ثم اضغط «ضع».";
    host.append(empty);
    return;
  }
  for (const stamp of onPage) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sign-list__item" + (stamp.id === session.selectedId ? " is-current" : "");
    button.dataset.id = stamp.id;
    button.textContent = stamp.label;
    host.append(button);
  }
}

function refresh(overlay = true) {
  if (overlay) session.board?.paintOverlay();
  renderList();
  if (session.ui?.count) {
    session.ui.count.textContent = `${session.pageIndex + 1} / ${session.pages || 1}`;
  }
  if (session.ui?.prev) session.ui.prev.disabled = session.pageIndex <= 0;
  if (session.ui?.next) session.ui.next.disabled = session.pageIndex >= session.pages - 1;
  if (session.ui?.save) session.ui.save.disabled = session.stamps.length === 0;
  if (session.ui?.copyAll) session.ui.copyAll.disabled = !session.selectedId;
  if (session.ui?.remove) session.ui.remove.disabled = !session.selectedId;
  syncChrome();
}

function pngUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

function defaultRect(width, height, pageIndex) {
  const board = session.board;
  const pageW = board?.visualWidth || 400;
  const existing = session.stamps.filter((stamp) => stamp.pageIndex === pageIndex).length;
  const offset = existing * 16;
  const stamp = {
    x: (pageW - width) / 2 + offset,
    y: 36 + offset,
    width,
    height,
    aspect: width / Math.max(1, height),
    pageIndex
  };
  board?.clampStamp(stamp);
  return stamp;
}

function sizeFromPng(widthPx, heightPx, targetWidth) {
  const aspect = widthPx / Math.max(1, heightPx);
  return { width: targetWidth, height: targetWidth / aspect, aspect };
}

/**
 * @param {object} spec
 * @param {"draw" | "name" | "image" | "date"} spec.kind
 * @param {Uint8Array} spec.png
 * @param {number} spec.widthPx
 * @param {number} spec.heightPx
 * @param {string} spec.label
 * @param {number} spec.targetWidth
 * @param {number[]} spec.pages
 */
function addStamp(spec) {
  const url = pngUrl(spec.png);
  /** @type {Stamp | null} */
  let last = null;
  for (const pageIndex of spec.pages) {
    const box = sizeFromPng(spec.widthPx, spec.heightPx, spec.targetWidth);
    const placed = defaultRect(box.width, box.height, pageIndex);
    /** @type {Stamp} */
    const stamp = {
      id: uid("sign"),
      kind: spec.kind,
      pageIndex,
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      aspect: box.aspect,
      png: spec.png,
      url,
      label: spec.label
    };
    session.stamps.push(stamp);
    last = stamp;
  }
  if (last) session.selectedId = last.id;
  refresh();
}

function pagesToStamp() {
  if (session.ui?.allPages?.checked) {
    return Array.from({ length: session.pages }, (_, index) => index);
  }
  return [session.pageIndex];
}

async function placeCurrent() {
  if (!session.bytes || !session.board) return;
  const tool = activeTool();
  const pages = pagesToStamp();
  const pageW = session.board.visualWidth || 400;

  try {
    if (tool === "draw") {
      if (!session.pad?.isDirty()) {
        toast("ارسم التوقيع على اللوحة أولاً.", "info");
        return;
      }
      const png = await canvasToTrimmedPng(session.pad.snapshot());
      addStamp({
        kind: "draw",
        png: png.bytes,
        widthPx: png.width,
        heightPx: png.height,
        label: KIND_LABEL.draw,
        targetWidth: Math.min(140, pageW * 0.42),
        pages
      });
      return;
    }

    if (tool === "name") {
      const text = session.ui.name.value.trim();
      if (!text) {
        toast("اكتب الاسم أو النص أولاً.", "info");
        return;
      }
      const size = Math.min(72, Math.max(14, Number(session.ui.nameSize.value) || 28));
      const png = await renderTextPng(text, { color: session.ui.nameColor.value, fontSize: size });
      addStamp({
        kind: "name",
        png: png.bytes,
        widthPx: png.width,
        heightPx: png.height,
        label: text,
        targetWidth: Math.min(pageW * 0.7, png.width / 2),
        pages
      });
      return;
    }

    if (tool === "image") {
      if (!session.pendingImage) {
        toast("اختر صورة الختم أولاً.", "info");
        return;
      }
      const image = session.pendingImage;
      addStamp({
        kind: "image",
        png: image.bytes,
        widthPx: image.width,
        heightPx: image.height,
        label: image.name || KIND_LABEL.image,
        targetWidth: Math.min(168, pageW * 0.45),
        pages
      });
      return;
    }

    const label = formatStampDate(session.ui.date.value, /** @type {"ar" | "iso" | "eu"} */ (session.ui.dateFormat.value));
    if (!label) {
      toast("اختر تاريخاً صالحاً.", "info");
      return;
    }
    const png = await renderTextPng(label, {
      color: session.ui.dateColor.value,
      fontSize: 18,
      framed: true
    });
    addStamp({
      kind: "date",
      png: png.bytes,
      widthPx: png.width,
      heightPx: png.height,
      label,
      targetWidth: Math.min(pageW * 0.55, png.width / 2),
      pages
    });
  } catch (error) {
    reportFailure(error, "تعذّر إنشاء الختم.");
  }
}

function deleteSelected() {
  const index = session.stamps.findIndex((stamp) => stamp.id === session.selectedId);
  if (index < 0) return;
  const [removed] = session.stamps.splice(index, 1);
  session.selectedId = "";
  revokeUrl(removed.url);
  refresh();
}

function copySelectedToAll() {
  const source = session.stamps.find((stamp) => stamp.id === session.selectedId);
  if (!source) return;
  const have = new Set(
    session.stamps.filter((stamp) => stamp.png === source.png).map((stamp) => stamp.pageIndex)
  );
  let added = 0;
  for (let pageIndex = 0; pageIndex < session.pages; pageIndex += 1) {
    if (have.has(pageIndex)) continue;
    session.stamps.push({ ...source, id: uid("sign"), pageIndex });
    added += 1;
  }
  refresh();
  toast(added ? "نُسخ الختم إلى بقية الصفحات." : "الختم موجود على كل الصفحات.", added ? "done" : "info");
}

async function goTo(index) {
  if (!session.board || index < 0 || index >= session.pages) return;
  session.pageIndex = index;
  await session.board.showPage(index);
  refresh();
}

function wireIntake(signal) {
  const { drop, browse, input } = session.ui;
  const accept = (fileList) => {
    const all = Array.from(fileList || []);
    const good = all.filter(isPdfFile);
    if (good.length < all.length) toast("تم تجاهل ملفات ليست PDF.", "info");
    if (good[0]) loadFile(good[0]);
  };

  const open = () => input.click();
  browse.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      open();
    },
    { signal }
  );
  drop.addEventListener("click", open, { signal });
  drop.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    { signal }
  );
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");

  input.addEventListener(
    "change",
    () => {
      accept(input.files);
      input.value = "";
    },
    { signal }
  );

  let depth = 0;
  drop.addEventListener(
    "dragenter",
    (event) => {
      event.preventDefault();
      depth += 1;
      drop.classList.add("is-over");
    },
    { signal }
  );
  drop.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    { signal }
  );
  drop.addEventListener(
    "dragleave",
    () => {
      depth = Math.max(0, depth - 1);
      if (!depth) drop.classList.remove("is-over");
    },
    { signal }
  );
  drop.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      depth = 0;
      drop.classList.remove("is-over");
      accept(event.dataTransfer?.files);
    },
    { signal }
  );
}

async function loadFile(file) {
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    const bytes = await readBytes(file);
    await resetStamps();
    const pages = await session.board.load(bytes);
    session.fileName = file.name;
    session.bytes = bytes;
    session.pages = pages;
    session.size = file.size;
    session.pageIndex = 0;
    await session.board.showPage(0);
    session.ui.drop.hidden = true;
    session.ui.workspace.hidden = false;
    if (!session.pad?.isDirty()) session.pad?.fit();
    refresh();
  } catch (error) {
    reportFailure(error, "تعذّر فتح المستند.");
  } finally {
    endProgress();
  }
}

async function resetStamps() {
  const urls = new Set(session.stamps.map((stamp) => stamp.url));
  for (const url of urls) URL.revokeObjectURL(url);
  session.stamps = [];
  session.selectedId = "";
}

async function closeDocument() {
  await resetStamps();
  session.fileName = "";
  session.bytes = null;
  session.pages = 0;
  session.size = 0;
  session.pageIndex = 0;
  session.pendingImage = null;
  if (session.ui?.imageMeta) session.ui.imageMeta.textContent = "PNG أو JPG بخلفية شفافة أفضل للختم.";
  if (session.ui?.drop) session.ui.drop.hidden = false;
  if (session.ui?.workspace) session.ui.workspace.hidden = true;
  await session.board?.clear();
  refresh();
}

async function pickImage(file) {
  if (!file || !isImageFile(file)) {
    toast("اختر صورة PNG أو JPG.", "info");
    return;
  }
  try {
    session.pendingImage = { ...(await rasterizeImageFile(file)), name: file.name };
    if (session.ui?.imageMeta) session.ui.imageMeta.textContent = file.name;
  } catch (error) {
    session.pendingImage = null;
    reportFailure(error, "تعذّر قراءة الصورة.");
  }
}

function onRootKey(event) {
  const typing = event.target.closest?.("input, textarea, select, canvas");
  if (typing && event.target !== session.ui?.layer) return;

  if ((event.key === "Delete" || event.key === "Backspace") && session.selectedId) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  const step = event.shiftKey ? 8 : 1;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    session.board?.nudge(step, 0);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    session.board?.nudge(-step, 0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    session.board?.nudge(0, step);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    session.board?.nudge(0, -step);
  }
}

export async function run() {
  if (!session.bytes) {
    toast("افتح ملف PDF أولاً.", "info");
    return;
  }
  if (!session.stamps.length) {
    toast("ضع توقيعاً أو ختماً على صفحة واحدة على الأقل.", "info");
    return;
  }
  if (hasTitleblock()) setState("busy");
  startProgress({ title: "دمج التوقيع", desc: "نرسم الأختام فوق الصفحات." });
  try {
    const bytes = await flattenStamps(session.bytes, session.stamps);
    endProgress();
    const saved = await saveFile(bytes, suggestedName(), "pdf");
    reportSave(saved, `دُمج ${session.stamps.length} ختم في الملف.`);
  } catch (error) {
    reportFailure(error, "تعذّر حفظ الملف الموقّع.");
  } finally {
    endProgress();
  }
}

/** @param {HTMLElement} rootEl */
export function mount(rootEl) {
  if (!rootEl) throw new Error("sign.mount يحتاج عنصر جذر.");
  unmount();

  injectStyles();
  session.root = rootEl;
  session.ac = new AbortController();
  const { signal } = session.ac;
  session.ui = buildUi(rootEl);
  session.ui.date.value = todayInputValue();

  session.board = createBoard({
    canvas: session.ui.canvas,
    layer: session.ui.layer,
    getStamps: () => session.stamps,
    getSelectedId: () => session.selectedId,
    setSelectedId: (value) => {
      session.selectedId = value;
    },
    onChange: () => refresh(false)
  });

  session.pad = attachPad(session.ui.pad, { signal });
  wireIntake(signal);
  showToolPanels();
  refresh();

  rootEl.addEventListener("change", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target instanceof HTMLInputElement && target.name === "sign-tool") showToolPanels();
    if (target instanceof HTMLInputElement && target.name === "sign-ink") session.pad?.setColor(target.value);
    if (target === session.ui.weight) session.pad?.setWeight(session.ui.weight.value);
  }, { signal });

  rootEl.addEventListener("click", (event) => {
    const item = event.target.closest?.(".sign-list__item");
    if (item?.dataset.id) {
      session.selectedId = item.dataset.id;
      refresh();
    }
  }, { signal });

  rootEl.addEventListener("keydown", onRootKey, { signal });

  session.ui.padClear.addEventListener("click", () => session.pad?.clear(), { signal });
  session.ui.place.addEventListener("click", () => placeCurrent(), { signal });
  session.ui.copyAll.addEventListener("click", copySelectedToAll, { signal });
  session.ui.remove.addEventListener("click", deleteSelected, { signal });
  session.ui.save.addEventListener("click", () => run(), { signal });
  session.ui.clear.addEventListener("click", () => closeDocument(), { signal });
  session.ui.prev.addEventListener("click", () => goTo(session.pageIndex - 1), { signal });
  session.ui.next.addEventListener("click", () => goTo(session.pageIndex + 1), { signal });
  session.ui.imageBrowse.addEventListener("click", () => session.ui.imageInput.click(), { signal });
  session.ui.imageInput.addEventListener(
    "change",
    () => {
      const file = session.ui.imageInput.files?.[0];
      session.ui.imageInput.value = "";
      if (file) pickImage(file);
    },
    { signal }
  );
}

export function unmount() {
  session.ac?.abort();
  session.ac = null;
  const urls = new Set(session.stamps.map((stamp) => stamp.url));
  for (const url of urls) URL.revokeObjectURL(url);
  session.stamps = [];
  session.selectedId = "";
  session.bytes = null;
  session.fileName = "";
  session.pages = 0;
  session.size = 0;
  session.pageIndex = 0;
  session.pendingImage = null;
  const board = session.board;
  const root = session.root;
  session.board = null;
  session.pad = null;
  session.ui = null;
  session.root = null;
  void board?.destroy();
  if (root) {
    root.replaceChildren();
    root.classList.remove("sign-root");
  }
  removeStyles();
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file || !isPdfFile(file)) return;
  if (session.bytes && session.fileName === file.name && session.size === file.size) return;
  await loadFile(file);
}

/** @returns {import("../../ui/router.js").Tool} */
export function asTool() {
  return {
    id,
    name: "توقيع",
    icon: "icon-sign",
    input: "PDF",
    actionLabel: "توقيع",
    setup() {
      const root = document.getElementById("view-sign");
      if (root) mount(root);
    },
    enter() {
      syncChrome();
    },
    leave() {},
    run,
    acceptFiles,
    outputName: suggestedName
  };
}
