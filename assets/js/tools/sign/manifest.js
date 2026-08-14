export { asTool, id, mount, run, suggestedName, syncChrome, title, unmount } from "./app.js";

import { id, mount, title, unmount } from "./app.js";

/** Isolated Fill & Sign tool. Integrator wires router / index.html — see README.md. */
const sign = { id, title, mount, unmount };
export default sign;
