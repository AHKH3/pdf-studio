/**
 * Parses "1-3, 5, 8-12" (Arabic or Latin separators) into inclusive 1-based ranges.
 * @param {string} text
 * @param {number} pageCount
 * @returns {Array<{ from: number; to: number }>}
 */
export function parseRanges(text, pageCount) {
  /** @type {Array<{ from: number; to: number }>} */
  const ranges = [];
  for (const chunk of String(text || "").split(/[,،؛;]+/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(trimmed);
    if (!match) continue;
    const from = Number.parseInt(match[1], 10);
    const to = match[2] ? Number.parseInt(match[2], 10) : from;
    const low = Math.max(1, Math.min(from, to));
    const high = Math.min(pageCount, Math.max(from, to));
    if (high >= low) ranges.push({ from: low, to: high });
  }
  return ranges;
}

/** @param {Array<{ from: number; to: number }>} ranges */
export function rangesToIndexes(ranges) {
  /** @type {number[]} */
  const out = [];
  for (const range of ranges) {
    for (let page = range.from; page <= range.to; page += 1) out.push(page - 1);
  }
  return out;
}

/** Unique, sorted, still within the document. */
export function uniqueIndexes(indexes, pageCount) {
  const seen = new Set();
  /** @type {number[]} */
  const out = [];
  for (const index of indexes) {
    if (index < 0 || index >= pageCount || seen.has(index)) continue;
    seen.add(index);
    out.push(index);
  }
  return out;
}

/** @param {number} value @param {number} width */
export function pad(value, width) {
  return String(value).padStart(Math.max(1, width), "0");
}
