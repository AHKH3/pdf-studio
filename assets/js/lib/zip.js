/**
 * Minimal store-only ZIP writer. PNG and JPEG payloads are already compressed,
 * so deflating them again would cost time for no gain — and this keeps the app
 * free of a zip dependency.
 *
 * `createZipWriter` builds the archive incrementally so callers can release
 * each payload right after appending it, instead of holding every entry in
 * memory until the end.
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

function dosTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

/**
 * @returns {{ add: (name: string, data: Uint8Array) => void; finish: () => Uint8Array }}
 */
export function createZipWriter() {
  const encoder = new TextEncoder();
  const stamp = dosTime(new Date());
  /** @type {Uint8Array[]} */
  const chunks = [];
  /** @type {Array<{ nameBytes: Uint8Array; size: number; crc: number; localOffset: number }>} */
  const central = [];
  let offset = 0;

  return {
    /**
     * @param {string} name
     * @param {Uint8Array} data
     */
    add(name, data) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(data);
      const head = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(head.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      // Bit 11 marks the file name as UTF-8, which Arabic names need.
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, stamp.time, true);
      view.setUint16(12, stamp.day, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      head.set(nameBytes, 30);

      chunks.push(head, data);
      central.push({ nameBytes, size: data.length, crc, localOffset: offset });
      offset += head.length + data.length;
    },

    /** @returns {Uint8Array} */
    finish() {
      const centralStart = offset;
      const centralSize = central.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
      const end = new Uint8Array(centralSize + 22);
      const view = new DataView(end.buffer);
      let at = 0;

      central.forEach((entry) => {
        view.setUint32(at, 0x02014b50, true);
        view.setUint16(at + 4, 20, true);
        view.setUint16(at + 6, 20, true);
        view.setUint16(at + 8, 0x0800, true);
        view.setUint16(at + 10, 0, true);
        view.setUint16(at + 12, stamp.time, true);
        view.setUint16(at + 14, stamp.day, true);
        view.setUint32(at + 16, entry.crc, true);
        view.setUint32(at + 20, entry.size, true);
        view.setUint32(at + 24, entry.size, true);
        view.setUint16(at + 28, entry.nameBytes.length, true);
        view.setUint16(at + 30, 0, true);
        view.setUint16(at + 32, 0, true);
        view.setUint16(at + 34, 0, true);
        view.setUint16(at + 36, 0, true);
        view.setUint32(at + 38, 0, true);
        view.setUint32(at + 42, entry.localOffset, true);
        at += 46;
        end.set(entry.nameBytes, at);
        at += entry.nameBytes.length;
      });

      view.setUint32(at, 0x06054b50, true);
      view.setUint16(at + 4, 0, true);
      view.setUint16(at + 6, 0, true);
      view.setUint16(at + 8, central.length, true);
      view.setUint16(at + 10, central.length, true);
      view.setUint32(at + 12, centralSize, true);
      view.setUint32(at + 16, centralStart, true);
      view.setUint16(at + 20, 0, true);

      chunks.push(end);
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const out = new Uint8Array(total);
      let cursor = 0;
      for (const chunk of chunks) {
        out.set(chunk, cursor);
        cursor += chunk.length;
      }
      return out;
    }
  };
}

/**
 * @param {Array<{ name: string; data: Uint8Array }>} entries
 * @returns {Uint8Array}
 */
export function createZip(entries) {
  const writer = createZipWriter();
  for (const entry of entries) writer.add(entry.name, entry.data);
  return writer.finish();
}
