# نظام التصميم الأصلي — Aurora Glow (الكوميت 58677f4)
> **المصدر:** أول إصدار صفحة واحدة للتطبيق `58677f4 feat: PDF Studio modular app`
> تاريخه 2026-04-05. هذا التوثيق مستخرج حرفيًا من `assets/css/app.css` + `index.html` في ذلك الكوميت.

---

## 1) الفكرة — Thesis

> **زجاج ضبابي + هالة (Glow) بسيطة + خلفية داكنة/فاتحة نقية.**
> لا ورق، لا صور، لا زخارف. كل البطاقات واللوحات زجاج `backdrop-filter: blur(24–32px) saturate(150–180%)` مع حدود شعرية شفافة. الهالة الوحيدة هي `--accent-glow` (إنديغو مضيء) تظهر في `focus`, `hover`, و`::before` الهادئ للوحة الزجاج.

الشعار البصري: ثلاث `aurora-blob` ضبابية (`blur 100px`) تتحرك ببطء (`drift 25–40s`) بألوان Indigo / Purple / Teal. في الوضع الفاتح تنخفض كثافتها إلى `opacity 0.25` و`blur 120px`.

---

## 2) التوكن — Tokens

### ألوان — Dark (الافتراضي)
```css
--bg: #030305;
--surface-0: rgba(255,255,255,0.02);
--surface-1: rgba(255,255,255,0.04);
--surface-2: rgba(255,255,255,0.08);
--border-soft: rgba(255,255,255,0.08);
--border-strong: rgba(255,255,255,0.16);
--text-main: #ffffff;
--text-muted: #a1a1aa;
--text-dim: #71717a;
--accent-1: #6366f1; /* Indigo */
--accent-2: #a855f7; /* Purple */
--accent-3: #ec4899; /* Pink */
--accent-4: #14b8a6; /* Teal */
--accent-glow: rgba(99,102,241,0.4);
--danger: #f43f5e;
```

### ألوان — Light (`body.light-theme`)
```css
--bg: #ffffff;
--surface-0: rgba(0,0,0,0.02);
--surface-1: rgba(255,255,255,0.7);
--surface-2: rgba(255,255,255,0.9);
--border-soft: rgba(0,0,0,0.05);
--border-strong: rgba(0,0,0,0.1);
--text-main: #0f172a;
--text-muted: #64748b;
--text-dim: #94a3b8;
--accent-1: #4f46e5;
--accent-glow: rgba(79,70,229,0.3);
```

### أنصاف أقطار
```css
--rd-xl: 32px; --rd-lg: 24px; --rd-md: 16px; --rd-sm: 8px;
```

### حركة
```css
--ease-fluid: cubic-bezier(0.2,0.8,0.2,1);
--ease-bouncy: cubic-bezier(0.175,0.885,0.32,1.275);
```

### تخطيط
```css
--page-max: 1280px; --workspace-max: 1120px; --copy-max: 760px;
```

### خطوط
- `Cairo` للعناوين / الشعار
- `Inter` للنص والواجهة

---

## 3) الخلفية — Aurora Engine

```html
<div class="aurora-container" aria-hidden="true">
  <div class="aurora-blob"></div>
  <div class="aurora-blob"></div>
  <div class="aurora-blob"></div>
</div>
<div class="glass-noise" aria-hidden="true"></div>
```

```css
.aurora-container { position: fixed; inset:0; background: var(--bg); }
.aurora-blob { filter: blur(100px); opacity:0.6; border-radius:50%; animation: drift 25s infinite alternate; }
.light-theme .aurora-blob { opacity:0.25; filter:blur(120px); }
.aurora-blob:nth-child(1){ background: radial-gradient(circle, var(--accent-1) 0%, transparent 70%); }
.aurora-blob:nth-child(2){ background: radial-gradient(circle, var(--accent-2) 0%, transparent 70%); }
.aurora-blob:nth-child(3){ background: radial-gradient(circle, var(--accent-4) 0%, transparent 70%); }
.glass-noise { background-image: url("data:image/svg+xml,...feTurbulence..."); opacity:0.05; }
```

**التأثير:** ضباب ملوّن هادئ خلف كل شيء، لا يلمس النص، لا يشتّت.

---

## 4) الملاحة — Nav Global (عائمة)

```css
.nav-global {
  position: fixed; top:24px; left:50%; transform:translateX(-50%);
  width: calc(100% - 48px); max-width:1200px; min-height:72px;
  border-radius: 100px; /* pill كاملة */
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 10px 40px rgba(0,0,0,0.06);
}
.brand-logo__text { background: linear-gradient(135deg, #fff, var(--text-muted)); -webkit-background-clip:text; }
```

- زر الرجوع `nav-btn-back` مخفي (`max-width:0; opacity:0`) ويظهر بانزلاق عند دخول مساحة عمل.
- زر الثيم `theme-btn` دائرة 44px زجاجية، `hover scale 1.1`.

---

## 5) الشبكة الرئيسية — Hub

```css
.hub-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr)); gap:24px; }
.hub-card {
  background: var(--surface-0);
  border: 1px solid var(--border-soft);
  border-radius: var(--rd-xl); padding:32px;
  backdrop-filter: blur(24px) saturate(150%);
  transition: transform 0.4s var(--ease-bouncy), border-color 0.4s;
}
.hub-card::before { background: radial-gradient(800px circle at var(--mx) var(--my), rgba(255,255,255,0.06), transparent 40%); }
.hub-card:hover { transform: translateY(-8px) scale(1.02); border-color: var(--border-strong); background: var(--surface-1); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5); }
.hub-card__icon { width:64px; height:64px; border-radius: var(--rd-lg); background: var(--surface-1); border:1px solid var(--border-soft); }
.hub-card:hover .hub-card__icon { color: var(--accent-1); border-color: var(--accent-glow); box-shadow: 0 0 20px var(--accent-glow); }
```

**التفاعل:** تتبع مؤشر `mousemove` يحدّث `--mx/--my` لإضاءة شعاعية خفيفة داخل البطاقة.

---

## 6) لوحة العمل — Glass Panel

```css
.glass-panel {
  background: linear-gradient(180deg, var(--surface-1), var(--surface-0));
  border: 1px solid var(--border-strong);
  border-radius: var(--rd-xl); padding:36px;
  backdrop-filter: blur(32px) saturate(180%);
  box-shadow: 0 24px 48px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
}
.glass-panel::before {
  content:""; position:absolute; top:-100px; left:50%; width:420px; height:220px;
  transform:translateX(-50%);
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 72%);
  filter: blur(10px); opacity:0.7;
}
```

---

## 7) مناطق الإسقاط — Drop Zone

```css
.drop-zone {
  border: 2px dashed var(--border-strong);
  border-radius: var(--rd-lg); padding:64px 24px; min-height:260px;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
}
.drop-zone:hover, .drop-zone.is-dragging {
  border-color: var(--accent-1);
  background: color-mix(in srgb, var(--accent-glow) 75%, transparent);
  transform: translateY(-2px) scale(1.005);
}
```

---

## 8) الأزرار — Buttons (حبوب / Pills)

```css
.btn { padding:14px 28px; border-radius:100px; font-weight:600; transition: all 0.3s var(--ease-bouncy); }
.btn--primary { background: var(--text-main); color: var(--bg); box-shadow: 0 4px 14px rgba(255,255,255,0.1); }
.btn--primary:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(255,255,255,0.2); }
.light-theme .btn--primary { background: var(--accent-1); color:#fff; }
.btn--outline { background: transparent; border:1px solid var(--border-strong); }
```

---

## 9) القوائم — Thumb List

```css
.thumb-card {
  display:grid; grid-template-columns: auto 96px minmax(0,1fr) auto;
  padding:16px 18px; border-radius:24px;
  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
  border:1px solid var(--border-soft);
}
.thumb-card__order { width:48px; height:48px; border-radius:16px; background: color-mix(in srgb, var(--accent-glow) 35%, transparent); }
.thumb-card.is-selected { border-color: color-mix(in srgb, var(--accent-1) 70%, var(--border-soft)); background: color-mix(in srgb, var(--accent-glow) 28%, transparent); }
```

- ترتيب رأسي خطي، سحب بالإمساك (`sortablejs`), أسهم دقيقة, حذف.

---

## 10) المدخلات — Inputs

```css
.input-field input { padding:14px 20px; border-radius: var(--rd-sm); border:1px solid var(--border-strong); background: var(--surface-0); }
.input-field input:focus { border-color: var(--text-main); background: var(--surface-1); }
```

---

## 11) الحركة — Motion

- `fadeInView` عند التبديل: `translateY(20px) scale(0.98) → 0` خلال `0.5s var(--ease-fluid)`
- `drift` للهالات: `translate + scale + rotate` بانسيابية
- كل `hover` يستخدم `var(--ease-bouncy)` لطابع مبهج خفيف.
- يحترم `prefers-reduced-motion` (غير موجود أصلاً لكن يوصى به).

---

## 12) إمكانية الوصول

- `skip-link`، تركيز `box-shadow: 0 0 0 4px var(--accent-glow)`، أيقونات `aria-hidden`.
- كل `View` هو `section[role=region]` مع `view--active / view--hidden`.

---

## 13) القيود الأصلية (للأرشفة)

- Indigo/Purple/Teal/Pink الأربعة تجعل الهالة "قوس قزح" أكثر مما ينبغي — يضعف التركيز.
- `surface-1: rgba(255,255,255,0.7)` في الفاتح يغسل النص على الهالات الساطعة.
- البطاقات 32px كبيرة جدًا على شاشات 1366px مع 15 أداة (المستقبل).
- لا تمييز بصري كافٍ بين `btn--primary` و`btn--outline` في الوضع الداكن (الاثنان أبيض/شفاف).
- `blur(32px) saturate(180%)` مكلف على Linux المدمج.
- لا نظام شبكة للفجوات/المسافات، لا مقياس طباعي موحد.

---

## 14) ما نحتفظ به حرفيًا في النظام المطوّر

- **جوهر الجلو البسيط:** `rgba(99,102,241,0.35)` كهالة وحيدة، `blur(24px)` كبصمة زجاج.
- **أبيض نقي / أسود نقي** كأرضية، لا بيج ولا ورق.
- **حبوب 100px** للأزرار الرئيسية، **32px/24px** للبطاقات.
- **الملاحة العائمة pill** — تبقى توقيعًا.
- **التفاعل الشعاعي** `radial-gradient at --mx --my` داخل البطاقة.

---

> هذا المستند مرجع لا يُعدّل. النظام المطوّر في `docs/design-system-lumen.md`.
