/**
 * Diagnostic & Reproduction Test Suite for PDF Studio (Milestone 1)
 * Pinpoints defect mechanisms across core engines, coordinate transforms,
 * Unicode text fallbacks, and IPC save handlers.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

let failures = 0;
let passed = 0;
let totalChecks = 0;

function assertCheck(name, condition, detail = "") {
  totalChecks += 1;
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    failures += 1;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ----------------------------------------------------------------------
// 1. Watermark Coordinate Transform Diagnostic
// ----------------------------------------------------------------------
console.log("\n=== 1. Watermark Coordinate & Rotation Transform Diagnostic ===");
{
  // Create a 4-page PDF with 0, 90, 180, 270 degree rotation
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  
  const angles = [0, 90, 180, 270];
  for (const angle of angles) {
    const page = doc.addPage([600, 800]);
    page.setRotation(degrees(angle));
    page.drawText(`Page Rotated ${angle}°`, { x: 50, y: 700, size: 20, font });
  }

  const bytes = await doc.save();
  const reloaded = await PDFDocument.load(bytes);
  const pages = reloaded.getPages();

  assertCheck("Document created with 4 rotated pages", pages.length === 4);
  assertCheck("Page 0 has 0° rotation", pages[0].getRotation().angle === 0);
  assertCheck("Page 1 has 90° rotation", pages[1].getRotation().angle === 90);
  assertCheck("Page 2 has 180° rotation", pages[2].getRotation().angle === 180);
  assertCheck("Page 3 has 270° rotation", pages[3].getRotation().angle === 270);

  // Diagnostic: Calculate transformed coordinates for rotation-aware stamping
  function getVisualSize(page) {
    const { width, height } = page.getSize();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    if (angle === 90 || angle === 270) {
      return { visualWidth: height, visualHeight: width, rawWidth: width, rawHeight: height, angle };
    }
    return { visualWidth: width, visualHeight: height, rawWidth: width, rawHeight: height, angle };
  }

  const p1Size = getVisualSize(pages[1]);
  assertCheck("90° page swaps visual width and height", p1Size.visualWidth === 800 && p1Size.visualHeight === 600);

  // Function to convert visual (vx, vy, vw, vh) into PDF user space (px, py, rotation)
  function visualToPdfCoords(vx, vy, vw, vh, visualWidth, visualHeight, angle) {
    switch (angle) {
      case 90:
        return {
          x: vy + vh,
          y: vx,
          rotate: degrees(270)
        };
      case 180:
        return {
          x: visualWidth - vx,
          y: visualHeight - vy,
          rotate: degrees(180)
        };
      case 270:
        return {
          x: visualHeight - (vy + vh),
          y: visualWidth - vx,
          rotate: degrees(90)
        };
      case 0:
      default:
        return {
          x: vx,
          y: vy,
          rotate: degrees(0)
        };
    }
  }

  const spot0 = visualToPdfCoords(100, 100, 200, 50, 600, 800, 0);
  assertCheck("0° visual transform preserves raw coordinates", spot0.x === 100 && spot0.y === 100 && spot0.rotate.angle === 0);
  
  const spot90 = visualToPdfCoords(100, 100, 200, 50, 800, 600, 90);
  assertCheck("90° visual transform maps into PDF user space", spot90.x === 150 && spot90.y === 100 && spot90.rotate.angle === 270);
}

// ----------------------------------------------------------------------
// 2. Page Numbers Arabic / Unicode Font Fallback Diagnostic
// ----------------------------------------------------------------------
console.log("\n=== 2. Page Numbers Arabic / Unicode Font Fallback Diagnostic ===");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Standard ASCII works
  let asciiThrew = false;
  try {
    font.widthOfTextAtSize("Page 1 of 5", 12);
  } catch (err) {
    asciiThrew = true;
  }
  assertCheck("Helvetica encodes standard ASCII page numbers without error", !asciiThrew);

  // Arabic Eastern digits '١ / ٥' or Arabic text 'صفحة ١' throws in StandardFonts.Helvetica (WinAnsi)
  let arabicThrew = false;
  try {
    font.widthOfTextAtSize("صفحة ١ من ٥", 12);
  } catch (err) {
    arabicThrew = true;
  }
  assertCheck("Helvetica WinAnsi fails on Arabic Unicode glyphs (proves fallback requirement)", arabicThrew);

  // Fallback detection regex check
  function requiresImageFallback(text) {
    return /[^\u0020-\u007E]/.test(text);
  }

  assertCheck("Detects '1 / 5' as WinAnsi safe", !requiresImageFallback("1 / 5"));
  assertCheck("Detects 'صفحة 1' as requiring image fallback", requiresImageFallback("صفحة 1"));
  assertCheck("Detects '١ / ٥' (Eastern Arabic numerals) as requiring image fallback", requiresImageFallback("١ / ٥"));
}

// ----------------------------------------------------------------------
// 3. Desktop Save Folder File Deduplication Diagnostic
// ----------------------------------------------------------------------
console.log("\n=== 3. Desktop Save Folder File Deduplication Diagnostic ===");
{
  function deduplicateFileNames(files) {
    const seen = new Map();
    return files.map((file) => {
      const name = file.name;
      const dotIndex = name.lastIndexOf(".");
      const base = dotIndex !== -1 ? name.substring(0, dotIndex) : name;
      const ext = dotIndex !== -1 ? name.substring(dotIndex) : "";

      const count = seen.get(name) || 0;
      seen.set(name, count + 1);

      if (count === 0) return { ...file, resolvedName: name };
      return { ...file, resolvedName: `${base} (${count})${ext}` };
    });
  }

  const rawFiles = [
    { name: "page.png", data: new Uint8Array([1]) },
    { name: "page.png", data: new Uint8Array([2]) },
    { name: "page.png", data: new Uint8Array([3]) },
    { name: "document.pdf", data: new Uint8Array([4]) },
    { name: "document.pdf", data: new Uint8Array([5]) }
  ];

  const deduped = deduplicateFileNames(rawFiles);
  assertCheck("First file keeps original name", deduped[0].resolvedName === "page.png");
  assertCheck("Second duplicate receives (1) suffix", deduped[1].resolvedName === "page (1).png");
  assertCheck("Third duplicate receives (2) suffix", deduped[2].resolvedName === "page (2).png");
  assertCheck("Second pdf receives (1) suffix", deduped[4].resolvedName === "document (1).pdf");
}

// ----------------------------------------------------------------------
// 4. File Intake / Validation Diagnostic
// ----------------------------------------------------------------------
console.log("\n=== 4. File Intake / Validation Diagnostic ===");
{
  function isPdfFileName(name) {
    return /\.pdf$/i.test(name);
  }
  function isImageFileName(name) {
    return /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(name);
  }
  function validateHubDrop(fileList) {
    const accepted = fileList.filter(f => isPdfFileName(f.name) || isImageFileName(f.name));
    const rejected = fileList.filter(f => !isPdfFileName(f.name) && !isImageFileName(f.name));
    return { accepted, rejected, allValid: rejected.length === 0 };
  }

  const testBatch = [
    { name: "doc1.pdf" },
    { name: "image.png" },
    { name: "notes.txt" },
    { name: "program.exe" }
  ];

  const result = validateHubDrop(testBatch);
  assertCheck("Batch correctly filters 2 accepted files", result.accepted.length === 2);
  assertCheck("Batch correctly rejects 2 unsupported files", result.rejected.length === 2);
  assertCheck("Rejection flag is true when unsupported files exist", !result.allValid);
}

// ----------------------------------------------------------------------
// 5. Crop Geometry Coordinate Clipping Diagnostic
// ----------------------------------------------------------------------
console.log("\n=== 5. Crop Geometry Coordinate Clipping Diagnostic ===");
{
  // Verify crop box bounds clipping logic in PDF user space
  function clipCropBox(mediaBox, cropBox) {
    const minX = Math.max(mediaBox.x, cropBox.x);
    const minY = Math.max(mediaBox.y, cropBox.y);
    const maxX = Math.min(mediaBox.x + mediaBox.width, cropBox.x + cropBox.width);
    const maxY = Math.min(mediaBox.y + mediaBox.height, cropBox.y + cropBox.height);
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY)
    };
  }

  const media = { x: 0, y: 0, width: 595, height: 842 };
  const crop = { x: 50, y: 50, width: 495, height: 742 };
  const clipped = clipCropBox(media, crop);

  assertCheck("Valid crop box is fully contained within media box", clipped.width === 495 && clipped.height === 742);

  const outOfBoundsCrop = { x: -20, y: -20, width: 700, height: 900 };
  const clippedOOB = clipCropBox(media, outOfBoundsCrop);
  assertCheck("Out of bounds crop is clamped to media box width", clippedOOB.width === 595 && clippedOOB.x === 0);
  assertCheck("Out of bounds crop is clamped to media box height", clippedOOB.height === 842 && clippedOOB.y === 0);
}

// ----------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------
console.log(`\nDiagnostic Checks: ${passed}/${totalChecks} passed (${failures} failures).`);
process.exit(failures > 0 ? 1 : 0);
