import { captureCropState, currentFileName, enter, leave, mount, outputName, restoreCropState, run, unmount, acceptFiles } from "./crop.js";
import { tabTitle } from "../shared.js";

/**
 * Crop PDF — visual crop box, current page or all pages.
 * Integrator: paste hub-fragment.html, then register this object. See README.md.
 */
export const cropManifest = {
  id: "crop",
  title: "قص",
  name: "قص",
  icon: "icon-crop",
  input: "PDF",
  actionLabel: "قص",
  tabTitle: () => tabTitle(cropManifest.name, currentFileName()),
  captureState: () => captureCropState(),
  restoreState: (state) => restoreCropState(state),
  mount,
  unmount,
  enter,
  leave,
  run,
  acceptFiles,
  outputName
};

export { enter, leave, mount, run, unmount, acceptFiles };

export default cropManifest;
