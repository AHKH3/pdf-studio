# توقيع وختم (`sign`)

أداة Fill & Sign محلية: رسم توقيع، كتابة اسم، ختم صورة، وختم تاريخ. تُوضع على صفحات PDF بالسحب وتغيير الحجم، ثم تُدمج في ملف مسطّح عبر `pdf-lib`. **لا تملأ حقول AcroForm.** بلا شبكة وبلا باي وول.

هذه الحزمة معزولة. لا تغيّر `index.html` ولا الموجّه حتى يربطها الدامج.

## الملفات

| ملف | دور |
|---|---|
| `manifest.js` | التصدير العام `{ id, title, mount, unmount }` |
| `app.js` | الحالة، الاستقبال، الوضع، الحفظ |
| `ui.js` | واجهة عربية + أنماط النطاق |
| `preview.js` | معاينة الصفحة + سحب/تحجيم الأختام |
| `pad.js` | لوحة رسم التوقيع |
| `png.js` | تحويل النص/الصورة إلى PNG (العربية تُرسم كصورة) |
| `flatten.js` | `drawImage` فوق الصفحات — بدون `getForm()` |
| `hub-fragment.html` | بطاقة الفهرس/البداية (غير مربوطة) |

## كيف يعمل

1. المستخدم يفتح PDF (سحب أو تصفّح).
2. يختار أداة: رسم / اسم / صورة / تاريخ، ثم **ضع على هذه الصفحة** (أو كل الصفحات).
3. يسحب الختم ويغيّر حجمه من الزوايا. الأسهم تحرّك المحدد، Delete يحذفه.
4. **توقيع وحفظ** يحمّل المستند بـ pdf-lib ويرسم كل ختم PNG على الصفحة ثم `saveFile`.

الإحداثيات تُحفظ في فضاء الصفحة المرئي (أصل أسفل-يسار). عند التصدير تُحوَّل إلى صندوق الوسائط إذا كانت الصفحة `/Rotate`.

## ربط الدامج

بعد `initPdfEngines()` في الإقلاع.

### 1. أيقونة الفهرس — `index.html` داخل `.sprite`

الصاروخ موجود معلّقاً في `hub-fragment.html` (`#icon-sign`).

### 2. شاشة فارغة — `index.html` داخل `#work`

```html
<section id="view-sign" class="view" aria-labelledby="sign-title" role="region" hidden></section>
```

اترك القسم فارغاً. `mount` يملأ العنوان والجسم.

### 3. بطاقة البداية (اختياري)

انسخ الزر من `hub-fragment.html` إلى `.start`.

### 4. التسجيل — `assets/js/main.js`

```js
import { asTool } from "./tools/sign/manifest.js";

registerTools([
  startTool,
  // ... الأدوات الحالية ...
  asTool()
]);
```

`asTool()` يطابق typedef الموجود في `assets/js/ui/router.js`:

- `setup` يستدعي `mount(document.getElementById("view-sign"))`
- `enter` يحدّث خانة البيانات
- `run` يفلّت الملف عبر الزر السفلي «توقيع وحفظ»

لا تُلغِ التثبيت عند مغادرة الشاشة؛ الحالة تبقى مثل العلامة المائية. `unmount` للتفكيك الكامل فقط.

### 5. ربط يدوي (بدون `asTool`)

```js
import sign, { run } from "./tools/sign/manifest.js";

sign.mount(document.getElementById("view-sign"));
// onRun في setOperation: () => run()
```

`mount` يحقن `<style id="pdf-studio-sign-styles">` ويعيد استخدام أصناف التطبيق (`.intake`, `.scan`, `.btn`, `.field`…). لا حاجة لتعديل `assets/css`.

## حدود النسخة

- ليست محرّر نماذج، ليست Adobe Sign، ليست شهادة PKI.
- النص العربي يُرسم كصورة (نفس أسلوب العلامة المائية) لأن خطوط pdf-lib لا تغطي العربية.
- قبول الصور: PNG / JPEG / WEBP. لا HEIC.
- بلا اعتمادات npm جديدة.
