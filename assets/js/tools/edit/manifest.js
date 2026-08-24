export { asTool, id, mount, run, suggestedName, syncChrome, title, unmount } from "./app.js";

import { id, mount, title, unmount } from "./app.js";

/** Isolated page markup / annotate tool. Integrator wires router / index.html. */
const edit = { id, title, mount, unmount };
export default edit;
