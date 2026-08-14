import {
  acceptFiles,
  enterTool,
  leaveTool,
  mount as mountUi,
  outputName,
  runTool,
  setupTool,
  TOOL_ID,
  TOOL_TITLE,
  unmount as unmountUi
} from "./ui.js";

export const id = TOOL_ID;
export const title = TOOL_TITLE;

/**
 * Mount the Protect / Unlock workspace into the app (or a standalone host).
 * @param {HTMLElement | null} [root]
 * @param {{ router?: boolean; standalone?: boolean }} [options]
 */
export function mount(root, options) {
  mountUi(root, options);
}

export function unmount() {
  unmountUi();
}

/** Router descriptor matching `assets/js/ui/router.js` Tool. */
export const protectTool = {
  id,
  name: "حماية",
  icon: "icon-lock",
  input: "PDF",
  actionLabel: "حماية",
  setup: setupTool,
  enter: enterTool,
  leave: leaveTool,
  run: runTool,
  acceptFiles,
  outputName
};
