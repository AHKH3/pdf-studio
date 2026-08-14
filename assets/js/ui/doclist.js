import { el } from "../dom.js";

/**
 * @typedef {object} DocRow
 * @property {string} id
 * @property {string} name
 * @property {Array<string | null>} meta
 * @property {{ kind: "icon"; icon: string } | { kind: "url"; url: string } | { kind: "lazy"; load: () => Promise<string> }} thumb
 * @property {Array<{ action: string; icon: string; label: string; variant?: "danger" }>} actions
 * @property {boolean} [selected]
 * @property {number} [rotation]
 */

function svgIcon(id, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
}

export const ACTIONS = {
  grab: { action: "grab", icon: "icon-grip", label: "اسحب لإعادة الترتيب" },
  up: { action: "up", icon: "icon-arrow", label: "تحريك لأعلى" },
  down: { action: "down", icon: "icon-arrow", label: "تحريك لأسفل" },
  rotate: { action: "rotate", icon: "icon-rotate", label: "تدوير ٩٠ درجة" },
  remove: { action: "remove", icon: "icon-trash", label: "حذف", variant: "danger" },
  download: { action: "download", icon: "icon-download", label: "حفظ هذه الصفحة" }
};

export class DocList {
  /**
   * @param {string} containerId
   * @param {object} options
   * @param {(action: string, id: string) => void} options.onAction
   * @param {(orderedIds: string[]) => void} [options.onReorder]
   * @param {boolean} [options.selectable]
   * @param {string} [options.emptyText]
   */
  constructor(containerId, options) {
    this.container = el(containerId);
    this.options = options;
    this.sortable = null;
    /** @type {Map<string, HTMLElement>} */
    this.nodes = new Map();
    /** @type {Map<HTMLElement, () => void>} */
    this.loaders = new Map();

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const holder = /** @type {HTMLElement} */ (entry.target);
          this.observer.unobserve(holder);
          const loader = this.loaders.get(holder);
          if (loader) {
            this.loaders.delete(holder);
            loader();
          }
        }
      },
      { root: this.container?.closest(".work") ?? null, rootMargin: "320px 0px" }
    );

    if (this.container) {
      this.container.setAttribute("role", "list");
      this.container.addEventListener("click", (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        const button = target.closest("[data-action]");
        if (button instanceof HTMLElement) {
          const { action, id } = button.dataset;
          if (action && id) this.options.onAction(action, id);
          return;
        }
        if (!this.options.selectable) return;
        const row = target.closest(".docrow");
        if (row instanceof HTMLElement && row.dataset.id) this.options.onAction("select", row.dataset.id);
      });
      this.container.addEventListener("keydown", (event) => this.onKey(event));
    }
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    const row = /** @type {HTMLElement | null} */ (
      event.target instanceof HTMLElement ? event.target.closest(".docrow") : null
    );
    if (!row?.dataset.id) return;
    const id = row.dataset.id;
    const rows = Array.from(this.container.querySelectorAll(".docrow"));
    const index = rows.indexOf(row);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (event.altKey && this.options.onReorder) {
        this.options.onAction(event.key === "ArrowUp" ? "up" : "down", id);
        return;
      }
      const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next instanceof HTMLElement) next.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      rows[0]?.focus?.();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      rows[rows.length - 1]?.focus?.();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.options.onAction("remove", id);
      return;
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      this.options.onAction("rotate", id);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && this.options.selectable) {
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      this.options.onAction("select", id);
    }
  }

  /** @param {DocRow[]} rows */
  render(rows) {
    if (!this.container) return;

    if (!rows.length) {
      this.loaders.clear();
      this.observer.disconnect();
      this.nodes.clear();
      this.container.replaceChildren();
      if (this.options.emptyText) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = this.options.emptyText;
        this.container.append(empty);
      }
      this.syncSortable(0);
      return;
    }

    const keep = new Set(rows.map((row) => row.id));
    for (const [id, node] of this.nodes) {
      if (keep.has(id)) continue;
      const thumb = node.querySelector(".docrow__thumb");
      if (thumb instanceof HTMLElement) {
        this.observer.unobserve(thumb);
        this.loaders.delete(thumb);
      }
      node.remove();
      this.nodes.delete(id);
    }

    const empty = this.container.querySelector(".empty");
    empty?.remove();

    rows.forEach((row, index) => {
      let node = this.nodes.get(row.id);
      if (!node) {
        node = this.buildRow(row, index, rows.length);
        this.nodes.set(row.id, node);
      } else {
        this.updateRow(node, row, index, rows.length);
      }
      const current = this.container.children[index];
      if (current !== node) this.container.insertBefore(node, current ?? null);
    });

    this.syncSortable(rows.length);
  }

  /** @param {DocRow} row */
  buildRow(row, index, total) {
    const node = document.createElement("div");
    node.className = "docrow";
    node.dataset.id = row.id;
    node.setAttribute("role", "listitem");
    node.tabIndex = 0;
    if (row.selected) node.classList.add("is-selected");

    const order = document.createElement("div");
    order.className = "docrow__index";

    const thumb = document.createElement("div");
    thumb.className = "docrow__thumb";

    const body = document.createElement("div");
    body.className = "docrow__body";
    const name = document.createElement("div");
    name.className = "docrow__name";
    const meta = document.createElement("div");
    meta.className = "docrow__meta";
    body.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "docrow__actions";
    node.append(order, thumb, body, actions);
    this.updateRow(node, row, index, total, true);
    return node;
  }

  /**
   * @param {HTMLElement} node
   * @param {DocRow} row
   * @param {number} index
   * @param {number} total
   * @param {boolean} [fresh]
   */
  updateRow(node, row, index, total, fresh = false) {
    node.classList.toggle("is-selected", Boolean(row.selected));
    node.dataset.id = row.id;

    const order = node.querySelector(".docrow__index");
    if (order) order.textContent = String(index + 1);

    const name = node.querySelector(".docrow__name");
    if (name) {
      name.textContent = row.name;
      name.title = row.name;
    }

    const meta = node.querySelector(".docrow__meta");
    if (meta) {
      meta.replaceChildren();
      for (const part of row.meta.filter(Boolean)) {
        const span = document.createElement("span");
        if (/^[\d\s./×x-]+$/.test(String(part))) span.className = "num";
        span.textContent = String(part);
        meta.append(span);
      }
    }

    const actions = node.querySelector(".docrow__actions");
    if (actions && (fresh || actions.childElementCount !== row.actions.length)) {
      actions.replaceChildren();
      for (const spec of row.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `rowbtn${spec.variant === "danger" ? " rowbtn--danger" : ""}`;
        if (spec.action === "grab") button.classList.add("rowbtn--grab", "drag-handle");
        else button.dataset.action = spec.action;
        button.dataset.id = row.id;
        button.setAttribute("aria-label", spec.label);
        button.title = spec.label;
        if (spec.action === "up") button.append(svgIcon(spec.icon, "icon rot-90"));
        else if (spec.action === "down") button.append(svgIcon(spec.icon, "icon rot-270"));
        else button.append(svgIcon(spec.icon));
        actions.append(button);
      }
    }

    for (const button of node.querySelectorAll(".rowbtn[data-action]")) {
      const action = /** @type {HTMLElement} */ (button).dataset.action;
      if (action === "up") /** @type {HTMLButtonElement} */ (button).disabled = index === 0;
      if (action === "down") /** @type {HTMLButtonElement} */ (button).disabled = index === total - 1;
      /** @type {HTMLElement} */ (button).dataset.id = row.id;
    }

    const thumb = node.querySelector(".docrow__thumb");
    if (!(thumb instanceof HTMLElement)) return;
    const img = thumb.querySelector("img");
    if (img) {
      img.style.transform = row.rotation ? `rotate(${row.rotation}deg)` : "";
      if (row.thumb.kind === "url" && img.getAttribute("src") !== row.thumb.url) img.src = row.thumb.url;
      return;
    }
    if (this.loaders.has(thumb) || thumb.classList.contains("is-loading")) return;
    this.fillThumb(thumb, row);
  }

  /** @param {HTMLElement} holder @param {DocRow} row */
  fillThumb(holder, row) {
    holder.replaceChildren();
    holder.classList.remove("is-loading");
    if (row.thumb.kind === "icon") {
      holder.append(svgIcon(row.thumb.icon));
      return;
    }
    if (row.thumb.kind === "url") {
      const img = document.createElement("img");
      img.src = row.thumb.url;
      img.alt = "";
      if (row.rotation) img.style.transform = `rotate(${row.rotation}deg)`;
      holder.append(img);
      return;
    }

    holder.classList.add("is-loading");
    const load = row.thumb.load;
    this.loaders.set(holder, async () => {
      try {
        const url = await load();
        if (!url || !holder.isConnected) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        if (row.rotation) img.style.transform = `rotate(${row.rotation}deg)`;
        holder.classList.remove("is-loading");
        holder.replaceChildren(img);
      } catch {
        holder.classList.remove("is-loading");
        holder.replaceChildren(svgIcon("icon-file"));
      }
    });
    this.observer.observe(holder);
  }

  syncSortable(count) {
    if (!this.options.onReorder || !this.container) return;
    const Sortable = /** @type {any} */ (window).Sortable;
    if (!Sortable) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (!this.sortable) {
      this.sortable = new Sortable(this.container, {
        animation: reduce ? 0 : 150,
        handle: ".drag-handle",
        draggable: ".docrow",
        direction: "vertical",
        ghostClass: "is-ghost",
        chosenClass: "is-chosen",
        forceFallback: true,
        fallbackOnBody: true,
        scroll: true,
        scrollSensitivity: 90,
        onEnd: () => {
          const ids = Array.from(this.container.querySelectorAll(".docrow")).map(
            (row) => /** @type {HTMLElement} */ (row).dataset.id
          );
          this.options.onReorder(/** @type {string[]} */ (ids.filter(Boolean)));
        }
      });
    }
    this.sortable.option("disabled", count < 2);
  }

  destroy() {
    this.observer.disconnect();
    this.loaders.clear();
    this.sortable?.destroy();
    this.sortable = null;
  }
}
