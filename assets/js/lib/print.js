import { openDocument, renderPageToBlob } from "../pdf/core.js";

/**
 * طباعة مباشرة محلية 100%: نحوّل بايتات PDF إلى صور (pdf.js) ثم نستدعي
 * حوار طباعة النظام عبر window.print(). لا نلمس electron/main.cjs ولا
 * نغيّر وضع الأمان — كل شيء في الرندرر، ومتوافق مع CSP (img blob مسموح).
 */

const STYLE_ID = "pdf-studio-print-styles";
const ROOT_ID = "print-root";
/** دقة الطباعة: 150 نقطة/بوصة توازن بين الحدة والذاكرة. */
const PRINT_DPI = 150;

function ensurePrintStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#print-root { display: none; }
@media print {
  /* بلا هوامش: الصفحة المطبوعة هي نفس صفحة PDF حرفيًا (ملء الورقة
     كما في المعاينة). أي هامش هنا كان يصغّر الصورة ويترك إطارًا أبيض —
     وهو سبب شكوى «الصورة لا تملأ الورقة عند الطباعة». */
  @page { size: auto; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block !important; margin: 0 !important; padding: 0 !important; }
  #print-root .print-page { margin: 0; padding: 0; width: 100%; page-break-inside: avoid; page-break-after: always; }
  #print-root .print-page:last-child { page-break-after: auto; }
  #print-root img { display: block; width: 100%; height: auto; margin: 0; padding: 0; }
}
`;
  document.head.append(style);
}

function clearPrintRoot() {
  const old = document.getElementById(ROOT_ID);
  if (old) {
    for (const url of old.querySelectorAll("img[data-url]")) {
      URL.revokeObjectURL(url.getAttribute("data-url"));
    }
    old.remove();
  }
}

/**
 * @param {Uint8Array} bytes بايتات PDF نهائية جاهزة للطباعة
 * @param {string} [docTitle] عنوان يظهر في رأس حوار الطباعة
 */
export async function printPdfBytes(bytes, docTitle = "مستند") {
  if (!bytes || !bytes.length) throw new Error("ملف فارغ — لا شيء للطباعة.");
  ensurePrintStyles();
  clearPrintRoot();

  const doc = await openDocument(bytes);
  const urls = [];
  try {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    document.body.append(root);

    const scale = PRINT_DPI / 72;
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      try {
        const blob = await renderPageToBlob(page, scale, "image/jpeg", 0.92);
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const wrap = document.createElement("div");
        wrap.className = "print-page";
        const img = document.createElement("img");
        img.src = url;
        img.setAttribute("data-url", url);
        img.alt = `صفحة ${n}`;
        wrap.append(img);
        root.append(wrap);
      } finally {
        page.cleanup();
      }
    }

    // انتظري تحميل الصور قبل فتح حوار الطباعة حتى لا تخرج صفحات فارغة.
    await Promise.all(
      [...root.querySelectorAll("img")].map((img) =>
        img.decode ? img.decode().catch(() => {}) : Promise.resolve()
      )
    );

    const prevTitle = document.title;
    if (docTitle) document.title = docTitle;
    try {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener("afterprint", finish);
          resolve();
        };
        window.addEventListener("afterprint", finish, { once: true });
        window.print();
        // احتياط: بعض البيئات لا تطلق afterprint (حوار ملغى بسرعة).
        setTimeout(finish, 1500);
      });
    } finally {
      document.title = prevTitle;
    }
  } finally {
    await doc.destroy().catch(() => {});
    // إبقاء الصور حتى يُغلق حوار الطباعة، ثم تنظيف.
    setTimeout(() => {
      for (const url of urls) URL.revokeObjectURL(url);
      clearPrintRoot();
    }, 2000);
  }
}
