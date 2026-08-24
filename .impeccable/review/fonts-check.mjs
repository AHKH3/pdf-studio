const listed = await fetch("http://127.0.0.1:9229/json/list").then((r) => r.json());
const t = listed.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let n = 0;
function rpc(method, params) {
  const id = ++n;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", on);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    };
    ws.addEventListener("message", on);
  });
}
const expr = `(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { sel, ff: cs.fontFamily, fs: cs.fontSize, fw: cs.fontWeight, color: cs.color };
  };
  return {
    name: pick(".mark__name"),
    sub: pick(".mark__sub"),
    title: pick(".start__title, .view__title"),
    lede: pick(".start__lede, .view__lede"),
    body: pick("body"),
    btn: pick(".btn--act"),
    stamp: pick(".stamp")
  };
})()`;
const r = await rpc("Runtime.evaluate", { returnByValue: true, expression: expr });
console.log(JSON.stringify(r.result.value, null, 2));
ws.close();
