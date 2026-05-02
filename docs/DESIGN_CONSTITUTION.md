# HIREFLOW DESIGN CONSTITUTION
# File: DESIGN_CONSTITUTION.md
# Commit this file to the repo root.
# Codex reads this at the start of EVERY session, forever.
# Last confirmed: May 2026 from live site HTML + design audit.
# This supersedes DESIGN_BRAND_GUIDELINES.md v1.0 and v3.0.

---

## 0. THE ONLY RULE THAT MATTERS

Before writing a single line of code, read this entire file.
After reading it, ask: "does what I'm about to build match this?"
If no → adjust until yes.
If unsure → match what already exists in the codebase, not what you guess.

---

## 1. FONTS — CONFIRMED FROM LIVE SITE

Two fonts. No others. Ever.

| Role | Font | Weights | Where |
|------|------|---------|-------|
| Display | **Syne** | 800 only | Hero H1 only (`Hire`, `Smarter.`, `Faster.`) |
| UI | **DM Sans** | 300, 400, 500, 600, 700 | Everything else |

Google Fonts link (already in index.html — DO NOT remove or change):
```
https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap
```

### Typography scale

| Element | Font | Size | Weight | Color | Line-height | Letter-spacing |
|---------|------|------|--------|-------|-------------|----------------|
| Hero H1 | Syne | clamp(72px,11vw,120px) | 800 | #ffffff | 0.92 | -0.03em |
| H2 section | DM Sans | 40px | 700 | #ffffff | 1.15 | -0.02em |
| H3 card | DM Sans | 20px | 600 | #ffffff | 1.3 | 0 |
| Body | DM Sans | 15–16px | 400 | #aaaaaa | 1.65 | 0 |
| Small/label | DM Sans | 12–13px | 400 | #666666 | 1.5 | 0 |
| Nav link | DM Sans | 14px | 400 | #888888 | 1.4 | 0 |
| Button | DM Sans | 14–15px | 600–700 | varies | 1.4 | 0 |
| Sidebar label | DM Sans | 13px | 400/500 | #777777 | 1.4 | 0 |

Hero H1 structure — NEVER put words on the same line:
```jsx
<h1 className="hero-title">
  <span className="hero-line">Hire</span>
  <span className="hero-line">Smarter.</span>
  <span className="hero-line hero-accent">Faster.</span>
</h1>
```

---

## 2. COLORS — CONFIRMED CANONICAL VALUES

```css
:root {
  /* Backgrounds */
  --hf-bg:        #0a0a0a;   /* Page background */
  --hf-surface:   #111111;   /* Cards, panels, modals */
  --hf-surface-2: #0d0d0d;   /* Sidebar, slightly elevated */
  --hf-border:    #1e1e1e;   /* Default border */
  --hf-border-2:  #2a2a2a;   /* Inputs, secondary borders */

  /* Accent */
  --hf-lime:      #c8ff00;   /* Primary accent — buttons, active states */
  --hf-lime-hover:#b8ec00;   /* Hover on lime */
  --hf-mint:      #39ff9f;   /* Gradient endpoint — "Faster." only */
  --hf-lime-dim:  rgba(200,255,0,0.10); /* Tinted backgrounds */
  --hf-lime-border: rgba(200,255,0,0.20); /* Tinted borders */

  /* Text */
  --hf-text:      #ffffff;   /* Primary text, headings */
  --hf-text-2:    #aaaaaa;   /* Body text, descriptions */
  --hf-text-3:    #888888;   /* Nav links, secondary labels */
  --hf-text-4:    #666666;   /* Muted meta, tertiary */
  --hf-text-5:    #444444;   /* Very muted */
  --hf-text-6:    #2a2a2a;   /* Near-invisible (SEO links only) */

  /* Semantic */
  --hf-success:   #10b981;
  --hf-error:     #ef4444;
  --hf-warning:   #ffa500;
  --hf-info:      #7ab3f7;

  /* Score colours (candidate ranking) */
  --hf-score-strong:   #c8ff00;  /* ≥ 8.0/10 */
  --hf-score-possible: #ffa500;  /* 6.0–7.9 */
  --hf-score-low:      #ef4444;  /* < 6.0 */

  /* Radii */
  --hf-r-sm:  4px;
  --hf-r-md:  6px;
  --hf-r-lg:  8px;
  --hf-r-xl:  12px;
  --hf-r-2xl: 16px;

  /* Shadows */
  --hf-shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
  --hf-shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --hf-shadow-lg: 0 12px 32px rgba(0,0,0,0.6);
}
```

Logo: "Hire" = `#ffffff`, "Flow" = `#c8ff00`, DM Sans 700.
"Faster." gradient: `linear-gradient(90deg, #c8ff00, #39ff9f)` clipped to text.

---

## 3. ICONS — ONE LIBRARY, NO EXCEPTIONS

**Use Lucide React. Nothing else.**

```js
import { IconName } from 'lucide-react'
// Always: size={18} strokeWidth={1.5}
// Never: custom SVG inline, emoji, or any other icon library
```

Canonical icon assignments for nav and UI:

| Item | Lucide icon name |
|------|-----------------|
| Dashboard | `LayoutDashboard` |
| Jobs | `Briefcase` |
| Analyses | `ScanSearch` |
| Candidates | `Users` |
| Shortlists | `ClipboardCheck` |
| Reports | `BarChart2` |
| Settings | `Settings2` |
| Bell / Notifications | `Bell` |
| Pin sidebar | `Pin` |
| Collapse left | `ChevronLeft` |
| Expand right | `ChevronRight` |
| Search | `Search` |
| Upload | `Upload` |
| Close / X | `X` |
| Check / Done | `Check` |
| Add / Plus | `Plus` |
| Sort | `ArrowUpDown` |
| Filter | `SlidersHorizontal` |
| Export | `Download` |
| Schedule / Calendar | `Calendar` |
| Email | `Mail` |
| Location | `MapPin` |
| External link | `ExternalLink` |

---

## 4. LAYOUT RULES

### Two types of pages — never mix their layouts

**PUBLIC pages** (landing, login, signup, pricing, about, help, contact):
- No sidebar
- Top navigation bar with logo left, nav links centre, auth actions right
- Full-width content
- Full footer (4-column grid)

**APP pages** (dashboard, jobs, analyses, candidates, shortlists, reports, settings):
- Sidebar left (216px expanded / 52px collapsed)
- Header top (52px)
- Content fills remaining space
- Minimal footer (1 line: © + Privacy / Terms / Help)
- NO public footer on app pages

### App shell structure — exact

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (216px)  │  Header (52px tall)              │
│  sticky, 100vh    ├──────────────────────────────────┤
│                   │  Content (flex:1, overflow-y:auto)│
│                   │  padding: 28px 32px              │
│                   ├──────────────────────────────────┤
│                   │  Footer (36px, 1 line)            │
└───────────────────┴──────────────────────────────────┘
```

The outer container:
```css
display: flex;
height: 100vh;
width: 100vw;
background: #0a0a0a;
overflow: hidden;
```

### Sidebar behaviour
- Expanded: 216px wide, shows icon + label
- Collapsed: 52px wide, shows icon only
- Hover when unpinned → expands temporarily
- Mouse-leave when unpinned → collapses
- Pin state saved to `localStorage` key `hf-sb-pinned`
- Active item: `border-left: 2px solid #c8ff00`, `background: rgba(200,255,0,0.08)`, icon `#c8ff00`, label `#ffffff`

### Public nav
```
[Logo]          [Features] [Solutions] [Pricing] [About] [Help]          [Auth actions]
```
- Logo: "Hire" white + "Flow" lime, DM Sans 700
- Nav links: DM Sans 400, `#888888`, hover `#ffffff`
- Auth (logged out): ghost "Login" + lime "Sign up"
- Auth (logged in): ghost "Dashboard" + avatar circle side by side, `flex-direction: row`

---

## 5. COMPONENT PATTERNS

### Cards
```css
background: #111111;
border: 1px solid #1e1e1e;
border-radius: 12px;
padding: 20px 24px;
transition: border-color 0.15s;
```
Hover: `border-color: #2a2a2a`
Active/selected: `border-color: rgba(200,255,0,0.3)`

### Primary button (lime CTA)
```css
background: #c8ff00;
color: #000000;
font-family: 'DM Sans', sans-serif;
font-weight: 700;
font-size: 14px;
padding: 10px 22px;
border-radius: 8px;
border: none;
cursor: pointer;
transition: background 0.15s, transform 0.1s;
```
Hover: `background: #b8ec00`
Active: `transform: scale(0.97)`
Focus-visible: `outline: 2px solid #c8ff00; outline-offset: 3px`

### Ghost / secondary button
```css
background: transparent;
color: #aaaaaa;
font-family: 'DM Sans', sans-serif;
font-size: 14px;
padding: 9px 20px;
border-radius: 8px;
border: 1px solid #2a2a2a;
cursor: pointer;
transition: all 0.15s;
```
Hover: `border-color: #444444; color: #ffffff`

### Inputs / textareas / selects
```css
background: #111111;
border: 1px solid #2a2a2a;
color: #ffffff;
font-family: 'DM Sans', sans-serif;
font-size: 14px;
padding: 10px 14px;
border-radius: 8px;
outline: none;
transition: border-color 0.15s;
```
Focus: `border-color: #c8ff00; box-shadow: 0 0 0 3px rgba(200,255,0,0.10)`
Placeholder: `color: #333333`
Autofill override: `-webkit-box-shadow: 0 0 0 1000px #111111 inset; -webkit-text-fill-color: #ffffff`

### Badges
```css
/* Lime badge */
background: rgba(200,255,0,0.10);
color: #c8ff00;
border: 1px solid rgba(200,255,0,0.20);
padding: 3px 8px;
border-radius: 100px;
font-size: 11px;
font-weight: 600;

/* Muted/locked badge */
background: rgba(255,255,255,0.05);
color: #444444;
border: 1px solid #222222;
```

### Score display (candidate cards)
- Store as 0–100 integer in database
- Display as X.X/10 (divide by 10, one decimal)
- 9.2/10 not 92%
- Number font: Syne 700
- "/10" suffix: DM Sans 400, muted

### Checkboxes
```css
accent-color: #c8ff00;
width: 15px;
height: 15px;
cursor: pointer;
```

---

## 6. PUBLIC FOOTER RULES

The `public-footer__intent-toggle` button ("SEO links") must ALWAYS be:
```css
.public-footer__intent-toggle { display: none !important; }
```
SEO links must always be visible in DOM, never toggleable, colour `#1e1e1e`.

Footer column structure (4 columns):
1. Brand (logo + tagline)
2. Product (Pricing, Book Demo)
3. Company (About, Contact)
4. Legal (Privacy, Terms, Refund Policy)

---

## 7. THE DO-NOT LIST

Never do any of these, ever:

- ❌ Write custom `<svg>` code inline — use Lucide icons
- ❌ Use emoji as icons or decoration
- ❌ Use `font-family: Inter` — use DM Sans or Syne only
- ❌ Use `flex-direction: column` on the nav auth actions — must be `row`
- ❌ Use light/white backgrounds on inputs, dropdowns, or buttons inside the dark theme
- ❌ Show the sidebar on public pages (landing, login, signup, pricing, about, help)
- ❌ Show the public footer inside authenticated app pages
- ❌ Hardcode hex colors — use CSS variables (`var(--hf-lime)` etc)
- ❌ Put "Hire Smarter." on one line — always three separate `display:block` spans
- ❌ Use `position: fixed` for the sidebar — use `position: sticky; top: 0; height: 100vh`
- ❌ Install new npm packages without checking if Lucide already covers the use case
- ❌ Leave debug artifacts (console.log, "Legacy dashboard fallback", "Home" test buttons)
- ❌ Create light mode styles

---

## 8. CSS VARIABLES BOOTSTRAP

This block goes at the very top of `src/index.css`, before everything else.
If it already exists, update the values to match exactly.

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --hf-bg: #0a0a0a;
  --hf-surface: #111111;
  --hf-surface-2: #0d0d0d;
  --hf-border: #1e1e1e;
  --hf-border-2: #2a2a2a;
  --hf-lime: #c8ff00;
  --hf-lime-hover: #b8ec00;
  --hf-mint: #39ff9f;
  --hf-lime-dim: rgba(200,255,0,0.10);
  --hf-lime-border: rgba(200,255,0,0.20);
  --hf-lime-grad: linear-gradient(90deg, #c8ff00, #39ff9f);
  --hf-text: #ffffff;
  --hf-text-2: #aaaaaa;
  --hf-text-3: #888888;
  --hf-text-4: #666666;
  --hf-text-5: #444444;
  --hf-text-6: #1e1e1e;
  --hf-success: #10b981;
  --hf-error: #ef4444;
  --hf-warning: #ffa500;
  --hf-info: #7ab3f7;
  --hf-font-display: 'Syne', sans-serif;
  --hf-font-ui: 'DM Sans', sans-serif;
  --hf-r-sm: 4px;
  --hf-r-md: 6px;
  --hf-r-lg: 8px;
  --hf-r-xl: 12px;
  --hf-r-2xl: 16px;
  --hf-shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
  --hf-shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --hf-shadow-lg: 0 12px 32px rgba(0,0,0,0.6);
}

html, body, #root {
  height: 100%;
  background: var(--hf-bg);
  color: var(--hf-text);
}

body {
  font-family: var(--hf-font-ui);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```
