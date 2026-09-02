---
name: PDF Studio
description: Arabic-first local PDF workbench. Lumen Glow v2 — mature pure white / pure black + refined indigo halo + precision elevation layers.
colors:
  accent: "#4F46E5"
  accent-hover: "#4338CA"
  accent-hi: "#6366F1"
  accent-deep: "#3730A3"
  accent-soft: "rgba(79,70,229,0.10)"
  accent-glow: "rgba(99,102,241,0.22)"
  accent-contrast: "#FFFFFF"
  ink: "#0F172A"
  ink-2: "#334155"
  ink-faded: "#52637A"
  bg: "#FFFFFF"
  bg-wash: "#F8F9FF"
  surface-1: "rgba(255,255,255,0.78)"
  surface-2: "rgba(255,255,255,0.92)"
  surface-3: "#FFFFFF"
  text-primary: "#0F172A"
  text-secondary: "#334155"
  text-muted: "#52637A"
  text-dim: "#64748B"
  rule: "rgba(15,23,42,0.08)"
  rule-strong: "rgba(15,23,42,0.14)"
  border-glow: "rgba(99,102,241,0.20)"
  danger: "#E11D48"
  warning: "#A16207"
  success: "#059669"
  night-bg: "#050507"
  night-surface-1: "rgba(255,255,255,0.06)"
  night-surface-2: "rgba(255,255,255,0.10)"
  night-surface-3: "#121216"
  night-text: "#F8FAFC"
  night-text-muted: "#94A3B8"
  night-accent: "#6366F1"
  night-border-soft: "rgba(255,255,255,0.09)"
  night-border-strong: "rgba(255,255,255,0.15)"
typography:
  display:
    fontFamily: "Amiri, Noto Naskh Arabic, serif"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.15
  headline:
    fontFamily: "Amiri, Noto Naskh Arabic, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  wordmark:
    fontFamily: "Playfair Display, serif"
    fontSize: "1rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
    lineHeight: 1
  body:
    fontFamily: "Noto Naskh Arabic, Amiri, serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Noto Naskh Arabic, Amiri, serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.35
  caption:
    fontFamily: "Noto Naskh Arabic, Amiri, serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  data:
    fontFamily: "Playfair Display, Noto Naskh Arabic, serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  pill: "999px"
  control: "999px"
  panel: "20px"
spacing:
  gap: "8px"
  pad: "16px"
  titlebar: "40px"
  status: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "999px"
    padding: "10px 20px"
    shadow: "0 2px 6px rgba(79,70,229,0.25), 0 1px 2px rgba(15,23,42,0.08)"
  button-ghost:
    backgroundColor: "rgba(255,255,255,0.78)"
    textColor: "{colors.ink}"
    rounded: "999px"
    padding: "10px 20px"
    border: "1px solid rgba(15,23,42,0.08)"
---

# Design System: PDF Studio — Lumen Glow v2 (Impeccable Edition)

## Overview

**North Star: «جلو بسيط ناضج» — High-Craft Evolution of Aurora**

نفس الجوهر العربي الأصيل: **أبيض نقي للفاتح / أسود نقي للداكن + هالة Indigo هادئة ونقية + طبقات زجاجية متزنة وواضحة**. تم صقل النظام بموجب معايير **Impeccable Design** لمعالجة كل الـ Anti-patterns: ضبط التباين إلى WCAG AA صارم، تحديد أرضية القراءة الوظيفية عند 12px، واستبدال التوهجات العشوائية بطبقات Elevation طبيعية.

## Colors & Contrast

- **فاتح:** `--bg #FFFFFF` يغسل إلى `#F8F9FF`، زجاج `rgba(255,255,255,0.78)` بـ `blur 16px`، نص أساسي `slate-900 #0F172A`، نص خافت `slate-600 #52637A` يضمن تباين `5.2:1+` (فوق متطلب WCAG AA 4.5:1).
- **داكن:** `--bg #050507`، زجاج `rgba(255,255,255,0.06)`، نص أساسي `slate-50 #F8FAFC`، نص خافت `slate-400 #94A3B8` بتباين `8:1+`.
- **اللمعة التفاعلية:** `Indigo #4F46E5` فاتح / `#6366F1` داكن.

## Typography & Scale Ramp

- **عناوين رئيسية وشعارات:** `Amiri` 700 (عربي نقي أصيل).
- **واجهة المستخدم، الأزرار، التسميات، والمحتوى:** `Noto Naskh Arabic` 400–700.
- **الأرقام، الشعار اللاتيني، والبيانات:** `Playfair Display`.
- **سلم القياسات (Ramp):**
  - Display: `clamp(2rem, 5vw, 3rem)`
  - Title/Headline: `1.5rem` (24px)
  - Subtitle: `1.125rem` (18px)
  - Base Body: `0.9375rem` (15px)
  - Small / Label: `0.8125rem` (13px)
  - Minimum Functional Floor: `0.75rem` (12px) — لا توجد نصوص وظيفية تفاعلية تحت 12px.

## Radii Scale

- `xs: 6px` — عناصر مصغرة وعلامات الحالة.
- `sm: 10px` — حقول الإدخال، القوائم الصغيرة، وأزرار الأدوات.
- `md: 14px` — بطاقات مصغرة، شارات، وModals فرعية.
- `lg: 20px` — حاويات الأدوات، ألواح العمل الرئيسية.
- `xl: 28px` — البطاقة الحاضنة الكبرى.
- `pill: 999px` — أزرار التفاعل الرئيسية، التابات، وحبوب الحالة.

## Elevation & Depth (Shadows)

- لا يتم استخدام 1px border مع ظل مشتت واسع (GPT tell). بدلاً من ذلك، نستخدم ظلال Elevation طبقية تجمع بين ظل ambient ناعم وظل key-light دقيق:
  - `--shadow-soft`: `0 2px 8px rgba(15,23,42,0.04), 0 1px 2px rgba(15,23,42,0.03)`
  - `--shadow-elevated`: `0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)`
  - `--shadow-panel`: `0 16px 40px rgba(15,23,42,0.12), 0 4px 12px rgba(15,23,42,0.06)`

## Performance & Micro-Interactions

- كل الانتقالات والحركات التفاعلية تتم عبر الخصائص المسرعة عتادياً (`transform` و `opacity`).
- منع الـ Layout Thrashing (لا تحريك لـ `width`, `height`, `padding`, `margin`).
