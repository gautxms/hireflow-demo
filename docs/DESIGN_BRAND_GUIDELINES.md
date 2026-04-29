# HireFlow Brand & Design Guidelines

**Version:** 3.0  
**Date:** April 20, 2026  
**Status:** Final — Fonts confirmed from git history (commit 84be072)  
**Purpose:** Establish consistent color, typography, and visual identity across hireflow.dev

> ✅ **Font source of truth:** Confirmed via `git show 84be072:index.html` and `git show 84be072:src/index.css`.  
> The original Google Fonts URL was:  
> `https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap`

> ⚠️ **Version history:** v1.0 (Apr 14) incorrectly specified Inter/Neue Haas Grotesk. v2.0 (Apr 20) guessed Clash Display. This v3.0 is confirmed correct from the actual codebase.

---

## EXECUTIVE SUMMARY

HireFlow uses a **modern dark theme** with **high-contrast lime-green accents**. The brand is:
- **Bold & Energetic** — massive stacked display typography, high contrast
- **Clean & Professional** — minimal dark palette, generous whitespace
- **AI-Forward** — sleek, tech-focused, dark-first aesthetic

---

## 1. COLOR PALETTE

### 1.1 Background — HireFlow Black
- **Hex:** `#0a0a0a`
- **Usage:** Page background, all dark surfaces

### 1.2 Accent — Lime Green (Primary)
- **Hex:** `#c8ff00`
- **Usage:** Logo "Flow" text, "Faster." hero word, primary CTA buttons, hover states, focus rings, badge text

### 1.3 Accent — Mint Green (Gradient endpoint)
- **Hex:** `#39ff9f`
- **Usage:** End color of the "Faster." gradient only. Do NOT use standalone.

### 1.4 "Faster." Gradient
- **CSS:** `background: linear-gradient(90deg, #c8ff00, #39ff9f)`
- **Applied as:** `background-clip: text` + `-webkit-text-fill-color: transparent`
- **Usage:** The "Faster." hero word ONLY

### 1.5 Text — Primary White
- **Hex:** `#ffffff`
- **Usage:** Hero headline ("Hire", "Smarter."), all H1–H4 headings

### 1.6 Text — Body Grey
- **Hex:** `#aaaaaa`
- **Usage:** Body paragraph text, subtitles under hero

### 1.7 Text — Nav / Muted Grey
- **Hex:** `#888888`
- **Usage:** Navigation link items ("Features", "Upgrade", "About", "Help")

### 1.8 Surface — Card Background
- **Hex:** `#111111`
- **Usage:** Cards, modals, elevated panels

### 1.9 Border
- **Hex:** `#1e1e1e`
- **Usage:** Card borders, dividers, input borders

### 1.10 Semantic Colors (Admin/UI only)
| Name | Hex | Usage |
|------|-----|-------|
| Success | `#10b981` | Checkmarks, success states |
| Error | `#ef4444` | Error messages, destructive actions |
| Info | `#3b82f6` | Info tooltips, informational states |

### Color Contrast (WCAG)
| Foreground | Background | Contrast | Level |
|-----------|-----------|----------|-------|
| `#ffffff` | `#0a0a0a` | 20.0:1 | AAA |
| `#c8ff00` | `#0a0a0a` | 15.3:1 | AAA |
| `#aaaaaa` | `#0a0a0a` | 7.0:1 | AAA |
| `#888888` | `#0a0a0a` | 4.5:1 | AA |

---

## 2. TYPOGRAPHY

### ✅ Confirmed Fonts (from git commit 84be072)

| Role | Font | Weights loaded |
|------|------|---------------|
| **Display / Hero** | **Syne** | 400, 600, 700, **800** |
| **UI / Body / Nav / Buttons** | **DM Sans** | 300, 400, 500 (+ italic variants) |

### 2.5 Typography Token Enforcement (Lint Guidance)

- Do **not** declare `fontFamily` directly in JSX inline styles.
- Prefer shared typography classes/tokens (`.type-h1`, `.type-h2`, `.type-h3`, `.type-body`, `.type-small`, `.type-nav`, `.type-button`).
- ESLint enforcement pattern:

```js
'no-restricted-syntax': [
  'error',
  {
    selector: "JSXAttribute[name.name='style'] Property[key.name='fontFamily']",
    message: 'Use typography tokens/classes instead of inline fontFamily declarations.',
  },
]
```

---

### 2.1 Display Font — Syne

**Used for:** Hero H1 ONLY — the "Hire", "Smarter.", "Faster." stacked headline.

Syne is a geometric display typeface whose letterforms get dramatically **wider and rounder** as weight increases. At weight 800 it produces the ultra-bold, wide, rounded characters seen in the original screenshots. This is what made the hero feel so distinctive — it is not a standard grotesque.

```css
/* Already in index.html — do not remove or change this link */
/* family=Syne:wght@400;600;700;800 */

font-family: 'Syne', sans-serif;
font-weight: 800;
```

### 2.2 UI Font — DM Sans

**Used for:** Everything that is NOT the hero headline — navigation, body text, buttons, cards, forms, labels, badges, admin UI.

DM Sans is a low-contrast geometric sans-serif optimised for small-to-medium sizes on screens. Clean, neutral, highly readable.

```css
/* Already in index.html — do not remove or change this link */
/* family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;... */

font-family: 'DM Sans', sans-serif;
```

---

### 2.3 Typography Scale

| Role | Element | Font | Size | Weight | Color | Line Height | Letter Spacing |
|------|---------|------|------|--------|-------|-------------|----------------|
| **Hero H1** | "Hire" / "Smarter." / "Faster." | **Syne** | `clamp(72px, 11vw, 120px)` | **800** | #fff / gradient | **0.92** | **-0.03em** |
| H2 | Section headers | DM Sans | 48px | 700 | #ffffff | 1.15 | -0.02em |
| H3 | Subsection | DM Sans | 32px | 600 | #ffffff | 1.25 | -0.01em |
| H4 | Card titles | DM Sans | 20px | 600 | #ffffff | 1.35 | 0 |
| Body | Paragraphs | DM Sans | 16–18px | 400 | #aaaaaa | 1.65 | 0 |
| Small | Helper text | DM Sans | 14px | 400 | #888888 | 1.5 | 0 |
| Nav | Navigation links | DM Sans | 15px | 400 | #888888 | 1.4 | 0 |
| Button | CTA text | DM Sans | 15–16px | 600 | varies | 1.4 | 0 |

---

### 2.4 Hero Section Layout — MOST CRITICAL RULE

The hero headline **must be stacked vertically** with each word on its own line via `display: block`. This single rule is what made the original design so impactful. Any AI tool that collapses "Hire Smarter." onto one line has broken the design.

**Correct JSX:**
```jsx
<h1 className="hero-title">
  <span className="hero-line">Hire</span>
  <span className="hero-line">Smarter.</span>
  <span className="hero-line hero-accent">Faster.</span>
</h1>
```

**Correct CSS:**
```css
.hero-title {
  font-family: 'Syne', sans-serif;
  font-size: clamp(72px, 11vw, 120px);
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: -0.03em;
  color: #ffffff;
  margin: 0;
}

.hero-line {
  display: block;   /* ← Each word on its own line. Never remove this. */
}

.hero-accent {
  background: linear-gradient(90deg, #c8ff00, #39ff9f);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

**If using Tailwind:**
```jsx
<h1 className="font-['Syne'] text-[clamp(72px,11vw,120px)] font-extrabold leading-[0.92] tracking-[-0.03em] text-white">
  <span className="block">Hire</span>
  <span className="block">Smarter.</span>
  <span className="block bg-gradient-to-r from-[#c8ff00] to-[#39ff9f] bg-clip-text text-transparent">
    Faster.
  </span>
</h1>
```

---

## 3. LOGO

```
HireFlow
├── "Hire" — DM Sans Bold (700), color: #ffffff
└── "Flow" — DM Sans Bold (700), color: #c8ff00
```

```css
.logo {
  font-family: 'DM Sans', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.logo-hire { color: #ffffff; }
.logo-flow { color: #c8ff00; }
```

> ⚠️ The logo uses **DM Sans**, NOT Syne. Syne is for the hero headline only.

---

## 4. COMPONENT STYLING

### 4.1 Primary Button (CTA)
```css
.btn-primary {
  background-color: #c8ff00;
  color: #000000;
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 15px;
  padding: 14px 28px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.btn-primary:hover  { background-color: #b8ec00; }
.btn-primary:active { background-color: #a8d800; }
```

### 4.2 Secondary Button (Ghost)
```css
.btn-secondary {
  background-color: transparent;
  color: #ffffff;
  font-family: 'DM Sans', sans-serif;
  font-weight: 500;
  font-size: 15px;
  padding: 13px 28px;
  border-radius: 8px;
  border: 1px solid #444444;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  border-color: #c8ff00;
  color: #c8ff00;
}
```

### 4.3 Cards
```css
.card {
  background-color: #111111;
  border: 1px solid #1e1e1e;
  border-radius: 12px;
  padding: 24px;
}
.card:hover {
  border-color: rgba(200, 255, 0, 0.3);
}
```

### 4.4 Inputs & Forms
```css
.input {
  background-color: #111111;
  border: 1px solid #1e1e1e;
  color: #ffffff;
  font-family: 'DM Sans', sans-serif;
  font-size: 15px;
  padding: 10px 14px;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.2s ease;
}
.input:focus {
  border-color: #c8ff00;
  box-shadow: 0 0 0 3px rgba(200, 255, 0, 0.12);
}
```

### 4.5 Navigation
```css
.nav-link {
  font-family: 'DM Sans', sans-serif;
  font-size: 15px;
  font-weight: 400;
  color: #888888;
  text-decoration: none;
  transition: color 0.2s ease;
}
.nav-link:hover { color: #ffffff; }
```

### 4.6 Badges
```css
.badge {
  display: inline-block;
  background-color: rgba(200, 255, 0, 0.12);
  color: #c8ff00;
  border: 1px solid rgba(200, 255, 0, 0.25);
  padding: 4px 10px;
  border-radius: 100px;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 600;
}
```

---

## 5. CSS VARIABLES — SINGLE SOURCE OF TRUTH

Place in `src/index.css` at the top, before all other rules:

```css
:root {
  /* ── Fonts ── */
  --font-display: 'Syne', sans-serif;       /* Hero H1 only */
  --font-ui:      'DM Sans', sans-serif;    /* Everything else */

  /* ── Colors — Background ── */
  --color-bg:      #0a0a0a;
  --color-surface: #111111;
  --color-border:  #1e1e1e;

  /* ── Colors — Accent ── */
  --color-accent:          #c8ff00;
  --color-accent-hover:    #b8ec00;
  --color-accent-dim:      rgba(200, 255, 0, 0.12);
  --color-accent-gradient: linear-gradient(90deg, #c8ff00, #39ff9f);

  /* ── Colors — Text ── */
  --color-text-primary: #ffffff;
  --color-text-body:    #aaaaaa;
  --color-text-muted:   #888888;

  /* ── Colors — Semantic ── */
  --color-success: #10b981;
  --color-error:   #ef4444;
  --color-info:    #3b82f6;

  /* ── Font Weights ── */
  --fw-light:     300;
  --fw-regular:   400;
  --fw-medium:    500;
  --fw-semibold:  600;
  --fw-bold:      700;
  --fw-extrabold: 800;

  /* ── Spacing ── */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-6:  24px;
  --space-8:  32px;
  --space-12: 48px;
  --space-16: 64px;

  /* ── Border Radius ── */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* ── Shadows ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.6);
}
```

---

## 6. GLOBAL BASE STYLES

```css
/* src/index.css — after :root variables */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-ui);          /* DM Sans everywhere by default */
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-weight: var(--fw-regular);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Hero overrides body default — Syne 800 */
.hero-title {
  font-family: var(--font-display);
  font-size: clamp(72px, 11vw, 120px);
  font-weight: var(--fw-extrabold);     /* 800 */
  line-height: 0.92;
  letter-spacing: -0.03em;
  color: var(--color-text-primary);
}
.hero-title span { display: block; }
.hero-title .accent {
  background: var(--color-accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* All non-hero headings use DM Sans (inherits from body) */
h2 { font-size: 48px; font-weight: var(--fw-bold);     line-height: 1.15; letter-spacing: -0.02em; }
h3 { font-size: 32px; font-weight: var(--fw-semibold); line-height: 1.25; letter-spacing: -0.01em; }
h4 { font-size: 20px; font-weight: var(--fw-semibold); line-height: 1.35; }
p  { color: var(--color-text-body); line-height: 1.65; }

a {
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.2s ease;
}
a:hover { color: var(--color-text-primary); }
```

---

## 7. FONT LOADING (index.html)

The original Google Fonts `<link>` must be present in `index.html`. Do not remove or replace it:

```html
<head>
  <!-- Preconnect for performance -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <!-- Syne (hero display) + DM Sans (UI) — original confirmed URL -->
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet">
</head>
```

---

## 8. IMPLEMENTATION CHECKLIST FOR CODEX

### Fonts
- [ ] `index.html` has the confirmed Google Fonts `<link>` loading both Syne and DM Sans
- [ ] `body` CSS uses `font-family: 'DM Sans', sans-serif` (or `var(--font-ui)`)
- [ ] `.hero-title` uses `font-family: 'Syne', sans-serif` + `font-weight: 800`
- [ ] No other element uses Syne — it is for the hero H1 exclusively
- [ ] All references to Inter, Neue Haas Grotesk, Clash Display removed

### Hero Layout
- [ ] "Hire" is its own `<span>` with `display: block`
- [ ] "Smarter." is its own `<span>` with `display: block`
- [ ] "Faster." is its own `<span>` with `display: block` and gradient text
- [ ] Hero `line-height` is `0.92`
- [ ] Hero `letter-spacing` is `-0.03em`
- [ ] Hero `font-weight` is `800` — NOT 700
- [ ] Hero `font-size` is `clamp(72px, 11vw, 120px)`

### Colors
- [ ] Accent is `#c8ff00`
- [ ] Background is `#0a0a0a`
- [ ] Body text is `#aaaaaa`
- [ ] Muted/nav text is `#888888`
- [ ] All values use CSS variables — no hardcoded hex in components

### Logo
- [ ] "Hire" = `#ffffff`, DM Sans Bold 700
- [ ] "Flow" = `#c8ff00`, DM Sans Bold 700
- [ ] Logo does NOT use Syne

---

## 9. DARK MODE ONLY

HireFlow is a **dark-first** product. No light mode variants needed or wanted.

All designs assume dark background, light text, lime-green accents. **Do not create light mode unless explicitly requested.**

---

## QUICK REFERENCE CARD

```
FONTS (confirmed from git 84be072):
  Hero H1 only:    Syne, weight 800
  All other UI:    DM Sans, weight 300/400/500

COLORS:
  Background:      #0a0a0a
  Surface/Cards:   #111111
  Border:          #1e1e1e
  Accent lime:     #c8ff00
  Accent mint:     #39ff9f  ← gradient endpoint only
  Text primary:    #ffffff
  Text body:       #aaaaaa
  Text nav/muted:  #888888
  Success:         #10b981
  Error:           #ef4444
  Info:            #3b82f6

HERO LAYOUT (most important rule):
  Font:            Syne 800
  Size:            clamp(72px, 11vw, 120px)
  Line height:     0.92
  Letter spacing:  -0.03em
  Structure:       Each word = its own display:block span
  "Faster." =      linear-gradient(90deg, #c8ff00, #39ff9f) clipped to text

LOGO:
  Font:            DM Sans 700 (NOT Syne)
  "Hire":          #ffffff
  "Flow":          #c8ff00

COMPONENTS:
  Primary btn:     #c8ff00 bg, #000 text, DM Sans 700, 8px radius
  Secondary btn:   transparent, #fff text, 1px solid #444, 8px radius
  Card:            #111111 bg, 1px solid #1e1e1e, 12px radius
  Input:           #111111 bg, 1px solid #1e1e1e, 6px radius
  Input focus:     border #c8ff00, shadow rgba(200,255,0,0.12)

SPACING:
  Default:         16px
  Medium:          24px
  Large:           32px
  Section:         64px
```

---

**Document Version:** 3.0  
**Last Updated:** April 20, 2026  
**Fonts confirmed:** git commit `84be072` — `index.html` + `src/index.css`  
**Status:** Ready for implementation
