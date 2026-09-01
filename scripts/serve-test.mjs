import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "5173", 10);
const HOST = "127.0.0.1";

const SERVED_PREFIXES = ["assets/", "index.html", "favicon.ico"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".webp": "image/webp"
};

function guessMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeFilePath(requestPath) {
  const raw = (requestPath || "/").split("?")[0];
  let rel;
  try {
    rel = decodeURIComponent(raw).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!rel) rel = "index.html";
  if (!SERVED_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(prefix))) return null;

  const candidate = path.resolve(path.join(ROOT, rel));
  const prefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (candidate !== ROOT && !candidate.startsWith(prefix)) return null;
  return candidate;
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = new URL(req.url || "/", `http://${HOST}:${PORT}`).pathname;
    const filePath = safeFilePath(urlPath);
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not found");
      }

      res.setHeader("Content-Type", guessMime(filePath));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'none'",
          "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
          "worker-src 'self' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' blob: data:",
          "media-src 'self' blob: data:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'"
        ].join("; ")
      );

      if (/\.(js|mjs|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(png|jpg|jpeg|webp|woff2?)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }

      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal error: " + (err && err.message));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[PDF Studio Static Server] running at http://${HOST}:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
