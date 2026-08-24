import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import os from "node:os";
import { createServer } from "node:http";

const OUT = dirname(fileURLToPath(import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8769;
const CDP_PORT = 9336;

function contentType(p) {
  const e = extname(p).toLowerCase();
  if (e === ".html") return "text/html";
  if (e === ".js" || e === ".mjs" || e === ".cjs") return "text/javascript";
  if (e === ".css") return "text/css";
  if (e === ".json") return "application/json";
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".pdf") return "application/pdf";
  if (e === ".wasm") return "application/wasm";
  return "application/octet-stream";
}
async function startStatic(root, port) {
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/") url = "/index.html";
    const file = join(root, url);
    try {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-cache" });
      res.end(data);
    } catch {
      res.writeHead(404); res.end("not found: " + url);
    }
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  return server;
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function rpc(ws, method, params={}) {
  const id = (rpc.n=(rpc.n||0)+1);
  ws.send(JSON.stringify({id, method, params}));
  return new Promise((resolve, reject)=>{
    const on=(e)=>{
      const m=JSON.parse(e.data);
      if(m.id!==id) return;
      ws.removeEventListener("message", on);
      if(m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    };
    ws.addEventListener("message", on);
  });
}
async function shot(ws, name){
  const {data}=await rpc(ws,"Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
  await writeFile(join(OUT,name), Buffer.from(data,"base64"));
  console.log("wrote",name);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const server = await startStatic(root, PORT);
console.log("static",PORT);
const profile = join(os.tmpdir(), `pdf-studio-real-${Date.now()}`);
await mkdir(profile,{recursive:true});
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--disable-gpu","--hide-scrollbars","--window-size=1440,900", `http://127.0.0.1:${PORT}/index.html`], {stdio:"ignore"});
let listed;
for(let i=0;i<40;i++){ try{ listed=await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then(r=>r.json()); if(listed?.length) break; }catch{} await wait(150); }
if(!listed?.length){ chrome.kill(); server.close(); throw new Error("no devtools"); }
const target=listed.find(t=>t.type==="page")||listed[0];
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ ws.addEventListener("open",res); ws.addEventListener("error",rej); });
await rpc(ws,"Page.enable"); await rpc(ws,"Runtime.enable");
await rpc(ws,"Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await rpc(ws,"Page.navigate",{url:`http://127.0.0.1:${PORT}/index.html`}); await wait(1200);
await rpc(ws,"Runtime.evaluate",{expression:`document.fonts ? document.fonts.ready.then(()=>true) : true`,awaitPromise:true}); await wait(400);

// Helper to evaluate and log
async function evalLog(expr, label){
  const r = await rpc(ws,"Runtime.evaluate",{expression:expr,awaitPromise:true, returnByValue:true});
  console.log(label, r.result?.value ?? r.result?.description ?? JSON.stringify(r.result).slice(0,300));
  return r.result?.value;
}

// 1. Show start
await shot(ws,"real-01-start.png");

// 2. Load real PDF from tmp/test-edit.pdf via fetch
console.log("loading PDF from tmp...");
const loadPdfResult = await rpc(ws,"Runtime.evaluate",{expression:`
(async()=>{
  try{
    const res = await fetch('./tmp/test-edit.pdf');
    if(!res.ok) return 'fetch failed:'+res.status;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    window.__testPdfFile = new File([bytes], 'اختبار-تحرير.pdf', {type:'application/pdf'});
    return 'pdf fetched:'+bytes.length;
  }catch(e){ return 'fetch err:'+e.message; }
})()
`,awaitPromise:true, returnByValue:true});
console.log("loadPdf", loadPdfResult.result?.value);

// 3. Navigate to edit and mount
await rpc(ws,"Runtime.evaluate",{expression:`
(async()=>{
  // Ensure router is ready, then navigate via hash or direct show
  // Try to click legend if exists, else force show
  document.querySelectorAll('.view').forEach(v=>{v.hidden=true; v.classList.remove('view--active')});
  const e=document.getElementById('view-edit');
  e.hidden=false; e.classList.add('view--active');
  // Import and mount edit
  try{
    const mod = await import('./assets/js/tools/edit/app.js');
    const root=document.getElementById('view-edit');
    // If not yet mounted, mount
    if(!root.querySelector('#edit-drop')){
      mod.mount(root);
      return 'mounted';
    }
    return 'already mounted';
  }catch(err){ return 'mount err:'+err.message+err.stack?.slice(0,300); }
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("mount",r.result?.value));
await wait(700);
await shot(ws,"real-02-edit-empty.png");

// 4. Load PDF into edit via acceptFiles
await rpc(ws,"Runtime.evaluate",{expression:`
(async()=>{
  const mod = await import('./assets/js/tools/edit/app.js');
  const f = window.__testPdfFile;
  if(!f) return 'no file';
  await mod.acceptFiles([f]);
  return 'acceptFiles called';
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("acceptFiles",r.result?.value));
await wait(1800);
await shot(ws,"real-03-edit-loaded.png");

// 5. Try adding text: select text tool then click on canvas
await rpc(ws,"Runtime.evaluate",{expression:`
(()=>{
  const t=document.querySelector('input[name=\"edit-tool\"][value=\"text\"]');
  if(t){ t.click(); t.checked=true; t.dispatchEvent(new Event('change',{bubbles:true})); }
  return 'text tool selected:'+t?.checked;
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("select text",r.result?.value));
await wait(300);
await shot(ws,"real-04-edit-text-tool.png");

// Simulate click on canvas to add text (board's click handler)
await rpc(ws,"Runtime.evaluate",{expression:`
(()=>{
  const canvas=document.getElementById('edit-page');
  const layer=document.getElementById('edit-layer');
  if(!canvas||!layer) return 'no canvas/layer';
  const rect=canvas.getBoundingClientRect();
  // Click near center of canvas
  const x=rect.left+rect.width*0.5;
  const y=rect.top+rect.height*0.4;
  const ev=new MouseEvent('click',{clientX:x,clientY:y,bubbles:true});
  // The board listens on layer for pointer events, but also handles click for tool creation
  // Try dispatching pointerdown/mouse events
  layer.dispatchEvent(new MouseEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,pointerId:1}));
  layer.dispatchEvent(new MouseEvent('click',{clientX:x,clientY:y,bubbles:true}));
  layer.dispatchEvent(new MouseEvent('pointerup',{clientX:x,clientY:y,bubbles:true,pointerId:1}));
  return 'click at '+x+','+y+' rect '+rect.width+'x'+rect.height;
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("canvas click",r.result?.value));
await wait(800);
await shot(ws,"real-05-edit-after-click.png");

// 6. Check if text object was created and try typing
await rpc(ws,"Runtime.evaluate",{expression:`
(()=>{
  const layer=document.getElementById('edit-layer');
  const objs=layer?.querySelectorAll('.edit-obj');
  const count=objs?.length||0;
  let info='';
  if(count>0){
    const first=objs[0];
    info='first:'+first.outerHTML.slice(0,400);
    // Try to find textarea
    const ta=first.querySelector('textarea');
    if(ta){
      ta.focus();
      ta.value='نص تجريبي جديد';
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      info+=' | textarea found and filled';
    }
  }
  return 'objs:'+count+' '+info;
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("after click check",r.result?.value));
await wait(500);
await shot(ws,"real-06-edit-with-object.png");

// 7. Check layers list
await rpc(ws,"Runtime.evaluate",{expression:`
(()=>{
  const layers=document.getElementById('edit-layers');
  return 'layers:'+(layers?.children.length||0)+' html:'+(layers?.innerHTML?.slice(0,500)||'empty');
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log("layers",r.result?.value));

// 8. Try pen tool
await rpc(ws,"Runtime.evaluate",{expression:`
(()=>{
  const p=document.querySelector('input[name=\"edit-tool\"][value=\"pen\"]');
  if(p){ p.click(); p.checked=true; p.dispatchEvent(new Event('change',{bubbles:true})); }
  return 'pen selected';
})()
`,awaitPromise:true, returnByValue:true}).then(r=>console.log(r.result?.value));
await wait(300);
await shot(ws,"real-07-edit-pen-tool.png");

// 9. Mobile view
await rpc(ws,"Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:2,mobile:true});
await wait(400);
await shot(ws,"real-08-edit-mobile.png");

ws.close(); chrome.kill(); server.close();
console.log("done real");
