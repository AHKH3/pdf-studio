# استخراج الصور المضمّنة (`extract-images`)

وحدة جاهزة للدمج. لا تلمس هذه الملفات من خارج المجلد، ولا تضف تبعية npm.

ليست «PDF إلى صور». تلك الأداة ترسم كل صفحة. هذه تخرج **صور XObject المضمّنة** بجودتها المخزّنة.

## السلوك

1. المستخدم يسقط PDF واحد (عربي RTL، أوفلاين).
2. تُسرد الصور الفريدة مع معاينة، المقاس، الصفحة، الحجم، والصيغة.
3. حفظ واحدة، أو الكل ZIP / مجلد. صورة واحدة تُحفظ ملفاً منفرداً.
4. **JPEG (`/DCTDecode`)** يُكتب كما في التيار — بلا مرور على canvas.
5. Flate/Indexed وما شابه → PNG من العيّنات (قد يُطبَّق SMask كألفا).
6. JPEG2000 → `.jp2`. JBIG2/CCITT/inline → PNG عبر pdf.js بعد فك التشفير، وليس لقطة صفحة.
7. أقنعة ImageMask (ستنسل) تُتخطى. الصورة 1×1 تُتخطى.
8. ZIP عبر `assets/js/lib/zip.js` الموجود — بلا مكتبة zip جديدة.

## الدمج (إلزامي — الملفات مقفلة خارج هذا المجلد)

### 1. الصق المقطع في `index.html`

انسخ محتوى `hub-fragment.html` داخل `<main id="work">`، بعد `view-rasterize` وقبل إغلاق `</main>`.

`#view-extract-images` مطلوب لأن الموجّه يبحث عن `view-${id}`.

### 2. سجّل الأداة في `assets/js/main.js`

```js
import { extractImagesTool } from "./tools/extract-images/manifest.js";

registerTools([
  // ...الأدوات الحالية
  rasterizeTool,
  extractImagesTool
]);
```

ضع الأداة **بعد** `rasterizeTool` حتى يبقى «PDF إلى صور» و«استخراج الصور» متجاورين في الفهرس دون أن يختلط الغرض.

### 3. لا تضف أيقونة جديدة ما لم تشأ

البيان يستخدم `#icon-images` الموجود في الـ sprite. اختياري: رمز جديد `icon-extract-images` ثم غيّر `extractImagesTool.icon`.

### 4. لا CSS جديد

المقطع يعيد استخدام: `view`, `intake`, `fieldset`, `field`, `note`, `doclist`, `btn`.

## واجهة `manifest.js`

| التصدير | الغرض |
|---|---|
| `id` | `'extract-images'` |
| `title` | عنوان عربي للفهرس |
| `mount(host?)` | يربط الإسقاط والقائمة. يستدعيه `setup`. يرمي إن غاب `#view-extract-images`. |
| `unmount()` | يفرّغ الجلسة ويحرّر عناوين المعاينة. **لا** تستدعِه عند مغادرة المسار. |
| `enter()` | يعيد خانة البيانات بعد `setOperation`. |
| `extractImagesTool` | شكل `router.js`: `{ id, name, icon, input, actionLabel, setup, enter, run, outputName }` |

`run` = حفظ الكل (زر خانة البيانات «حفظ الصور»).

## محركات موجودة (لا تثبيت)

- `window.PDFLib` — مشي XObject / Form / مظهر التعليقات
- `pdf.js` 3.11 — `getOperatorList` + `paintImageXObject` للصور السطرية وما تعجز pdf-lib عن فكّه
- كلمة المرور: `readPdfFile` / `resolvePassword` كباقي الأدوات
- pdf-lib لا تفكّ تشفير كلمة المستخدم؛ إن فشلت البنية نكمل بـ pdf.js (PNG مفكوك لا JPEG أصلي)

## حدود صادقة

- ليست OCR وليست رسماً للصفحة.
- JPEG مع SMask: يُحفظ JPEG كما خُزّن (بدون قناة ألفا).
- CMYK JPEG قد يظهر في المعاينة بألوان متغيّرة؛ الملف نفسه أصلي.
- `.jp2` قد لا تُعاين في المتصفح؛ الحفظ يعمل (`kind: jp2` → حوار بلا مرشّح في Electron).
