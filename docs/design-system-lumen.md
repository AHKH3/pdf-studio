---
name: Lumen Glow v2
based_on: Aurora Glow (58677f4)
kind: evolved minimal glow — white / black + single indigo halo
---

# Lumen Glow v2 — نظام التصميم المطوّر

> **التوجيه:** ننضج Aurora الأصلي لا نهجره. نحتفظ بـ "أبيض نقي / أسود نقي + جلو بسيط جدًا" ونحل مشاكله: قوس القزح المشتّت، الغسيل في الفاتح، تكلفة الـ blur، وفوضى البطاقات عند 15 أداة. النتيجة: زجاج أهدأ، هالة واحدة، شبكة أوضح، وحركة محسوبة.

---

## 1) المبادئ

1. **هالة واحدة، لا قوس قزح.** Indigo فقط (`--glow`) لكل تفاعل. التركيز أهم من الاستعراض.
2. **السطح زجاج خفيف لا لوح.** `blur(20–24px) saturate(160%)` كحد أقصى — أداء أفضل على لينكس.
3. **أبيض = ورقة، أسود = فراغ.** لا بيج، لا رمادي دافئ.
4. **التباين أولاً.** كل نص `AA+` على الزجاج، حتى فوق الهالة الخفيفة.
5. **الحركة تفسّر، لا تزيّن.** 120–200ms للواجهة، 400ms max للانتقال بين المسارات.

---

## 2) الألوان — Tokens

### الوضع الفاتح (`[data-theme="sheet"]` يحاكي `body.light-theme` سابقًا)
```css
--bg: #FFFFFF;                 /* أبيض نقي */
--bg-wash: #F8F9FF;             /* غسيل بارد خفيف حول الهالة — بديل radial */
--surface-0: rgba(15,23,42,0.03); /* للـ hover الخفيف على الأبيض */
--surface-1: rgba(255,255,255,0.72); /* الزجاج الأساس — كان 0.7 لكن مُحسّن */
--surface-2: rgba(255,255,255,0.88);
--surface-3: #FFFFFF;
--border-soft: rgba(15,23,42,0.06);
--border-strong: rgba(15,23,42,0.10);
--border-glow: rgba(99,102,241,0.18);
--text-main: #0F172A;   /* slate-900 */
--text-muted: #64748B;  /* slate-500 */
--text-dim: #94A3B8;    /* slate-400 */
--text-faint: #CBD5E1;  /* slate-300 للحدود فقط */
--accent: #4F46E5;      /* indigo-600 — الأساس الجديد */
--accent-hover: #4338CA;
--accent-soft: rgba(79,70,229,0.10);
--accent-glow: rgba(99,102,241,0.28); /* أهدأ من 0.4 الأصلي */
--glow: var(--accent-glow);
--danger: #E11D48;
--danger-soft: rgba(225,29,72,0.10);
--success: #059669;
```

### الوضع الداكن (`[data-theme="blueprint"]`)
```css
--bg: #050507;                 /* أسود نقي أهدأ من #030305 بقليل — أقل قسوة للعين */
--bg-wash: #0A0A0F;             /* هالة خلفية باردة جدًا */
--surface-0: rgba(255,255,255,0.03);
--surface-1: rgba(255,255,255,0.06); /* أخف من 0.04 الأصلي بقليل لقراءة أوضح */
--surface-2: rgba(255,255,255,0.10);
--surface-3: rgba(255,255,255,0.14);
--border-soft: rgba(255,255,255,0.07);
--border-strong: rgba(255,255,255,0.12);
--border-glow: rgba(99,102,241,0.22);
--text-main: #F8FAFC;
--text-muted: #94A3B8;
--text-dim: #64748B;
--accent: #6366F1;              /* indigo-500 — يلمع على الأسود */
--accent-hover: #818CF8;
--accent-soft: rgba(99,102,241,0.14);
--accent-glow: rgba(99,102,241,0.35);
--glow: var(--accent-glow);
```

### خرائط التوافق (للـ JS الحالي)
```css
[data-theme="sheet"]    { color-scheme: light; }
[data-theme="blueprint"]{ color-scheme: dark; }
/* aliases يحتاجها theme.js / syncWindowChrome */
--paper: none;
--board: var(--bg);
--sheet: var(--surface-1);
```

---

## 3) التايبوغرافي

- **عناوين / شعار:** `Cairo` 700–800 (عربي)، `Inter` 700 لللاتيني — نفس Aurora.
- **نص الواجهة:** `Inter` 400–600.
- **سلم مقاسات مطوّر:**

| Token | Size | Usage |
|---|---|---|
| `--t-display` | `clamp(2rem, 5vw, 3rem)` | عنوان الهيرو فقط |
| `--t-title` | `1.5rem` | عناوين الأدوات |
| `--t-subtitle` | `1.05rem` | وصف الأداة |
| `--t-body` | `0.95rem` | نص الفقرات |
| `--t-label` | `0.80rem` | تسميات الحقول |
| `--t-caption` | `0.75rem` | مساعد / ميتا |

- `line-height: 1.6` للنص العربي، `1.5` للواجهة.
- الأرقام `font-variant-numeric: tabular-nums` دائمًا.

---

## 4) القياسات والشبكة

```css
--page-max: 1280px;
--work-max: 1120px;
--content-max: 720px;
--header-h: 64px;
--footer-h: 56px;
--gap-xs: 6px; --gap-sm: 10px; --gap-md: 16px; --gap-lg: 24px; --gap-xl: 32px;
--radius-pill: 999px;
--radius-xl: 28px; /* كان 32 — أنقصناه لانضباط */
--radius-lg: 20px;
--radius-md: 14px;
--radius-sm: 10px;
--shadow-soft: 0 8px 30px rgba(0,0,0,0.06);
--shadow-elevated: 0 16px 40px rgba(0,0,0,0.10);
--shadow-glow: 0 0 0 1px var(--border-glow), 0 8px 24px var(--accent-glow);
```

**الشبكة:**
- `Nav pill` عائم ثابت.
- `Hub` شبكة `auto-fit minmax(260px, 1fr)` — كانت 280، صغّرناها لاستيعاب 15 أداة بدون تمرير مفرط.
- داخل كل أداة: `glass-panel` واحد بعرض `work-max` متوسط، لا لوحات متعددة متناثرة.
- كل قائمة ملفات عمودية `flex column gap 10px` — لا شبكة مربعة تشتّت الترتيب.

---

## 5) الخلفيات — Aurora v2 (أهدأ)

```css
.aurora { position: fixed; inset:0; z-index:0; pointer-events:none; background: var(--bg); }
.aurora__blob { position:absolute; border-radius:50%; filter: blur(80px); opacity:0.45; }
.aurora__blob--1 { width:52vw; height:52vw; top:-14%; left:-10%; background: radial-gradient(circle, rgba(99,102,241,0.9) 0%, transparent 68%); }
.aurora__blob--2 { width:48vw; height:48vw; bottom:-18%; right:-8%; background: radial-gradient(circle, rgba(99,102,241,0.55) 0%, transparent 70%); animation-delay: -8s; }
[data-theme="sheet"] .aurora__blob { opacity:0.18; filter: blur(90px); }
.glass-noise { position: fixed; inset:0; opacity:0.035; background-image: url("data:image/svg+xml,...feTurbulence 0.9..."); }
```

**التغيير عن الأصل:** هالتان فقط بلون واحد (indigo) بدل ثلاث ألوان قوس قزح. أهدأ، أرخص، ويركز الانتباه على المحتوى لا الخلفية.

---

## 6) الملاحة — Nav Pill v2

- تبقى `pill 999px` لكن `height 64px` (كانت 72 — أرشق).
- `padding: 10px 16px 10px 20px`، `gap 12px`.
- الزجاج: `background: var(--surface-1); border: 1px solid var(--border-soft); backdrop-filter: blur(20px) saturate(160%);`
- الشعار: `Cairo 800 1.2rem` + أيقونة 22px داخل مربع 36px بلمسة `accent-soft`.
- زر الأدوات في الشريط العلوي (legend) يتحول من `pill شفافة` إلى `accent` عند النشاط فقط — لا ألوان متعددة.

---

## 7) البطاقات — Hub Card v2

```css
.hub-card {
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  padding: 22px 20px;
  backdrop-filter: blur(20px) saturate(160%);
  transition: transform 180ms var(--ease), border-color 180ms, box-shadow 180ms;
}
.hub-card::after { /* halo الداخلي عند hover — أخف من الأصل */
  content:""; position:absolute; inset:0; border-radius:inherit;
  background: radial-gradient(600px circle at var(--mx,50%) var(--my,50%), var(--accent-soft), transparent 55%);
  opacity:0; transition: opacity 220ms;
}
.hub-card:hover { transform: translateY(-4px); border-color: var(--border-glow); box-shadow: var(--shadow-glow); }
.hub-card:hover::after { opacity:1; }
.hub-card__icon { width:48px; height:48px; border-radius:14px; background: var(--surface-2); border:1px solid var(--border-soft); }
.hub-card:hover .hub-card__icon { background: var(--accent); color:#fff; border-color: var(--accent); }
```

**التحسينات:** حركة أقل (`-4px` بدل `-8px + scale`), أيقونة 48 بدل 64 (كثافة أفضل)، لا دوران `-5deg` المشتّت.

---

## 8) لوحة الزجاج — Glass Panel v2

```css
.glass-panel {
  background: var(--surface-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(20px) saturate(160%);
  box-shadow: var(--shadow-soft);
}
.glass-panel::before { /* هالة علوية خفيفة — كانت 420×220 مع blur10، الآن 360×140 blur 24 */
  content:""; position:absolute; top:-60px; left:50%; width:360px; height:140px;
  transform:translateX(-50%);
  background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);
  filter: blur(18px); opacity:0.5; pointer-events:none;
}
```

---

## 9) منطقة الإسقاط — Intake v2

```css
.intake {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-0);
  min-height: 220px; padding: 36px 24px;
  transition: border-color 160ms, background 160ms, transform 160ms;
}
.intake:hover, .intake.is-over {
  border-color: var(--accent);
  background: var(--accent-soft);
  border-style: solid;
}
.intake__title { font-size: 1rem; font-weight: 700; color: var(--text-main); }
.intake__hint { font-size: 0.8rem; color: var(--text-muted); }
/* حالة الهيرو (البداية) */
.intake--hero { min-height: 320px; border-style: dashed; background: var(--surface-1); }
```

**الهيرو الجديد:** عنوان ضخم `clamp(2rem,5vw,3rem)` + سطر ثانوي + زر `تصفّح` واحد `pill accent`. لا صور، لا نصوص طويلة.

---

## 10) الأزرار — Buttons v2

```css
.btn { display:inline-flex; align-items:center; gap:8px; padding: 11px 20px; border-radius: var(--radius-pill); font-weight:600; font-size:0.9rem; border:1px solid transparent; cursor:pointer; transition: all 160ms var(--ease); }
.btn--primary { background: var(--accent); color:#fff; box-shadow: 0 4px 16px var(--accent-glow); }
.btn--primary:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 8px 20px var(--accent-glow); }
.btn--ghost { background: var(--surface-1); border-color: var(--border-soft); color: var(--text-main); }
.btn--ghost:hover { background: var(--surface-2); border-color: var(--border-strong); }
.btn--subtle { background: transparent; border-color: transparent; color: var(--text-muted); }
.btn--danger { background: var(--danger); color:#fff; }
.btn:disabled { opacity:0.45; cursor:not-allowed; transform:none; box-shadow:none; }
.btn:focus-visible { outline:none; box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 5px var(--accent-glow); }
```

**القاعدة:** زر أساسي واحد لكل شاشة (`تنفيذ` في الشريط السفلي) — الباقي `ghost`. لا زرّان أساسيان يتنافسان.

---

## 11) القوائم والملفات — Doc List v2

```css
.doclist { display:flex; flex-direction:column; gap:10px; }
.docrow {
  display:grid; grid-template-columns: 36px 56px minmax(0,1fr) auto;
  align-items:center; gap:12px; padding:10px 12px;
  background: var(--surface-1); border:1px solid var(--border-soft); border-radius: var(--radius-md);
}
.docrow:hover { border-color: var(--border-strong); }
.docrow.is-selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.docrow__index { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; background: var(--accent-soft); color: var(--accent); font-weight:800; font-size:0.8rem; }
.docrow__thumb { width:56px; height:72px; border-radius:10px; overflow:hidden; background: var(--surface-2); border:1px solid var(--border-soft); }
.rowbtn { width:32px; height:32px; border-radius:10px; display:grid; place-items:center; border:1px solid var(--border-soft); background: var(--surface-1); color: var(--text-muted); }
.rowbtn:hover { background: var(--surface-2); color: var(--text-main); }
.rowbtn--danger:hover { background: var(--danger-soft); color: var(--danger); border-color: transparent; }
```

- الترتيب: سحب بالمقبض + أسهم صغيرة، لا بطاقات كبيرة ثقيلة.
- الصورة المصغرة `object-fit: contain` على خلفية `surface-2`.

---

## 12) الحقول — Fields v2

```css
.field label { font-size:0.78rem; font-weight:600; color: var(--text-muted); margin-bottom:6px; display:block; }
.field input, .field select {
  width:100%; height:40px; padding: 0 12px;
  border:1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-3); color: var(--text-main); font-size:0.9rem;
}
.field input:focus, .field select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline:none; }
.fieldset { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap:14px; padding:16px; background: var(--surface-0); border:1px solid var(--border-soft); border-radius: var(--radius-md); }
```

---

## 13) شريط الحالة — Titleblock v2

- يبقى سفلي ثابت `height 56px`.
- خلفية `var(--surface-1)` بضبابية، حدود علوية `1px solid var(--border-soft)`.
- شريط التقدم: خط `2px` بلون `var(--accent)` ينبض `scaleX` عند `data-state="busy"`.
- زر التنفيذ الوحيد `btn--primary pill` يمينًا.

---

## 14) الحركة

```css
--ease: cubic-bezier(0.2,0.8,0.2,1);
--ease-out: cubic-bezier(0,0,0.2,1);
--dur-fast: 140ms; --dur-base: 180ms; --dur-slow: 280ms;
@keyframes fadeIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
@keyframes drift { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(3%,6%) scale(1.04)} 100%{transform:translate(-2%,-3%) scale(0.99)} }
```

- كل دخول `view` هو `fadeIn 280ms var(--ease)`.
- `prefers-reduced-motion: reduce` يلغي `drift` و`fadeIn`.

---

## 15) الاستجابة

- `> 1100px`: شبكة 3 أعمدة للـ hub، لوحة عمل 1120px متوسط.
- `900–1100px`: شبكة 2، حشوة 24px.
- `< 640px`: عمود واحد، `nav pill` تصغر، البطاقة `padding 16px`، `docrow` يلتفّ إلى عمودين.

---

## 16) الوصول

- كل زر `min-height 40px` (لمس).
- تركيز `box-shadow` مزدوج واضح في الفاتح والداكن.
- `skip-link`, `aria-hidden` للزخارف, `role=region` لكل view.

---

## 17) ما تغيّر باختصار

| الأصل | المطوّر |
|---|---|
| 3 هالات بألوان قوس قزح | هالتان بلون واحد indigo |
| blur 32px + saturate 180% | blur 20px + 160% |
| بطاقة 32px + حركة -8px scale | 28px + -4px |
| أيقونة 64px بدوران | 48px ثابتة |
| نصوص متوسطة التباين في الفاتح | slate-900 على أبيض نقي AA |
| بطء بسبب 3 blobs | أخف، blob واحد أقل |

---

> هذا المستند هو المرجع التنفيذي. التطبيق في `assets/css/app.css` و`index.html`.
