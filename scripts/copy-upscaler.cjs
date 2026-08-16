"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const vendor = path.join(root, "assets", "vendor", "upscaler");

const copies = [
  ["@tensorflow/tfjs/dist/tf.min.js", "tf.min.js"],
  ["@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.es2017.min.js", "tf-backend-wasm.js"],
  [
    "@tensorflow/tfjs-backend-wasm/wasm-out/tfjs-backend-wasm-threaded-simd.worker.js",
    "tfjs-backend-wasm-threaded-simd.worker.js"
  ],
  ["@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm", "tfjs-backend-wasm.wasm"],
  ["@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm", "tfjs-backend-wasm-simd.wasm"],
  ["@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm", "tfjs-backend-wasm-threaded-simd.wasm"],
  ["upscaler/dist/browser/umd/upscaler.min.js", "upscaler.min.js"],
  [
    "@upscalerjs/esrgan-slim/dist/umd/models/esrgan-slim/src/x2/index.min.js",
    "esrgan-slim-x2.min.js"
  ],
  ["@upscalerjs/esrgan-slim/models/x2/model.json", path.join("models", "x2", "model.json")],
  [
    "@upscalerjs/esrgan-slim/models/x2/group1-shard1of1.bin",
    path.join("models", "x2", "group1-shard1of1.bin")
  ],
  [
    "@upscalerjs/esrgan-slim/dist/umd/models/esrgan-slim/src/x4/index.min.js",
    "esrgan-slim-x4.min.js"
  ],
  ["@upscalerjs/esrgan-slim/models/x4/model.json", path.join("models", "x4", "model.json")],
  [
    "@upscalerjs/esrgan-slim/models/x4/group1-shard1of1.bin",
    path.join("models", "x4", "group1-shard1of1.bin")
  ],
  [
    "@upscalerjs/esrgan-slim/dist/umd/models/esrgan-slim/src/x3/index.min.js",
    "esrgan-slim-x3.min.js"
  ],
  ["@upscalerjs/esrgan-slim/models/x3/model.json", path.join("models", "x3", "model.json")],
  [
    "@upscalerjs/esrgan-slim/models/x3/group1-shard1of1.bin",
    path.join("models", "x3", "group1-shard1of1.bin")
  ]
];

fs.mkdirSync(path.join(vendor, "models", "x2"), { recursive: true });
fs.mkdirSync(path.join(vendor, "models", "x3"), { recursive: true });
fs.mkdirSync(path.join(vendor, "models", "x4"), { recursive: true });

let ok = true;
for (const [rel, destRel] of copies) {
  const src = path.join(root, "node_modules", rel);
  const dest = path.join(vendor, destRel);
  if (!fs.existsSync(src)) {
    console.error("copy-upscaler: missing", rel);
    ok = false;
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log("copy-upscaler:", destRel);
}
if (!ok) process.exit(1);
