import { el, yieldToUi } from "../dom.js";
import { humanSize, readBytes, saveFile, withExtension } from "../lib/files.js";
import { lib, loadWritable, probeDocument } from "../pdf/core.js";
import { resolvePassword } from "../pdf/unlock.js";
import { ACTIONS, DocList } from "../ui/doclist.js";
import { confirmDiscard } from "../ui/dialog.js";
import { endProgress, startProgress, throwIfCancelled, toast, updateProgress } from "../ui/feedback.js";
import { wireIntake } from "../ui/intake.js";
import { setName, setRunEnabled, setSource, setState } from "../ui/titleblock.js";
import { reportFailure, reportSave, uid } from "./shared.js";

/** @type {Array<{ id: string; name: string; bytes: Uint8Array; pages: number; size: number; thumbUrl: string; password: string }>} */
let items = [];
/** @type {DocList | null} */
let list = null;
let saved = true;

function totals() {
  return {
    pages: items.reduce((sum, item) => sum + item.pages, 0),
    size: items.reduce((sum, item) => sum + item.size, 0)
  };
}

function mergeHint() {
  const panel = el("merge-panel");
  const host = el("merge-list");
  if (!panel || !host) return;
  let hint = panel.querySelector("[data-merge-hint]");
  if (items.length === 1) {
    if (!hint) {
      hint = document.createElement("p");
      hint.className = "note";
      hint.setAttribute("data-merge-hint", "1");
      host.before(hint);
    }
    hint.textContent = "أضف ملفاً ثانياً على الأقل. الملف الواحد لا يُدمَج.";
    hint.hidden = false;
  } else if (hint) {
    hint.hidden = true;
  }
}

function refresh() {
  list?.render(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      meta: [`${item.pages} صفحة`, humanSize(item.size)],
      thumb: { kind: "lazy", load: async () => item.thumbUrl },
      actions: [ACTIONS.grab, ACTIONS.up, ACTIONS.down, ACTIONS.remove]
    }))
  );

  const has = items.length > 0;
  el("merge-panel").hidden = !has;
  el("merge-drop").hidden = has;
  mergeHint();
  const sum = totals();
  setSource(has ? { label: `${items.length} ملف`, pages: String(sum.pages), size: humanSize(sum.size) } : {});
  setRunEnabled(items.length > 1);
  if (items.length === 1) setState("waiting", "أضف ملفاً ثانياً");
  else setState(has ? "idle" : "waiting");
  if (has && !/\S/.test(el("tb-name").value)) setName("مستند-مدمج.pdf");
}

/** @param {File[]} files */
async function add(files) {
  startProgress({ title: "قراءة الملفات", desc: "نتحقق من كل ملف ونعدّ صفحاته." });
  try {
    for (const [index, file] of files.entries()) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: (index / files.length) * 100, detail: file.name });
      const bytes = await readBytes(file);
      const unlocked = await resolvePassword(bytes, file.name);
      if (!unlocked) continue;
      const probe = await probeDocument(bytes, unlocked.password);
      items.push({
        id: uid("pdf"),
        name: file.name,
        bytes,
        pages: probe.pages,
        size: file.size,
        thumbUrl: probe.thumbUrl,
        password: unlocked.password
      });
      saved = false;
      refresh();
    }
    if (items.length === 1) toast("أضف ملفاً آخر لبدء الدمج.", "info");
  } catch (error) {
    reportFailure(error, "تعذّر فتح أحد الملفات.");
  } finally {
    endProgress();
    refresh();
  }
}

function clear() {
  for (const item of items) URL.revokeObjectURL(item.thumbUrl);
  items = [];
  saved = true;
  refresh();
}

async function requestClear() {
  if (!items.length) return;
  if (!(await confirmDiscard(mergeTool.name))) return;
  clear();
}

async function acceptFiles(files) {
  if (!files?.length) return;
  const current = items.map((item) => `${item.name}:${item.size}`).join("|");
  const incoming = files.map((file) => `${file.name}:${file.size}`).join("|");
  if (current === incoming) return;
  clear();
  await add(files);
}

async function run() {
  if (items.length < 2) {
    toast("أضف ملفين على الأقل للدمج.", "info");
    return;
  }
  const { PDFDocument } = lib();

  setState("busy");
  startProgress({ title: "دمج الملفات", desc: "ننسخ الصفحات بالترتيب المعروض." });
  try {
    const target = await PDFDocument.create();
    for (const [index, item] of items.entries()) {
      throwIfCancelled();
      await yieldToUi();
      updateProgress({ percent: (index / items.length) * 100, detail: `${index + 1} / ${items.length} — ${item.name}` });
      const source = await loadWritable(item.bytes);
      const copied = await target.copyPages(source, source.getPageIndices());
      for (const page of copied) target.addPage(page);
    }
    throwIfCancelled();
    updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
    const bytes = await target.save();
    endProgress();
    const written = await saveFile(bytes, withExtension(el("tb-name").value, "pdf"), "pdf");
    if (written) saved = true;
    reportSave(written, `تم دمج ${items.length} ملفات في مستند واحد.`);
  } catch (error) {
    reportFailure(error, "تعذّر الدمج.");
  } finally {
    endProgress();
  }
}

/** @type {import("../ui/router.js").Tool} */
export const mergeTool = {
  id: "merge",
  name: "دمج",
  icon: "icon-merge",
  input: "PDF+",
  actionLabel: "دمج وحفظ",
  outputName: () => "مستند-مدمج.pdf",

  setup() {
    list = new DocList("merge-list", {
      emptyText: "لا ملفات بعد.",
      onAction(action, id) {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return;
        if (action === "remove") {
          URL.revokeObjectURL(items[index].thumbUrl);
          items.splice(index, 1);
        } else if (action === "up" && index > 0) {
          items.splice(index - 1, 0, items.splice(index, 1)[0]);
        } else if (action === "down" && index < items.length - 1) {
          items.splice(index + 1, 0, items.splice(index, 1)[0]);
        }
        saved = false;
        refresh();
      },
      onReorder(ids) {
        items = ids.map((id) => items.find((item) => item.id === id)).filter(Boolean);
        saved = false;
        refresh();
      }
    });

    wireIntake({ dropId: "merge-drop", inputId: "merge-input", browseId: "merge-browse", accept: "pdf", onFiles: add });
    el("merge-add")?.addEventListener("click", () => el("merge-input").click());
    el("merge-clear")?.addEventListener("click", requestClear);
  },

  enter: refresh,
  isDirty: () => items.length > 0 && !saved,
  acceptFiles,
  run
};
