const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const port = 8765;

const srv = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  let rel;
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!rel) rel = "index.html";
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  const ext = path.extname(file).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm"
  };
  res.setHeader("Content-Type", mime[ext] || "application/octet-stream");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  fs.createReadStream(file).pipe(res);
});

srv.listen(port, "127.0.0.1", () => {
  console.log(`Test server running at http://127.0.0.1:${port}/`);
});
