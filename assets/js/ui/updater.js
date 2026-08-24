const desktop = /** @type {any} */ (globalThis).pdfStudioDesktop;

let root = null;
let bar = null;
let label = null;
let actionBtn = null;
let iconWrap = null;

function icon(href) {
  return `<svg class="icon" aria-hidden="true"><use href="#${href}"></use></svg>`;
}

function ensureUI() {
  if (root) return;
  const header = document.querySelector(".sheet__head");
  if (!header) return;

  root = document.createElement("div");
  root.id = "update-bar";
  root.className = "update-pill";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  iconWrap = document.createElement("span");
  iconWrap.className = "update-pill__icon";
  iconWrap.setAttribute("aria-hidden", "true");
  iconWrap.innerHTML = icon("icon-download");

  const textWrap = document.createElement("div");
  textWrap.className = "update-pill__main";

  label = document.createElement("span");
  label.className = "update-pill__label";
  label.textContent = "";

  bar = document.createElement("div");
  bar.className = "update-pill__track";
  const barFill = document.createElement("div");
  barFill.className = "update-pill__fill";
  bar.append(barFill);

  textWrap.append(label, bar);

  actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "update-pill__action";
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
  dismiss.className = "update-pill__dismiss";
  dismiss.setAttribute("aria-label", "إخفاء");
  dismiss.innerHTML = icon("icon-close");
  dismiss.addEventListener("click", () => {
    if (root) root.hidden = true;
  });

  root.append(iconWrap, textWrap, actionBtn, dismiss);

  // ضعه بجانب زر الوضع الداكن — الناحية الأخرى من الهيدر
  const themeBtn = header.querySelector("#theme-toggle");
  if (themeBtn) header.insertBefore(root, themeBtn);
  else {
    const legend = header.querySelector(".legend");
    if (legend) header.insertBefore(root, legend.nextSibling);
    else header.append(root);
  }
}

function setProgress(percent) {
  if (!root || !bar) return;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  root.style.setProperty("--progress", String(clamped));
  const fill = bar.querySelector(".update-pill__fill");
  if (fill) fill.style.width = `${clamped}%`;
}

function handleUpdate(status) {
  ensureUI();
  if (!root || !label || !bar || !actionBtn || !iconWrap) return;

  switch (status.state) {
    case "downloading": {
      root.hidden = false;
      root.dataset.state = "downloading";
      actionBtn.hidden = true;
      iconWrap.innerHTML = icon("icon-rotate");
      iconWrap.classList.add("is-spin");
      const pct = status.percent ?? 0;
      label.textContent = pct > 0 ? `جاري التحديث… ${pct}٪` : "جاري التحديث…";
      setProgress(pct);
      break;
    }
    case "ready": {
      root.hidden = false;
      root.dataset.state = "ready";
      actionBtn.hidden = false;
      actionBtn.disabled = false;
      actionBtn.textContent = "إعادة التشغيل";
      iconWrap.innerHTML = icon("icon-check");
      iconWrap.classList.remove("is-spin");
      label.textContent = status.version ? `تحديث ${status.version} جاهز` : "التحديث جاهز";
      setProgress(100);
      break;
    }
    case "idle":
    case "checking":
    default: {
      if (root.dataset.state !== "ready") {
        root.hidden = true;
        setProgress(0);
        iconWrap.classList.remove("is-spin");
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

// للاختبار اليدوي في الكونسول: __pdfStudioUpdate({state:'downloading', percent:42})
if (typeof globalThis !== "undefined") {
  globalThis.__pdfStudioUpdate = handleUpdate;
}
