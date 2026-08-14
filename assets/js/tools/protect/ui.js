import { isPdfFile, baseName, humanSize, readBytes, saveFile, withExtension } from "../../lib/files.js";
import { endProgress, startProgress, toast, updateProgress } from "../../ui/feedback.js";
import { setName, setRunEnabled, setSource, setState } from "../../ui/titleblock.js";
import { reportFailure, reportSave } from "../shared.js";
import { decryptPdf, disposeEngine, encryptPdf, QpdfError } from "./engine.js";

export const TOOL_ID = "protect";
export const TOOL_TITLE = "حماية وإزالة الحماية";

const FRAGMENT = `
<section id="view-protect" class="view" aria-labelledby="protect-title" role="region" hidden>
  <div class="view__head">
    <h2 class="view__title" id="protect-title" tabindex="-1">حماية وإزالة الحماية</h2>
    <p class="view__lede">أغلق الملف بكلمة سر AES-256، أو أزل الحماية إن كنت تعرفها. الملف لا يغادر جهازك.</p>
  </div>
  <div class="view__body">
    <div class="fieldset">
      <div class="field field--wide">
        <span id="protect-mode-label">العملية</span>
        <div class="choice-grid" role="radiogroup" aria-labelledby="protect-mode-label">
          <label class="choice">
            <input type="radio" name="protect-mode" value="lock" checked />
            <span>حماية بكلمة سر</span>
          </label>
          <label class="choice">
            <input type="radio" name="protect-mode" value="unlock" />
            <span>إزالة الحماية</span>
          </label>
        </div>
      </div>
    </div>
    <div id="protect-drop" class="intake" data-kind="pdf">
      <svg class="icon intake__glyph" aria-hidden="true"><use href="#icon-lock"></use></svg>
      <span class="intake__title">أسقط ملف PDF هنا</span>
      <span class="intake__hint">ملف واحد — المعالجة محلية بالكامل</span>
      <button id="protect-browse" type="button" class="btn">
        <svg class="icon" aria-hidden="true"><use href="#icon-upload"></use></svg> تصفّح الجهاز
      </button>
    </div>
    <input id="protect-input" type="file" accept="application/pdf,.pdf" hidden />
    <div id="protect-panel" hidden>
      <div class="readout" id="protect-readout"></div>
      <p class="note" id="protect-lock-note">
        التشفير AES-256 يجري على جهازك. إن نسيت كلمة السر فلن يمكن فتح الملف لاحقاً، ولا نملك طريقة لاستعادتها.
      </p>
      <p class="note" id="protect-unlock-note" hidden>
        إزالة الحماية تعمل فقط إذا أدخلت كلمة السر الصحيحة. لا نخمّنها ولا نكسر التشفير — ذلك غير ممكن عملياً على AES-256 وغير مسموح.
      </p>
      <p class="note" id="protect-status-note" hidden></p>
      <div class="fieldset" id="protect-lock-fields">
        <div class="field">
          <label for="protect-pass">كلمة سر الفتح</label>
          <input id="protect-pass" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" dir="ltr" maxlength="127" />
        </div>
        <div class="field">
          <label for="protect-pass-confirm">تأكيد كلمة السر</label>
          <input id="protect-pass-confirm" type="password" autocomplete="new-password" spellcheck="false" autocapitalize="off" dir="ltr" maxlength="127" />
        </div>
      </div>
      <div class="fieldset" id="protect-unlock-fields" hidden>
        <div class="field field--wide">
          <label for="protect-unlock-pass">كلمة السر المعروفة</label>
          <input id="protect-unlock-pass" type="password" autocomplete="current-password" spellcheck="false" autocapitalize="off" dir="ltr" maxlength="127" />
        </div>
      </div>
      <label class="check" id="protect-show-wrap">
        <input id="protect-show-pass" type="checkbox" />
        إظهار كلمة السر
      </label>
      <div class="btn-row">
        <button id="protect-run" type="button" class="btn btn--act" hidden>
          <svg class="icon" aria-hidden="true"><use href="#icon-download"></use></svg>
          <span id="protect-run-label">حماية وحفظ</span>
        </button>
        <button id="protect-clear" type="button" class="btn btn--quiet">
          <svg class="icon" aria-hidden="true"><use href="#icon-close"></use></svg> إغلاق الملف
        </button>
      </div>
    </div>
  </div>
</section>
`;

/** @type {AbortController | null} */
let controller = null;
/** @type {HTMLElement | null} */
let view = null;
let injected = false;
let standalone = false;

/** @type {null | { name: string; bytes: Uint8Array; size: number; pages: number; encrypted: boolean; needsPassword: boolean; restrictionOnly: boolean }} */
let doc = null;

/** @param {string} id */
function $(id) {
  return (view || document).querySelector(`#${id}`);
}

function hasTitleBlock() {
  return Boolean(document.getElementById("tb-run"));
}

function mode() {
  const checked = view?.querySelector('input[name="protect-mode"]:checked');
  return checked?.value === "unlock" ? "unlock" : "lock";
}

function actionLabel() {
  return mode() === "unlock" ? "إزالة الحماية" : "حماية وحفظ";
}

export function outputName() {
  if (!doc) return "";
  const suffix = mode() === "unlock" ? "بدون-حماية" : "محمي";
  return `${baseName(doc.name)}-${suffix}.pdf`;
}

function isPdfHeader(bytes) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function hasEncryptDict(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 2_000_000)));
  return /\/Encrypt(?:\s|\/|\[)/.test(head);
}

/** @param {Uint8Array} bytes */
async function probe(bytes) {
  if (!isPdfHeader(bytes)) throw new Error("هذا الملف ليس PDF صالحاً.");
  const encryptDict = hasEncryptDict(bytes);
  try {
    const { openDocument } = await import("../../pdf/core.js");
    const pdf = await openDocument(bytes);
    const pages = pdf.numPages;
    await pdf.destroy();
    return {
      encrypted: encryptDict,
      needsPassword: false,
      restrictionOnly: encryptDict,
      pages
    };
  } catch (error) {
    const locked = error?.name === "PasswordException" || error?.code === 1 || error?.code === 2;
    if (locked) {
      return { encrypted: true, needsPassword: true, restrictionOnly: false, pages: 0 };
    }
    if (encryptDict) {
      return { encrypted: true, needsPassword: true, restrictionOnly: false, pages: 0 };
    }
    return { encrypted: false, needsPassword: false, restrictionOnly: false, pages: 0 };
  }
}

function lockStateLabel() {
  if (!doc) return "—";
  if (doc.needsPassword) return "محمي بكلمة سر";
  if (doc.restrictionOnly) return "قيود بدون كلمة فتح";
  return "غير محمي";
}

function renderReadout() {
  const host = $("protect-readout");
  if (!host || !doc) return;
  host.replaceChildren();
  const rows = [
    ["الملف", doc.name],
    ["الحجم", humanSize(doc.size)],
    ["الصفحات", doc.pages ? String(doc.pages) : "—"],
    ["الحالة", lockStateLabel()]
  ];
  for (const [label, value] of rows) {
    const cell = document.createElement("div");
    cell.className = "readout__cell";
    const key = document.createElement("span");
    key.className = "readout__label";
    key.textContent = label;
    const val = document.createElement("span");
    val.className = label === "الحجم" || label === "الصفحات" ? "readout__value num" : "readout__value";
    val.textContent = value;
    cell.append(key, val);
    host.append(cell);
  }
}

function passwordValues() {
  const lockPass = /** @type {HTMLInputElement | null} */ ($("protect-pass"));
  const confirm = /** @type {HTMLInputElement | null} */ ($("protect-pass-confirm"));
  const unlockPass = /** @type {HTMLInputElement | null} */ ($("protect-unlock-pass"));
  return {
    lock: lockPass?.value ?? "",
    confirm: confirm?.value ?? "",
    unlock: unlockPass?.value ?? ""
  };
}

function canRun() {
  if (!doc) return false;
  if (mode() === "lock") {
    if (doc.encrypted) return false;
    const { lock, confirm } = passwordValues();
    return lock.length > 0 && lock === confirm;
  }
  if (!doc.encrypted) return false;
  if (doc.needsPassword) return passwordValues().unlock.length > 0;
  return true;
}

function statusMessage() {
  if (!doc) return "";
  if (mode() === "lock" && doc.encrypted) {
    return doc.needsPassword
      ? "هذا الملف محمي مسبقاً. انتقل إلى «إزالة الحماية» إن كنت تعرف كلمة السر."
      : "هذا الملف فيه قيود صلاحيات. أزل الحماية أولاً ثم أعد حمايته إن لزم.";
  }
  if (mode() === "unlock" && !doc.encrypted) {
    return "هذا الملف غير محمي. لا حاجة لإزالة حماية.";
  }
  if (mode() === "unlock" && doc.restrictionOnly) {
    return "الملف يُفتح بدون كلمة سر، لكن فيه قيود. يمكنك إزالتها مباشرة.";
  }
  return "";
}

function syncChrome() {
  const unlocking = mode() === "unlock";
  const lockNote = $("protect-lock-note");
  const unlockNote = $("protect-unlock-note");
  const statusNote = $("protect-status-note");
  const lockFields = $("protect-lock-fields");
  const unlockFields = $("protect-unlock-fields");
  if (lockNote) lockNote.hidden = unlocking;
  if (unlockNote) unlockNote.hidden = !unlocking;
  if (lockFields) lockFields.hidden = unlocking;
  if (unlockFields) unlockFields.hidden = !unlocking;

  const message = statusMessage();
  if (statusNote) {
    statusNote.hidden = !message;
    statusNote.textContent = message;
  }

  const confirm = /** @type {HTMLInputElement | null} */ ($("protect-pass-confirm"));
  const { lock, confirm: confirmValue } = passwordValues();
  if (confirm) {
    const mismatch = !unlocking && lock.length > 0 && confirmValue.length > 0 && lock !== confirmValue;
    confirm.setAttribute("aria-invalid", mismatch ? "true" : "false");
  }

  const label = actionLabel();
  const runLabel = $("protect-run-label");
  if (runLabel) runLabel.textContent = label;
  const tbLabel = document.getElementById("tb-run-label");
  if (tbLabel && view && !view.hidden) tbLabel.textContent = label;

  const enabled = canRun();
  const runBtn = /** @type {HTMLButtonElement | null} */ ($("protect-run"));
  if (runBtn) runBtn.disabled = !enabled;
  if (hasTitleBlock()) setRunEnabled(enabled);

  if (doc && hasTitleBlock()) {
    setName(outputName());
    setSource({
      label: doc.name,
      pages: doc.pages ? String(doc.pages) : "—",
      size: humanSize(doc.size)
    });
  }
}

function clearPasswords() {
  for (const id of ["protect-pass", "protect-pass-confirm", "protect-unlock-pass"]) {
    const input = /** @type {HTMLInputElement | null} */ ($(id));
    if (input) input.value = "";
  }
  const show = /** @type {HTMLInputElement | null} */ ($("protect-show-pass"));
  if (show) show.checked = false;
  applyPasswordVisibility();
}

function applyPasswordVisibility() {
  const show = /** @type {HTMLInputElement | null} */ ($("protect-show-pass"));
  const type = show?.checked ? "text" : "password";
  for (const id of ["protect-pass", "protect-pass-confirm", "protect-unlock-pass"]) {
    const input = /** @type {HTMLInputElement | null} */ (view?.querySelector(`#${id}`));
    if (input) input.type = type;
  }
}

function clearDoc() {
  doc = null;
  const panel = $("protect-panel");
  const drop = $("protect-drop");
  if (panel) panel.hidden = true;
  if (drop) drop.hidden = false;
  clearPasswords();
  if (hasTitleBlock()) {
    setSource({});
    setRunEnabled(false);
    setState("waiting");
    setName("");
  }
  syncChrome();
}

/** @param {File[]} files */
async function loadFiles(files) {
  const file = files[0];
  if (!file) return;
  startProgress({ title: "قراءة المستند", desc: file.name, cancellable: false });
  try {
    const bytes = await readBytes(file);
    const info = await probe(bytes);
    doc = {
      name: file.name,
      bytes,
      size: file.size,
      pages: info.pages,
      encrypted: info.encrypted,
      needsPassword: info.needsPassword,
      restrictionOnly: info.restrictionOnly
    };
    clearPasswords();
    const panel = $("protect-panel");
    const drop = $("protect-drop");
    if (panel) panel.hidden = false;
    if (drop) drop.hidden = true;
    renderReadout();
    if (hasTitleBlock()) setState("idle");
    syncChrome();
  } catch (error) {
    if (hasTitleBlock()) reportFailure(error, "تعذّر فتح المستند.");
    else toast(error instanceof Error ? error.message : "تعذّر فتح المستند.", "error");
  } finally {
    endProgress();
  }
}

function outputPath() {
  const typed = /** @type {HTMLInputElement | null} */ (document.getElementById("tb-name"));
  return withExtension((typed?.value || outputName()).trim() || outputName(), "pdf");
}

export async function runTool() {
  if (!doc || !canRun()) return;
  const unlocking = mode() === "unlock";
  const { lock, unlock } = passwordValues();
  const password = unlocking ? unlock : lock;

  if (hasTitleBlock()) setState("busy");
  startProgress({
    title: unlocking ? "إزالة الحماية" : "حماية المستند",
    desc: unlocking ? "نفتح الملف بكلمة السر التي أدخلتها." : "تشفير AES-256 على جهازك.",
    cancellable: false
  });
  try {
    updateProgress({ percent: 18, detail: "تحميل المحرّك" });
    const output = unlocking
      ? await decryptPdf(doc.bytes, password)
      : await encryptPdf(doc.bytes, password);
    updateProgress({ percent: 82, detail: "حفظ الناتج" });
    const saved = await saveFile(output, outputPath(), "pdf");
    endProgress();
    if (hasTitleBlock()) {
      reportSave(saved, unlocking ? "أُزيلت الحماية. احفظ الناتج في مكان تعرفه." : "حُمي الملف بتشفير AES-256.");
    } else if (saved) {
      toast(unlocking ? "أُزيلت الحماية." : "حُمي الملف بتشفير AES-256.", "done");
    }
    if (saved) clearPasswords();
    syncChrome();
  } catch (error) {
    if (error instanceof QpdfError) {
      if (hasTitleBlock()) setState("error");
      toast(error.message, "error");
    } else if (hasTitleBlock()) {
      reportFailure(error, unlocking ? "تعذّر إزالة الحماية." : "تعذّرت حماية الملف.");
    } else {
      toast(error instanceof Error ? error.message : "تعذّرت معالجة الملف.", "error");
    }
  } finally {
    endProgress();
  }
}

function wireDrop(signal) {
  const drop = $("protect-drop");
  const input = /** @type {HTMLInputElement | null} */ ($("protect-input"));
  const browse = $("protect-browse");
  if (!drop || !input) return;

  const handle = async (fileList) => {
    const all = Array.from(fileList || []);
    const good = all.filter(isPdfFile);
    if (good.length < all.length) toast("تم تجاهل ملفات ليست PDF.", "info");
    if (!good.length) return;
    await loadFiles(good);
  };

  const open = () => input.click();
  browse?.addEventListener(
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
  drop.setAttribute("tabindex", "0");
  drop.setAttribute("role", "button");

  input.addEventListener(
    "change",
    async () => {
      await handle(input.files);
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
    async (event) => {
      event.preventDefault();
      depth = 0;
      drop.classList.remove("is-over");
      await handle(event.dataTransfer?.files);
    },
    { signal }
  );
}

function bind(signal) {
  wireDrop(signal);
  view?.querySelectorAll('input[name="protect-mode"]').forEach((input) => {
    input.addEventListener(
      "change",
      () => {
        if (hasTitleBlock() && doc) setName(outputName());
        syncChrome();
      },
      { signal }
    );
  });
  for (const id of ["protect-pass", "protect-pass-confirm", "protect-unlock-pass"]) {
    $(id)?.addEventListener("input", syncChrome, { signal });
  }
  $("protect-show-pass")?.addEventListener("change", applyPasswordVisibility, { signal });
  $("protect-clear")?.addEventListener("click", clearDoc, { signal });
  $("protect-run")?.addEventListener("click", () => void runTool(), { signal });

  const runBtn = $("protect-run");
  if (runBtn) runBtn.hidden = !standalone;
  syncChrome();
}

function resolveHost(root) {
  if (root instanceof HTMLElement) return root;
  return document.getElementById("work") || document.body;
}

function ensureView(host) {
  const found = document.getElementById("view-protect");
  if (found) return { node: found, didInject: false };
  host.insertAdjacentHTML("beforeend", FRAGMENT.trim());
  const node = document.getElementById("view-protect");
  if (!node) throw new Error("تعذّر إنشاء شاشة الحماية.");
  return { node, didInject: true };
}

/**
 * @param {HTMLElement | Document | null} [root]
 * @param {{ router?: boolean; standalone?: boolean }} [options]
 */
export function mount(root, options = {}) {
  unmount();
  controller = new AbortController();
  const host = resolveHost(root);
  const ensured = ensureView(host);
  view = ensured.node;
  injected = ensured.didInject;
  const router = options.router ?? Boolean(document.getElementById("legend-list"));
  standalone = options.standalone ?? !hasTitleBlock();
  if (!router) view.hidden = false;
  bind(controller.signal);
}

export function unmount() {
  controller?.abort();
  controller = null;
  disposeEngine();
  clearPasswords();
  doc = null;
  if (injected && view?.parentNode) view.remove();
  injected = false;
  view = null;
  standalone = false;
}

export async function acceptFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (doc && doc.name === file.name && doc.size === file.size) return;
  if (doc) clearDoc();
  await loadFiles([file]);
}

export function setupTool() {
  mount(document.getElementById("work"), { router: true, standalone: false });
}

export function enterTool() {
  if (!view) setupTool();
  if (doc) {
    renderReadout();
    if (hasTitleBlock()) setState("idle");
  } else if (hasTitleBlock()) {
    setState("waiting");
    setRunEnabled(false);
  }
  syncChrome();
}

export function leaveTool() {
  clearPasswords();
  syncChrome();
}
