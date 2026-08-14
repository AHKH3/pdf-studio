import { enter, leave, mount, outputName, run, unmount, acceptFiles } from "./crop.js";

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
