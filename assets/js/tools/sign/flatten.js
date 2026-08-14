import { lib } from "../../pdf/core.js";
import { throwIfCancelled, updateProgress } from "../../ui/feedback.js";
import { rotatePngQuarter, visualRectToMedia } from "./png.js";

/**
 * Draw every stamp as a PNG onto the page content stream. This is a flatten:
 * nothing is written as an AcroForm field, widget, or signature dictionary.
 *
 * @param {Uint8Array} bytes
 * @param {Array<{
 *   pageIndex: number;
 *   x: number;
 *   y: number;
 *   width: number;
 *   height: number;
 *   png: Uint8Array;
 * }>} stamps
 */
export async function flattenStamps(bytes, stamps) {
  const { PDFDocument } = lib();
  const target = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = target.getPages();

  /** @type {Map<Uint8Array, Array<any>>} */
  const embeds = new Map();

  async function imageFor(png, ccw) {
    let pack = embeds.get(png);
    if (!pack) {
      pack = [null, null, null, null];
      embeds.set(png, pack);
    }
    if (!pack[ccw]) {
      const oriented = ccw ? await rotatePngQuarter(png, ccw) : png;
      pack[ccw] = await target.embedPng(oriented);
    }
    return pack[ccw];
  }

  for (const [index, stamp] of stamps.entries()) {
    throwIfCancelled();
    const page = pages[stamp.pageIndex];
    if (!page || !stamp.png) continue;

    const { width: mediaW, height: mediaH } = page.getSize();
    const angle = page.getRotation().angle;
    const placed = visualRectToMedia(angle, mediaW, mediaH, stamp);
    const image = await imageFor(stamp.png, placed.ccw);
    page.drawImage(image, {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height
    });

    if (index % 6 === 0) {
      updateProgress({
        percent: (index / Math.max(1, stamps.length)) * 90,
        detail: `ختم ${index + 1} من ${stamps.length}`
      });
    }
  }

  throwIfCancelled();
  updateProgress({ percent: 96, desc: "نكتب الملف.", detail: "" });
  return target.save();
}
