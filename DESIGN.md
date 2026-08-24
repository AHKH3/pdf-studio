---
name: PDF Studio
description: Arabic-first local PDF workbench. Lumen Glow v2 — white / black + single indigo halo. Evolution of Aurora 58677f4.
colors:
  accent: "#4F46E5"
  accent-hover: "#4338CA"
  accent-hi: "#6366F1"
  accent-deep: "#3730A3"
  accent-soft: "rgba(79,70,229,0.10)"
  accent-glow: "rgba(99,102,241,0.28)"
  accent-contrast: "#FFFFFF"
  ink: "#0F172A"
  ink-2: "#475569"
  ink-faded: "#64748B"
  bg: "#FFFFFF"
  bg-wash: "#F8F9FF"
  surface-1: "rgba(255,255,255,0.72)"
  surface-2: "rgba(255,255,255,0.88)"
  surface-3: "#FFFFFF"
  text-primary: "#0F172A"
  text-secondary: "#475569"
  text-muted: "#64748B"
  rule: "rgba(15,23,42,0.06)"
  rule-strong: "rgba(15,23,42,0.10)"
  border-glow: "rgba(99,102,241,0.18)"
  danger: "#E11D48"
  warning: "#A16207"
  success: "#059669"
  night-bg: "#050507"
  night-surface-1: "rgba(255,255,255,0.06)"
  night-surface-2: "rgba(255,255,255,0.10)"
  night-text: "#F8FAFC"
  night-accent: "#6366F1"
  night-glow: "rgba(99,102,241,0.35)"
typography:
  display:
    fontFamily: "Cairo, Noto Naskh Arabic, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 800
    lineHeight: 1.15
  headline:
    fontFamily: "Cairo, Noto Naskh Arabic, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
    lineHeight: 1.2
  wordmark:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
    lineHeight: 1
  body:
    fontFamily: "Inter, Cairo, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, Cairo, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.3
  data:
    fontFamily: "Inter, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  xs: "6px"
  sm: "10px"
  control: "999px"
  panel: "20px"
  xl: "28px"
spacing:
  gap: "8px"
  pad: "16px"
  titlebar: "56px"
  status: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "999px"
    padding: "11px 20px"
    shadow: "0 4px 14px rgba(99,102,241,0.28)"
  button-ghost:
    backgroundColor: "rgba(255,255,255,0.72)"
    textColor: "{colors.ink}"
    rounded: "999px"
    padding: "11px 20px"
    border: "1px solid rgba(15,23,42,0.06)"
---

# Design System: PDF Studio — Lumen Glow v2

## Overview

**North Star: «جلو بسيط ناضج» — Evolution of Aurora 58677f4**

نفس الجوهر الذي طلبته: **أبيض نقي للفاتح / أسود نقي للداكن + جلو هادئ واحد Indigo**. Lumen v2 ينضّج Aurora الأصلي لا يلغيه: يهدّئ قوس القزح، يخفّف الـ blur، ويوحّد التفاعل حول هالة واحدة.

- **مرجع الأصل:** `docs/design-aurora-legacy.md` — توثيق حرفي لكوميت `58677f4` (الصفحة الواحدة الأولى، الزجاج + Aurora بثلاث هالات).
- **المرجع المطوّر:** `docs/design-system-lumen.md` — المواصفة التنفيذية الكاملة.

## Colors

- **فاتح:** `--bg #FFFFFF` يغسل إلى `#F8F9FF`، زجاج `rgba(255,255,255,0.72)` بـ `blur 20px saturate 160%`، نص `slate-900 #0F172A`.
- **داكن:** `--bg #050507`، زجاج `rgba(255,255,255,0.06)`، نص `slate-50 #F8FAFC`.
- **اللمعة الوحيدة:** `Indigo #4F46E5` فاتح / `#6366F1` داكن، وهالة `--accent-glow 0.28 / 0.35`. لا بنفسجي-وردي-تيل معًا بعد الآن.
- كل التباينات `AA+` حتى فوق الهالة.

## Typography

- عناوين: `Cairo 800` (يفضّل) يسقط إلى `Noto Naskh Arabic` المضمّن محليًا.
- واجهة ونص: `Inter` يسقط إلى النظام.
- سلم: `display clamp(2rem,5vw,3rem)` للهيرو فقط، `title 1.45rem` للأدوات، `body 0.92rem / 1.6` للعربي.

## Layout

- **خلفية:** هالتان ثابتتان Indigo ضبابيتان (`blur 80–90px`, `opacity 0.16 فاتح / 0.44 داكن`) + طبقة `glass-noise` شفافة — أخف من ثلاث هالات الأصل.
- **شريط علوي:** `pill 999px` عائم `sticky top 14px`، عرض `min(calc(100% - 32px),1120px)`، زجاج `blur 20px`، ظل `0 4px 20px`.
- **مساحة العمل:** عرض `1120px` متوسط، بطاقة زجاج واحدة `radius 28/20` لا لوحات متناثرة.
- **شبكة البداية:** بعد الإسقاط، قائمة ملفات `flex wrap 260px` على زجاج واحد — لا شبكة 320px الثقيلة.
- **شريط حالة:** سفلي `sticky` بارتفاع `56px`، `blur 16px`، زر تنفيذ وحيد `pill accent`، خط تقدم `2px accent`.

## Components

### Aurora v2
هالتان فقط بلون واحد بدل ثلاث. `animation drift 28–34s` هادئة، `filter blur 80px`. في الفاتح `opacity 0.16`.

### Intake
`dashed 1.5px var(--border-strong)` على `surface-1`، `hover` يتحول لـ `solid accent` + `accent-soft` + `shadow-glow` ويرتفع `1px`. الهيرو `#hub-drop` بطاقة `560px` بظل مرتفع وهالة علوية `420px blur 18px`.

### Buttons
`pill 999px` بارتفاع `40px` (`32px compact`). الأساسي `accent` بظل جلو، الباقي `ghost surface-1`. `focus` حلقة مزدوجة `accent-soft + glow`. لا دوران، لا `scale` مبالغ.

### Hub Card (إن وجد)
`28px / 20px`, `padding 22px`, `blur 20px`, `hover -4px` + `border-glow + shadow-glow`, أيقونة `48px` تتحول لـ `accent` أبيض عند Hover. `radial-gradient at --mx --my` يبقى لكن `600px / 0.10` أهدأ.

### Doc Row
`grid 36px 56px 1fr auto`, `32px` للرقم بخلفية `accent-soft`, مصغّرة `56×68`, `border-soft` تتحول لـ `accent + 3px soft` عند التحديد.

## Don't

- لا بيج/ورق/صور/خطوط مسطرة — الأصل Aurora لم يكن كذلك.
- لا قوس قزح (أربع ألوان هالة) — هالة واحدة فقط.
- لا `blur 32px saturate 180%` ثقيل — `20px/160%` كحد أقصى.
- لا أزرار مربعة ثقيلة أو شريط جانبي — pill + قائمة عمودية خطية.
- لا نص مغسول على الزجاج — `slate-900` على `rgba(255,255,255,0.72)` يضمن AA.

## Files

- `docs/design-aurora-legacy.md` — الأصل كما كان.
- `docs/design-system-lumen.md` — النظام المطوّر (مرجع التنفيذ).
- `assets/css/app.css` — التطبيق (Lumen v2).
- `index.html` — `aurora` + `glass-noise` + الهيرو المحدث.
