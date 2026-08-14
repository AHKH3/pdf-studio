/**
 * Store-only PNG writer. Scanlines use filter 0; DEFLATE comes from the
 * browser so this stays free of extra dependencies.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcSlice = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcSlice));
  return out;
}

/** @param {Uint8Array} bytes */
export async function deflateBytes(bytes) {
  if (typeof CompressionStream !== "function") throw new Error("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array | Uint8ClampedArray} pixels packed, no filter bytes
 * @param {number} width
 * @param {number} height
 * @param {1 | 2 | 3 | 4} channels  gray / gray+A / RGB / RGBA
 */
export async function encodePng(pixels, width, height, channels) {
  const row = width * channels;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (row + 1);
    raw[offset] = 0;
    raw.set(pixels.subarray(y * row, y * row + row), offset + 1);
  }

  const colorType = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  let idat;
  try {
    idat = await deflateBytes(raw);
  } catch {
    return encodePngViaCanvas(pixels, width, height, channels);
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * @param {Uint8Array | Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 */
async function encodePngViaCanvas(pixels, width, height, channels) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const frame = ctx.createImageData(width, height);
  const dst = frame.data;
  if (channels === 4) dst.set(pixels);
  else if (channels === 3) {
    for (let i = 0, p = 0; i < dst.length; i += 4, p += 3) {
      dst[i] = pixels[p];
      dst[i + 1] = pixels[p + 1];
      dst[i + 2] = pixels[p + 2];
      dst[i + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0, p = 0; i < dst.length; i += 4, p += 1) {
      dst[i] = dst[i + 1] = dst[i + 2] = pixels[p];
      dst[i + 3] = 255;
    }
  } else {
    for (let i = 0, p = 0; i < dst.length; i += 4, p += 2) {
      dst[i] = dst[i + 1] = dst[i + 2] = pixels[p];
      dst[i + 3] = pixels[p + 1];
    }
  }
  ctx.putImageData(frame, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("png");
  return new Uint8Array(await blob.arrayBuffer());
}
