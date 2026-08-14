# حماية وإزالة الحماية (`protect`)

أداة مستقلة لـ PDF Studio: حماية PDF بكلمة سر **AES-256** عبر `qpdf-wasm`، وإزالة الحماية **فقط** عندما يعرف المستخدم كلمة السر. لا تخمين ولا كسر. كل المعالجة محلية.

## الملفات

| ملف | دور |
|---|---|
| `manifest.js` | العقد العام: `id`, `title`, `mount`, `unmount`, و`protectTool` للموجّه |
| `hub-fragment.html` | مقطع الشاشة للصقه في `index.html` داخل `#work` |
| `ui.js` | الواجهة العربية، التبويبان، الاستقبال، الحفظ |
| `engine.js` | عامل qpdf: تشفير / فك تشفير |
| `qpdf.worker.js` | عامل Web Worker يحمّل WASM |
| `copy-qpdf.mjs` | ينسخ زمن تشغيل `qpdf-wasm` إلى `vendor/` |
| `vendor/qpdf.js` + `vendor/qpdf.wasm` | زمن تشغيل qpdf (يُنسَخ من `node_modules`) |
| `vendor/LICENSE` | رخصة Apache-2.0 لحزمة `qpdf-wasm` |

لا تعدّل `index.html` أو `assets/css` أو `electron` من داخل هذه الأداة — الدمج خطوة لاحقة للمُدمِج.

## كيف يُستخدم qpdf-wasm

1. الاعتماد الوحيد المضاف: `qpdf-wasm` في `package.json` (`npm install qpdf-wasm`).
2. Electron لا يقدّم `node_modules` للرندرر ولا يضمّه في الحزمة (`files`: `electron`, `index.html`, `assets`). لذلك يُنسَخ `qpdf.js` و`qpdf.wasm` إلى `assets/js/tools/protect/vendor/` عبر:

```
node assets/js/tools/protect/copy-qpdf.mjs
```

3. العامل `qpdf.worker.js` يستورد `./vendor/qpdf.js` ويمرّر `locateFile` إلى `qpdf.wasm` المجاور.
4. الحماية (AES-256):

```
qpdf in.pdf --encrypt USER OWNER 256 --print=full --extract=y -- out.pdf
```

كلمة سر الفتح وكلمة سر المالك متطابقتان في هذه النسخة (فتح الملف = صلاحيات كاملة).

5. إزالة الحماية (محاولة واحدة بكلمة المستخدم، بلا حلقة تخمين):

```
qpdf --password=USER --decrypt in.pdf out.pdf
```

إن كانت كلمة السر فارغة وكان الملف قيود صلاحيات فقط (بدون كلمة فتح)، تُستدعى `--decrypt` بلا `--password`.

6. البناء pthread + `SharedArrayBuffer`. خادم Electron الحالي لا يرسل رأسي العزل؛ بدونها يفشل المحرّك برسالة عربية. أضف على استجابة الملفات الثابتة في `electron/main.cjs`:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`worker-src 'self'` و`application/wasm` موجودان مسبقاً. لا ترفع ملفات إلى شبكة.

## دمج الأداة في التطبيق

1. الصق محتوى `hub-fragment.html` داخل `<main id="work">` كقسم `.view` إضافي. الأيقونة `#icon-lock` موجودة في الـ sprite.
2. في `assets/js/main.js`:

```js
import { protectTool } from "./tools/protect/manifest.js";
```

وأضف `protectTool` إلى مصفوفة `registerTools([...])`.

3. بعد `npm install qpdf-wasm` (أو بعد استنساخ المستودع) شغّل `copy-qpdf.mjs` إن لم تكن ملفات `vendor/` موجودة.
4. أضف رأسي COOP/COEP أعلاه حتى يعمل WASM.
5. لا تسجّل الأداة مرتين. `setup` يحقن القسم فقط إن لم يوجد `#view-protect`.

`protectTool` يطابق عقد `registerTools`: `id`, `name`, `icon`, `input`, `setup`, `enter`, `leave`, `run`, `outputName`. زر التنفيذ في خانة البيانات السفلية. إن استدعيت `mount(host)` خارج الموجّه يظهر زر حفظ داخل الشاشة.

## سلوك المستخدم

- تبويب **حماية بكلمة سر**: كلمة + تأكيد، AES-256، الملف يبقى على الجهاز.
- تبويب **إزالة الحماية**: حقل كلمة السر المعروفة فقط. رسالة صريحة: لا كسر ولا تخمين.
- ملف محمي مسبقاً لا يُعاد تشفيره؛ يُطلب الانتقال إلى إزالة الحماية.
- الواجهة عربية RTL. حقول كلمة السر `dir="ltr"` لأن كلمات السر غالباً لاتينية، مع السماح بأي محارف UTF-8 يمرّرها qpdf.

## ما لن تلمسه هذه الأداة

`index.html`, `assets/css/**`, `assets/fonts/**`, `electron/**`, `docs/**`, `DESIGN.md`, وأي ملف JS قائم خارج `assets/js/tools/protect/**` — ما عدا إضافة `qpdf-wasm` إلى `package.json`.
