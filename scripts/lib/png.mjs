/**
 * Dependency-free PNG reader and writer, used by the scan test harness so the
 * pipeline can be exercised against real photographs in plain Node.
 * Supports 8-bit grayscale, RGB, palette, and alpha variants — everything a
 * phone screenshot or a converted photo produces.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }} RGBA
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const chunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12]
      };
    } else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "tRNS") transparency = Buffer.from(body);
    else if (type === "IDAT") chunks.push(Buffer.from(body));
    else if (type === "IEND") break;
  }

  if (!header) throw new Error("PNG has no header");
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);
  if (header.interlace) throw new Error("interlaced PNG is not supported");

  const { width, height, colorType } = header;
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const corner = prev && x >= channels ? prev[x - channels] : 0;
      const value = line[x];
      switch (filter) {
        case 0: out[x] = value; break;
        case 1: out[x] = (value + left) & 0xff; break;
        case 2: out[x] = (value + up) & 0xff; break;
        case 3: out[x] = (value + ((left + up) >> 1)) & 0xff; break;
        case 4: out[x] = (value + paeth(left, up, corner)) & 0xff; break;
        default: throw new Error(`unknown filter ${filter}`);
      }
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, source = 0, target = 0; i < width * height; i += 1, source += channels, target += 4) {
    if (colorType === 0) {
      data[target] = data[target + 1] = data[target + 2] = pixels[source];
      data[target + 3] = 255;
    } else if (colorType === 2) {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = 255;
    } else if (colorType === 3) {
      const index = pixels[source];
      data[target] = palette[index * 3];
      data[target + 1] = palette[index * 3 + 1];
      data[target + 2] = palette[index * 3 + 2];
      data[target + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    } else if (colorType === 4) {
      data[target] = data[target + 1] = data[target + 2] = pixels[source];
      data[target + 3] = pixels[source + 1];
    } else {
      data[target] = pixels[source];
      data[target + 1] = pixels[source + 1];
      data[target + 2] = pixels[source + 2];
      data[target + 3] = pixels[source + 3];
    }
  }

  return { width, height, data };
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image
 * @returns {Buffer}
 */
export function encodePng(image) {
  const { width, height, data } = image;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 1; // Sub filter: cheap and effective on scan output.
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const value = data[source + c];
        const left = x > 0 ? data[source - 4 + c] : 0;
        line[x * 3 + c] = (value - left) & 0xff;
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
