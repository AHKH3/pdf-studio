/**
 * Protect round-trip test. Generates a PDF fixture with pdf-lib, runs the real
 * production qpdf worker inside an offscreen Electron renderer
 * (scripts/protect-harness.cjs), then verifies the encrypted and decrypted
 * bytes here in Node. Run via npm test.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const PASSWORD = "سر-123";
const TIMEOUT_MS = 120000;

async function makeFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Protect ${index + 1}`, { x: 72, y: 770, size: 24, font });
  }
  return new Uint8Array(await doc.save());
}

function runHarness(plainB64) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [require.resolve("./protect-harness.cjs")], {
      stdio: ["ignore", "pipe", "inherit"],
      env: {
        ...process.env,
        HARNESS_PDF_B64: plainB64,
        HARNESS_PASSWORD: PASSWORD,
        ELECTRON_ENABLE_LOGGING: "0"
      }
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("harness timed out"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const marker = stdout.indexOf("HARNESS_RESULT ");
      if (marker !== -1) {
        clearTimeout(timer);
        const line = stdout.slice(marker).split("\n")[0];
        resolve(JSON.parse(Buffer.from(line.slice("HARNESS_RESULT ".length), "base64").toString("utf8")));
        child.kill();
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

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

console.log("\nprotect (qpdf-wasm AES-256 round-trip via the production worker)");

try {
  const plain = await makeFixture();
  const results = await runHarness(Buffer.from(plain).toString("base64"));

  check("renderer is cross-origin isolated", results.crossIsolated === true, JSON.stringify(results));
  check("encrypt succeeds", results.encryptOk === true, JSON.stringify(results));
  if (results.encryptOk) {
    check("output carries an encryption dictionary", results.hasEncryptDict === true);

    let rejected = false;
    try {
      await PDFDocument.load(new Uint8Array(Buffer.from(results.encryptedB64, "base64")));
    } catch {
      rejected = true;
    }
    check("locked without the password", rejected);

    check("decrypt with the password succeeds", results.decryptOk === true);
    if (results.decryptOk) {
      const reopened = await PDFDocument.load(new Uint8Array(Buffer.from(results.decryptedB64, "base64")));
      check("decrypted output matches the original page count", reopened.getPageCount() === 2);
    }
    check("wrong password fails to decrypt", results.wrongPasswordFails === true);
  }
} catch (error) {
  failures += 1;
  console.error(`  FAIL harness could not run — ${error.message}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
