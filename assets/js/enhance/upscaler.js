/**
 * Lazy, best-effort ESRGAN Slim upscaler (2x, 3x and 4x). TensorFlow.js and
 * the models are loaded once, on first use, from the local vendor copies —
 * nothing is fetched from the network. Multithreaded WASM is enabled when
 * crossOriginIsolated allows it (the app's local server sends COOP/COEP),
 * which cuts inference time by roughly 4x on multi-core machines.
 * If loading or inference fails, callers keep the original bitmap and the
 * export still succeeds.
 */

const BASE = "assets/vendor/upscaler/";
const MODELS = {
  2: {
    path: `${BASE}models/x2/model.json`,
    script: `${BASE}esrgan-slim-x2.min.js`,
    global: "ESRGANSlim2x"
  },
  3: {
    path: `${BASE}models/x3/model.json`,
    script: `${BASE}esrgan-slim-x3.min.js`,
    global: "ESRGANSlim3x"
  },
  4: {
    path: `${BASE}models/x4/model.json`,
    script: `${BASE}esrgan-slim-x4.min.js`,
    global: "ESRGANSlim4x"
  }
};

const SCRIPT_ORDER = [
  `${BASE}tf.min.js`,
  `${BASE}tf-backend-wasm.js`,
  `${BASE}upscaler.min.js`
];

/** @type {Promise<{ upscale: (bitmap: ImageBitmap, scale: number) => Promise<ImageBitmap> }> | null} */
let ready = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`تعذّر تحميل ${src}`));
    document.head.appendChild(script);
  });
}

function loadModelScripts() {
  return Promise.all(Object.values(MODELS).map((model) => loadScript(model.script)));
}

function makeEngine(scale, tf, upscalerFactory) {
  const spec = MODELS[scale];
  // The UMD model definition carries only _internals (name/version/path),
  // which UpscalerJS resolves through jsdelivr/unpkg. A top-level `path`
  // is fetched directly — point it at our local copy.
  const baseModel = window[spec.global];
  const model = {
    ...baseModel,
    path: spec.path,
    _internals: { ...baseModel._internals, path: spec.path }
  };
  const upscaler = upscalerFactory(model);

  return async (bitmap) => {
    // Pad to a multiple of the scale so the model never sees odd dims
    // (the WASM backend crashes with "memory access out of bounds").
    const padW = (scale - (bitmap.width % scale)) % scale;
    const padH = (scale - (bitmap.height % scale)) % scale;
    const padded = document.createElement("canvas");
    padded.width = bitmap.width + padW;
    padded.height = bitmap.height + padH;
    const pctx = padded.getContext("2d", { alpha: false });
    pctx.drawImage(bitmap, 0, 0);
    if (padW > 0) pctx.drawImage(bitmap, 0, 0, 1, bitmap.height, bitmap.width, 0, padW, bitmap.height);
    if (padH > 0) pctx.drawImage(bitmap, 0, 0, bitmap.width, 1, 0, bitmap.height, bitmap.width, padH);
    if (padW > 0 && padH > 0) {
      pctx.drawImage(bitmap, bitmap.width - 1, bitmap.height - 1, 1, 1, bitmap.width, bitmap.height, padW, padH);
    }

    const tensor = tf.browser.fromPixels(padded);
    const result = await upscaler.upscale(tensor, { output: "tensor" });
    tensor.dispose();
    try {
      const shape = result.shape;
      const [height, width] = shape.length === 4 ? [shape[1], shape[2]] : [shape[0], shape[1]];
      const data = result.dataSync();
      result.dispose();
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        pixels[j] = Math.max(0, Math.min(255, data[i]));
        pixels[j + 1] = Math.max(0, Math.min(255, data[i + 1]));
        pixels[j + 2] = Math.max(0, Math.min(255, data[i + 2]));
        pixels[j + 3] = 255;
      }
      const upscaled = await createImageBitmap(new ImageData(pixels, width, height));
      // Crop the padding back off.
      const cropped = await createImageBitmap(upscaled, 0, 0, bitmap.width * scale, bitmap.height * scale);
      upscaled.close();
      return cropped;
    } catch (error) {
      result.dispose();
      throw error;
    }
  };
}

async function init() {
  for (const src of SCRIPT_ORDER) {
    await loadScript(src);
  }
  await loadModelScripts();

  const tf = window.tf;
  if (!tf?.wasm?.setWasmPaths) throw new Error("backend WASM غير متوفر");

  // The app's local server already sends COOP/COEP headers, so threaded
  // WASM works; it drops the same workload from ~29s to ~8s.
  if (window.crossOriginIsolated) {
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", true);
    tf.env().set("WASM_HAS_SIMD_SUPPORT", true);
  }
  tf.wasm.setWasmPaths(BASE);
  try {
    await tf.setBackend("wasm");
  } catch {
    // Fall through: tfjs may already have registered another backend.
  }
  await tf.ready();

  const engines = new Map();
  for (const [scaleKey, spec] of Object.entries(MODELS)) {
    const scale = Number(scaleKey);
    engines.set(scale, makeEngine(scale, tf, (model) => new window.Upscaler({ model })));
  }

  return {
    async upscale(bitmap, scale) {
      const engine = engines.get(scale);
      if (!engine) throw new Error(`مقياس غير مدعوم: ${scale}`);
      return engine(bitmap);
    }
  };
}

/**
 * Upscales the bitmap when the runtime is available; otherwise returns the
 * original bitmap unchanged.
 * @param {ImageBitmap} bitmap
 * @param {2 | 3 | 4} scale
 * @returns {Promise<ImageBitmap>}
 */
export async function upscaleBitmap(bitmap, scale) {
  try {
    if (!ready) ready = init().catch((error) => {
      console.warn("upscaler: disabled,", error);
      return null;
    });
    const engine = await ready;
    if (!engine) return bitmap;
    const result = await engine.upscale(bitmap, scale);
    return result;
  } catch (error) {
    console.warn("upscaler: inference failed,", error);
    return bitmap;
  }
}
