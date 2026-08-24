const desktop = /** @type {any} */ (globalThis).pdfStudioDesktop;

let root = null;
let bar = null;
let label = null;
let actionBtn = null;

function ensureUI() {
  if (root) return;
  const header = document.querySelector(".sheet__head");
  if (!header) return;

  root = document.createElement("div");
  root.id = "update-bar";
  root.className = "update-bar";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  bar = document.createElement("div");
  bar.className = "update-bar__progress";
  bar.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "update-bar__text";

  label = document.createElement("span");
  label.className = "update-bar__label";
  label.textContent = "";

  actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "update-bar__action";
  actionBtn.hidden = true;
  actionBtn.textContent = "إعادة التشغيل";
  actionBtn.addEventListener("click", async () => {
    actionBtn.disabled = true;
    actionBtn.textContent = "جاري…";
    try {
      await desktop?.restartToUpdate?.();
    } catch {
      // سيُثبَّت عند الإغلاق تلقائيًا
    }
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "update-bar__dismiss";
  dismiss.setAttribute("aria-label", "إخفاء");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => {
    // يبقى التحديث مثبتًا عند الإغلاق، فقط نخفي الشريط
    if (root) root.hidden = true;
  });

  text.append(label, actionBtn, dismiss);
  root.append(bar, text);

  // نحطه بعد الـ mark وقبل الـ legend حتى يظهر بوضوح في الهيدر
  const legend = header.querySelector(".legend");
  if (legend) header.insertBefore(root, legend);
  else header.append(root);
}

function setProgress(percent) {
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  bar.style.setProperty("--progress", String(clamped));
  bar.style.width = `${clamped}%`;
}

/** @param {{ state: string; percent?: number; version?: string }} status */
function handleUpdate(status) {
  ensureUI();
  if (!root || !label || !bar || !actionBtn) return;

  switch (status.state) {
    case "downloading": {
      root.hidden = false;
      root.dataset.state = "downloading";
      actionBtn.hidden = true;
      const pct = status.percent ?? 0;
      label.textContent = pct > 0 ? `جاري تنزيل التحديث… ${pct}٪` : "جاري تنزيل التحديث…";
      setProgress(pct);
      break;
    }
    case "ready": {
      root.hidden = false;
      root.dataset.state = "ready";
      actionBtn.hidden = false;
      actionBtn.disabled = false;
      actionBtn.textContent = "إعادة التشغيل للتحديث";
      label.textContent = status.version ? `تحديث ${status.version} جاهز` : "التحديث جاهز";
      setProgress(100);
      break;
    }
    case "idle":
    case "checking":
    default: {
      // نخفي فقط لو كان في وضع التحميل؛ لو جاهز نتركه حتى يختاره المستخدم
      if (root.dataset.state !== "ready") {
        root.hidden = true;
        setProgress(0);
      }
      break;
    }
  }
}

export function initUpdater() {
  if (!desktop?.onUpdateStatus) return;
  ensureUI();
  desktop.onUpdateStatus(handleUpdate);
}
