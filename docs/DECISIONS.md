# Decisions

## 2026-08-24 — نشر على الويب + إصدارات تلقائية + تحديثات للمستخدمين

- **الطلب:** صفحة هبوط تُنشر على الويب بروابط تنزيل، إصدارات تلقائية عند كل push/tag، وقناة تحديثات تلقائية للمستخدمين المثبّتين.
- **القرار:**
  1. صفحة هبوط ثابتة في `landing/` تُنشر على GitHub Pages (workflow: `.github/workflows/pages.yml`) — بدون أي خدمات خارجية.
  2. إصدارات تلقائية عبر GitHub Actions عند دفع tag بصيغة `v*` (workflow: `.github/workflows/release.yml`) — بناء ويندوز (NSIS + Portable) ولينكس (AppImage) ونشرها على GitHub Releases.
  3. تحديثات تلقائية عبر `electron-updater` بمزوّد GitHub — تُفعّل في النسخ المثبّتة فقط (`app.isPackaged`)، تنزيل صامت ثم سؤال المستخدم عن إعادة التشغيل، وتثبيت عند الإغلاق كخيار احتياطي. النسخة المحمولة لا تُحدَّث ذاتيًا (سلوك electron-updater الطبيعي).
- **التأثير:** النشر يتطلب رفع الكود إلى `github.com/abdo3342/pdf-studio` وتمكين GitHub Pages من الفرع `gh-pages` (أو مصدر workflow). أول إصدار يبدأ بدفع tag مثل `v1.0.1`. حجم الحزمة سيزداد قليلًا بحزمة `electron-updater`.
