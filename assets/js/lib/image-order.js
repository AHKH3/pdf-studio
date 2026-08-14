/**
 * Light local page-order hints for photo stacks (notebook / book).
 * Filename numbers, JPEG EXIF time, optional 8×8 average-hash — no cloud, no AI kit.
 */

const VISUAL_CAP = 60;

/** @param {string} name */
export function numberKeys(name) {
  return [...String(name).matchAll(/(\d+)/g)].map((match) => Number(match[1]));
}

/** @param {string} a @param {string} b */
export function compareNames(a, b) {
  const left = numberKeys(a);
  const right = numberKeys(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    if (left[i] == null && right[i] == null) break;
    if (left[i] == null) return 1;
    if (right[i] == null) return -1;
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return String(a).localeCompare(String(b), "ar");
}

/** @param {File[]} files */
export function filesHaveNumbers(files) {
  return files.some((file) => numberKeys(file.name).length > 0);
}

function parseExifDate(text) {
  const match = String(text || "").match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return 0;
  const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
  return Number.isFinite(ms) ? ms : 0;
}

function tiffU16(view, offset, le) {
  return le ? view.getUint16(offset, true) : view.getUint16(offset, false);
}

function tiffU32(view, offset, le) {
  return le ? view.getUint32(offset, true) : view.getUint32(offset, false);
}

function readExifString(view, tiff, le, entry) {
  const type = tiffU16(view, entry + 2, le);
  const count = tiffU32(view, entry + 4, le);
  if (type !== 2 || count < 10 || tiff + count > view.byteLength) return "";
  const inline = count <= 4;
  const start = inline ? entry + 8 : tiff + tiffU32(view, entry + 8, le);
  if (start < 0 || start + count > view.byteLength) return "";
  return new TextDecoder("latin1").decode(new Uint8Array(view.buffer, view.byteOffset + start, count)).replace(/\0+$/, "");
}

function walkIfd(view, tiff, le, ifd, want) {
  if (ifd < tiff || ifd + 2 > view.byteLength) return;
  const count = tiffU16(view, ifd, le);
  const found = {};
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = tiffU16(view, entry, le);
    if (!want.has(tag)) continue;
    if (tag === 0x8769) found.exif = tiff + tiffU32(view, entry + 8, le);
    else found[tag] = readExifString(view, tiff, le, entry);
  }
  return found;
}

/** JPEG APP1 DateTimeOriginal, else DateTime. 0 if missing. */
export async function readExifTime(file) {
  if (!/\.jpe?g$/i.test(file.name) && file.type !== "image/jpeg") return 0;
  try {
    const buf = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return 0;
    let i = 2;
    while (i + 4 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const size = (buf[i + 2] << 8) | buf[i + 3];
      if (marker === 0xe1 && size > 8) {
        const start = i + 4;
        const head = String.fromCharCode(buf[start], buf[start + 1], buf[start + 2], buf[start + 3]);
        if (head !== "Exif") break;
        const tiff = start + 6;
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const le = buf[tiff] === 0x49;
        const ifd0 = tiff + tiffU32(view, tiff + 4, le);
        const want = new Set([0x0132, 0x8769]);
        const first = walkIfd(view, tiff, le, ifd0, want) || {};
        let original = "";
        if (first.exif) {
          const exif = walkIfd(view, tiff, le, first.exif, new Set([0x9003, 0x9004])) || {};
          original = exif[0x9003] || exif[0x9004] || "";
        }
        return parseExifDate(original || first[0x0132]);
      }
      if (marker === 0xda || marker === 0xd9) break;
      i += 2 + size;
    }
  } catch {
    return 0;
  }
  return 0;
}

function hamming64(a, b) {
  let n = a ^ b;
  let bits = 0;
  while (n) {
    bits += Number(n & 1n);
    n >>= 1n;
  }
  return bits;
}

/** 64-bit average hash. */
export async function aHash(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, 8, 8);
    const pixels = ctx.getImageData(0, 0, 8, 8).data;
    const gray = [];
    let sum = 0;
    for (let i = 0; i < 64; i += 1) {
      const o = i * 4;
      const value = pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114;
      gray.push(value);
      sum += value;
    }
    const mean = sum / 64;
    let hash = 0n;
    for (let i = 0; i < 64; i += 1) {
      if (gray[i] >= mean) hash |= 1n << BigInt(i);
    }
    canvas.width = 0;
    canvas.height = 0;
    return hash;
  } finally {
    bitmap.close();
  }
}

async function visualOrder(files) {
  const scored = [];
  for (const file of files) {
    try {
      scored.push({ file, hash: await aHash(file) });
    } catch {
      scored.push({ file, hash: 0n });
    }
  }
  const remaining = scored.slice(1);
  const path = [scored[0]];
  while (remaining.length) {
    let best = 0;
    let dist = Infinity;
    const last = path[path.length - 1].hash;
    for (let i = 0; i < remaining.length; i += 1) {
      const bits = hamming64(last, remaining[i].hash);
      if (bits < dist) {
        dist = bits;
        best = i;
      }
    }
    path.push(remaining.splice(best, 1)[0]);
  }
  return path.map((item) => item.file);
}

/**
 * @param {File[]} files
 * @param {{ visual?: boolean }} [options]
 * @returns {Promise<{ files: File[]; method: "none" | "name" | "time" | "visual" }>}
 */
export async function suggestImageOrder(files, options = {}) {
  const visual = options.visual !== false;
  const list = Array.from(files || []);
  if (list.length < 2) return { files: list, method: "none" };

  if (filesHaveNumbers(list)) {
    list.sort((a, b) => compareNames(a.name, b.name));
    return { files: list, method: "name" };
  }

  const dated = await Promise.all(
    list.map(async (file) => ({
      file,
      time: (await readExifTime(file)) || file.lastModified || 0
    }))
  );
  const times = new Set(dated.map((item) => item.time));
  if (times.size > 1) {
    dated.sort((a, b) => a.time - b.time || compareNames(a.file.name, b.file.name));
    return { files: dated.map((item) => item.file), method: "time" };
  }

  if (visual && list.length <= VISUAL_CAP) {
    try {
      return { files: await visualOrder(list), method: "visual" };
    } catch {
      /* fall through */
    }
  }

  list.sort((a, b) => compareNames(a.name, b.name));
  return { files: list, method: "name" };
}
