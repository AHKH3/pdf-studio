/**
 * Behaviour checks for experience polish: ranges, ZIP (Arabic names),
 * error mapping. No DOM. Run via npm test.
 */
import { friendlyMessage, isEncryptedError, isPasswordError } from "../assets/js/lib/errors.js";
import { humanSize } from "../assets/js/lib/files.js";
import { pad, parseRanges, rangesToIndexes, uniqueIndexes } from "../assets/js/lib/ranges.js";
import { createZip } from "../assets/js/lib/zip.js";

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(name, body) {
  console.log(`\n${name}`);
  body();
}

group("parseRanges", () => {
  const ranges = parseRanges("1-3, 5, 8-12", 12);
  check("parses mixed ranges", ranges.length === 3 && ranges[0].from === 1 && ranges[2].to === 12);
  check("accepts Arabic separators", parseRanges("1–2، 4", 10).length === 2);
  check("clamps to the document", parseRanges("1-999", 4)[0].to === 4);
  check("ignores junk", parseRanges("foo, 2, 1-x", 5).length === 1);
  check("empty input is empty", parseRanges("", 10).length === 0);
});

group("rangesToIndexes / uniqueIndexes", () => {
  const indexes = rangesToIndexes(parseRanges("1-3, 2-4", 10));
  check("expands inclusive ranges", indexes.join(",") === "0,1,2,1,2,3");
  check("uniqueIndexes drops overlap", uniqueIndexes(indexes, 10).join(",") === "0,1,2,3");
  check("uniqueIndexes drops out of range", uniqueIndexes([-1, 0, 99], 2).join(",") === "0");
});

group("pad", () => {
  check("pads to width", pad(3, 3) === "003");
  check("does not shrink", pad(12, 2) === "12");
});

group("createZip", () => {
  const name = "صفحة-١.png";
  const payload = new Uint8Array([1, 2, 3, 4]);
  const zip = createZip([{ name, data: payload }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  check("starts with a local file header", view.getUint32(0, true) === 0x04034b50);
  check("marks the name as UTF-8", (view.getUint16(6, true) & 0x0800) === 0x0800);
  const nameBytes = new TextEncoder().encode(name);
  check("stores the UTF-8 name length", view.getUint16(26, true) === nameBytes.length);
  check("stores uncompressed size", view.getUint32(22, true) === payload.length);
  const storedName = zip.slice(30, 30 + nameBytes.length);
  check("round-trips an Arabic file name", Buffer.from(storedName).equals(Buffer.from(nameBytes)));
});

group("errors", () => {
  const password = { name: "PasswordException", message: "Need password" };
  check("detects pdf.js password errors", isPasswordError(password));
  check("password copy is Arabic", friendlyMessage(password, "fallback").includes("كلمة مرور"));
  const encrypted = { name: "EncryptedPdfError", message: "encrypted" };
  check("detects encrypted pdf-lib errors", isEncryptedError(encrypted));
  check("encrypted copy points to images/compress", friendlyMessage(encrypted, "x").includes("صور"));
  const cancel = Object.assign(new Error("cancelled"), { name: "CancelledError" });
  check("cancellations stay silent", friendlyMessage(cancel, "x") === null);
  check("invalid PDF copy", friendlyMessage({ message: "Invalid PDF structure" }, "x").includes("تالف"));
});

group("humanSize", () => {
  check("bytes", humanSize(400) === "400 B");
  check("kilobytes", humanSize(2048) === "2 KB");
  check("megabytes", humanSize(2.5 * 1024 * 1024) === "2.5 MB");
  check("empty", humanSize(0) === "—");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
