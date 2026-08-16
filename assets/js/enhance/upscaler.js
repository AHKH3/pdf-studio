/**
 * Lazy, best-effort ESRGAN Slim x2 upscaler. TensorFlow.js and the model
 * are loaded once, on first use, from the local vendor copies — nothing is
 * fetched from the network. If loading or inference fails, callers keep the
 * original bitmap and the export still succeeds.
 */

const BASE = "assets/vendor/upscaler/";
const MODEL_PATH = `${BASE}models/x2/model.json`;

const SCRIPT_ORDER = [
  `${BASE}tf.min.js`,
  `${BASE}tf-backend-wasm.js`,
  `${BASE}upscaler.min.js`,
  `${BASE}esrgan-slim-x2.min.js`
];

/** @type {Promise<{ upscale: (bitmap: ImageBitmap) => Promise<ImageBitmap> }> | null} */
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

async function init() {
  for (const src of SCRIPT_ORDER) {
    await loadScript(src);
  }
  if (!window.tf?.wasm?.setWasmPaths) throw new Error("backend WASM غير متوفر");
  window.tf.wasm.setWasmPaths(BASE);
  await window.tf.setBackend("wasm");
  await window.tf.ready();

  // The UMD model definition carries only _internals (name/version/path),
  // which UpscalerJS resolves through jsdelivr/unpkg. A top-level `path`
  // is fetched directly — point it at our local copy.
  const baseModel = window.ESRGANSlim2x;
  const model = {
    ...baseModel,
    path: MODEL_PATH,
    _internals: { ...baseModel._internals, path: MODEL_PATH }
  };
  const upscaler = new window.Upscaler({ model });

  return {
    async upscale(bitmap) {
      const tensor = window.tf.browser.fromPixels(bitmap);
      const result = await upscaler.upscale(tensor, { output: "tensor" });
      tensor.dispose();
      try {
        const shape = result.shape;
        const [height, width, channels] = shape.length === 4
          ? [shape[1], shape[2], shape[3]]
          : [shape[0], shape[1], shape[2]];
        if (height < 1 || width < 1 || channels < 3) {
          result.dispose();
          throw new Error("ناتج غير متوقع من الموديل");
        }
        // The model emits float in [0, 255]; toPixels expects [0, 1].
        const normalized = result.clipByValue(0, 255).div(255);
        const rgb = await window.tf.browser.toPixels(normalized);
        normalized.dispose();
        result.dispose();
        // toPixels returns RGBA here; accept both RGBA and RGB.
        const stride = rgb.length === width * height * 4 ? 4 : 3;
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let i = 0, j = 0; i < rgb.length; i += stride, j += 4) {
          pixels[j] = rgb[i];
          pixels[j + 1] = rgb[i + 1];
          pixels[j + 2] = rgb[i + 2];
          pixels[j + 3] = 255;
        }
        return createImageBitmap(new ImageData(pixels, width, height));
      } catch (error) {
        result.dispose();
        throw error;
      }
    }
  };
}

/**
 * Upscales the bitmap 2x when the runtime is available; otherwise returns
 * the original bitmap unchanged.
 * @param {ImageBitmap} bitmap
 * @returns {Promise<ImageBitmap>}
 */
export async function upscaleBitmap(bitmap) {
  try {
    if (!ready) ready = init().catch((error) => {
      console.warn("upscaler: disabled,", error);
      return null;
    });
    const engine = await ready;
    if (!engine) return bitmap;
    const result = await engine.upscale(bitmap);
    return result;
  } catch (error) {
    console.warn("upscaler: inference failed,", error);
    return bitmap;
  }
}
