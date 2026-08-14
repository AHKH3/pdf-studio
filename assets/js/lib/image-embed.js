import { readBytes } from "./files.js";

/**
 * pdf-lib embeds PNG and JPEG only; anything else is re-encoded once here.
 * @param {File} file
 * @returns {Promise<{ kind: "png" | "jpg"; bytes: Uint8Array }>}
 */
export async function toEmbeddable(file) {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png" || /\.png$/i.test(file.name)) return { kind: "png", bytes: await readBytes(file) };
  if (type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return { kind: "jpg", bytes: await readBytes(file) };

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  canvas.width = 0;
  canvas.height = 0;
  return { kind: "jpg", bytes: new Uint8Array(await blob.arrayBuffer()) };
}
