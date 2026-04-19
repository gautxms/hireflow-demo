# HireFlow Brand & Design Guidelines

**Version:** 1.0  
**Date:** April 14, 2026  
**Status:** Final  
**Purpose:** Establish consistent color, typography, and visual identity across hireflow.dev

---

## EXECUTIVE SUMMARY

HireFlow uses a **modern dark theme** with **high-contrast accents**. The brand is:
- **Bold & Energetic** (neon green accents)
- **Clean & Professional** (minimal dark palette)
- **AI-Forward** (sleek, tech-focused aesthetic)

**Current Issues Identified:**
- Font inconsistencies across pages
- Color hex values not standardized
- Navigation styling lacks uniformity
- Button styles vary between sections

---

## 1. COLOR PALETTE

### Primary Colors

#### 1.1 Background
- **Name:** HireFlow Black
- **Hex:** `#0a0a0a`
- **RGB:** `10, 10, 10`
- **Usage:** Main page background, card backgrounds
- **Example:** Body background, dark surfaces

#### 1.2 Accent Green (Primary CTA)
- **Name:** HireFlow Green / Neon Lime
- **Hex:** `#b8ff00` (or `#c0ff00`)
- **RGB:** `184, 255, 0` (or `192, 255, 0`)
- **HSL:** `71°, 100%, 50%`
- **Usage:** Logo "Flow", headlines, CTA buttons, highlights
- **Example:** "Faster." text, "Sign Up" button

#### 1.3 Text Primary (White/Off-White)
- **Name:** Off-White
- **Hex:** `#ffffff`
- **RGB:** `255, 255, 255`
- **Usage:** Headlines, strong text, logo
- **Example:** "Hire Smarter.", navigation brand name

#### 1.4 Text Secondary (Muted Grey)
- **Name:** Muted Grey / Slate
- **Hex:** `#7a7a8d` or `#888899`
- **RGB:** `122, 122, 141` or `136, 136, 153`
- **Usage:** Body text, descriptions, secondary navigation
- **Example:** "HireFlow automates candidate screening..." subtitle text

#### 1.5 Navigation Text (Desaturated Purple-Grey)
- **Name:** Nav Grey
- **Hex:** `#9999aa` or `#8888aa`
- **RGB:** `153, 153, 170` or `136, 136, 170`
- **Usage:** Navigation links, breadcrumbs, helper text
- **Example:** "Features", "Upgrade", "About", "Help" nav items

### Secondary Colors (Admin/UI)

#### 1.6 Success Green
- **Name:** Success Green
- **Hex:** `#10b981`
- **RGB:** `16, 185, 129`
- **Usage:** Checkmarks, success messages, progress bars

#### 1.7 Error Red
- **Name:** Error Red
- **Hex:** `#ef4444`
- **RGB:** `239, 68, 68`
- **Usage:** Error messages, warnings, destructive actions

#### 1.8 Info Blue
- **Name:** Info Blue
- **Hex:** `#3b82f6`
- **RGB:** `59, 130, 246`
- **Usage:** Info tooltips, informational messages

#### 1.9 Dark Surfaces
- **Name:** Card Background
- **Hex:** `#1a1a1f` or `#121212`
- **RGB:** `26, 26, 31` or `18, 18, 18`
- **Usage:** Card backgrounds, modal backgrounds
- **Note:** Slightly lighter than main background for depth

### Color Contrast Matrix

| Foreground | Background | Contrast Ratio | WCAG Level |
|-----------|-----------|----------------|-----------|
| #ffffff (white) | #0a0a0a (black) | 20:1 | AAA |
| #b8ff00 (green) | #0a0a0a (black) | 15:1 | AAA |
| #7a7a8d (grey) | #0a0a0a (black) | 4.5:1 | AA |
| #ffffff (white) | #1a1a1f (card) | 18:1 | AAA |

---

## 2. TYPOGRAPHY

### Font Stack

#### 2.1 Headline Font (Primary)
- **Name:** Inter or Neue Haas Grotesk
- **Fallback:** `'Inter', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif`
- **Weight:** 700 (Bold) for main headlines, 600 (Semibold) for subheads
- **Usage:** H1, H2, H3, page titles, section headers
- **Line Height:** 1.2 (tight for impact)
- **Letter Spacing:** -0.5px to -1px (negative for boldness)

**Example (from screenshot):**
```
Hire
Smarter.
Faster.
```
- Font: Inter Bold (700)
- Size: 64-80px (H1)
- Color: #ffffff (white) + #b8ff00 (green)
- Letter Spacing: -0.5px

#### 2.2 Body Font (Secondary)
- **Name:** Inter or System Font
- **Fallback:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif`
- **Weight:** 400 (Regular)
- **Usage:** Body text, descriptions, long-form content
- **Line Height:** 1.6 (spacious for readability)
- **Letter Spacing:** 0 (normal)

**Example:**
```
HireFlow automates candidate screening with AI. Reduce hiring time
from weeks to days, eliminate bias, and make data-driven decisions.
```
- Font: Inter Regular (400)
- Size: 16px
- Color: #7a7a8d (muted grey)
- Line Height: 1.6

#### 2.3 Navigation Font
- **Name:** Inter
- **Weight:** 500 (Medium)
- **Size:** 14px
- **Color:** #9999aa (nav grey)
- **Usage:** Top navigation, breadcrumbs, secondary links
- **Hover State:** #b8ff00 (accent green)

#### 2.4 Button Font
- **Name:** Inter
- **Weight:** 600 (Semibold)
- **Size:** 14px or 16px (depends on button size)
- **Text Transform:** None (sentence case, not all caps)
- **Letter Spacing:** 0.5px

### Typography Hierarchy

| Level | Element | Size | Weight | Color | Line Height |
|-------|---------|------|--------|-------|-------------|
| H1 | Main Headline | 64-80px | 700 | #ffffff + #b8ff00 | 1.2 |
| H2 | Section Header | 48px | 700 | #ffffff | 1.2 |
| H3 | Subsection | 32px | 600 | #ffffff | 1.3 |
| H4 | Card Title | 20px | 600 | #ffffff | 1.4 |
| Body | Description | 16px | 400 | #7a7a8d | 1.6 |
| Small | Helper Text | 14px | 400 | #888899 | 1.5 |
| Nav | Navigation | 14px | 500 | #9999aa | 1.4 |
| Button | CTA Text | 14-16px | 600 | varies | 1.4 |

---

## 3. COMPONENT STYLING

### 3.1 Buttons

#### Primary Button (Call-to-Action)
```css
background-color: #b8ff00;  /* Accent green */
color: #0a0a0a;             /* Black text */
font-weight: 600;
padding: 12px 24px;
border-radius: 8px;
border: none;
cursor: pointer;
```

**States:**
- **Default:** `#b8ff00` background
- **Hover:** `#a8ee00` (darker green, -16 on hex value)
- **Active:** `#98dc00` (darker still)
- **Disabled:** `#4a4a4a` (muted grey)

**Example:** "Sign Up" button on landing page

#### Secondary Button (Navigation)
```css
background-color: transparent;
color: #9999aa;             /* Nav grey */
font-weight: 500;
padding: 8px 16px;
border: 1px solid #9999aa;
border-radius: 6px;
cursor: pointer;
```

**States:**
- **Default:** Transparent, grey border/text
- **Hover:** `background-color: rgba(184, 255, 0, 0.1)` + green text
- **Active:** `color: #b8ff00` (accent green)

**Example:** "Features", "About", "Help" navigation links

### 3.2 Cards

```css
background-color: #1a1a1f;
border: 1px solid #2a2a2f;
border-radius: 12px;
padding: 24px;
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
```

**States:**
- **Hover:** `border-color: #b8ff00` (accent green border)
- **Selected:** `border: 2px solid #b8ff00`

### 3.3 Badges & Tags

**Accent Badge:**
```css
background-color: rgba(184, 255, 0, 0.15);
color: #b8ff00;
padding: 4px 8px;
border-radius: 4px;
font-size: 12px;
font-weight: 600;
```

### 3.4 Inputs & Forms

```css
background-color: #1a1a1f;
border: 1px solid #2a2a2f;
color: #ffffff;
padding: 10px 12px;
border-radius: 6px;
font-family: inherit;
```

**Focus State:**
```css
border-color: #b8ff00;
box-shadow: 0 0 0 3px rgba(184, 255, 0, 0.15);
```

---

## 4. SPACING & LAYOUT

### Spacing Scale
```
4px   (0.25rem) - micro spacing
8px   (0.5rem)  - small spacing
12px  (0.75rem) - default small
16px  (1rem)    - default spacing
24px  (1.5rem)  - medium spacing
32px  (2rem)    - large spacing
48px  (3rem)    - extra large
64px  (4rem)    - section spacing
```

### Container Widths
- **Mobile:** 100% (full width)
- **Tablet:** 100% (full width with padding)
- **Desktop:** 1280px (max-width, centered)
- **Ultra-wide:** 1440px (optional)

---

## 5. BORDER RADIUS

- **Buttons:** 8px
- **Cards:** 12px
- **Inputs:** 6px
- **Modals:** 12px
- **Small elements:** 4px

---

## 6. SHADOWS & ELEVATION

### Shadow Scale

**Level 1 (Subtle):**
```css
box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
```

**Level 2 (Cards):**
```css
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
```

**Level 3 (Modals):**
```css
box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
```

**Level 4 (Dropdowns):**
```css
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
```

---

## 7. CURRENT INCONSISTENCIES & FIXES

### Issue 1: Font Family Inconsistency
**Problem:** Different pages use different font families (Inter vs. System fonts)  
**Solution:** Standardize all pages to use `Inter` with system font fallback  
**Files to Update:** All `*.jsx` files + global CSS

**Fix:**
```css
/* Global - apply to body */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
```

### Issue 2: Color Hex Values Not Standardized
**Problem:** Using varying hex formats (#b8ff00 vs #c0ff00, exact values unclear)  
**Solution:** Create CSS custom properties for all colors  
**Files to Update:** `styles/variables.css` or Tailwind config

**Fix:**
```css
:root {
  --color-bg-primary: #0a0a0a;
  --color-bg-secondary: #1a1a1f;
  --color-accent-green: #b8ff00;
  --color-text-primary: #ffffff;
  --color-text-secondary: #7a7a8d;
  --color-text-nav: #9999aa;
  --color-border: #2a2a2f;
}
```

### Issue 3: Navigation Color Inconsistency
**Problem:** Navigation items use varying colors/opacities  
**Solution:** Standardize all nav items to `#9999aa` with `#b8ff00` on hover  
**Files to Update:** Navigation component styles

### Issue 4: Button Styling Varies
**Problem:** Primary buttons have inconsistent padding, border-radius, font sizes  
**Solution:** Create button component with predefined sizes (small, medium, large)  
**Files to Update:** `components/Button.jsx` or button styles

### Issue 5: Card Border/Shadow Inconsistency
**Problem:** Cards have different border colors and shadow intensities  
**Solution:** Standardize to `#2a2a2f` border + Level 2 shadow  
**Files to Update:** Card component styles

---

## 8. IMPLEMENTATION GUIDE

### Step 1: Create CSS Variables File

**File:** `src/styles/variables.css`

```css
:root {
  /* Colors - Background */
  --color-bg-primary: #0a0a0a;
  --color-bg-secondary: #1a1a1f;
  
  /* Colors - Accent */
  --color-accent-green: #b8ff00;
  --color-accent-green-hover: #a8ee00;
  --color-accent-green-active: #98dc00;
  
  /* Colors - Text */
  --color-text-primary: #ffffff;
  --color-text-secondary: #7a7a8d;
  --color-text-nav: #9999aa;
  --color-text-muted: #888899;
  
  /* Colors - UI */
  --color-border: #2a2a2f;
  --color-success: #10b981;
  --color-error: #ef4444;
  --color-info: #3b82f6;
  
  /* Typography */
  --font-family-base: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  
  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.5);
}
```

### Step 2: Update Global Styles

**File:** `src/styles/global.css`

```css
body {
  font-family: var(--font-family-base);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-weight: var(--font-weight-regular);
  line-height: 1.6;
}

h1, h2, h3, h4 {
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  letter-spacing: -0.5px;
}

a {
  color: var(--color-text-nav);
  text-decoration: none;
  transition: color 0.2s ease;
}

a:hover {
  color: var(--color-accent-green);
}
```

### Step 3: Create Reusable Components

**File:** `src/components/Button.jsx`

```jsx
export function Button({ 
  children, 
  variant = 'primary', 
  size = 'medium',
  ...props 
}) {
  const baseStyles = {
    fontFamily: 'var(--font-family-base)',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.2s ease',
  };

  const variants = {
    primary: {
      ...baseStyles,
      backgroundColor: 'var(--color-accent-green)',
      color: 'var(--color-bg-primary)',
      '&:hover': { backgroundColor: 'var(--color-accent-green-hover)' },
    },
    secondary: {
      ...baseStyles,
      backgroundColor: 'transparent',
      color: 'var(--color-text-nav)',
      border: '1px solid var(--color-text-nav)',
      '&:hover': { 
        color: 'var(--color-accent-green)',
        borderColor: 'var(--color-accent-green)',
      },
    },
  };

  const sizes = {
    small: { padding: '8px 16px', fontSize: '12px' },
    medium: { padding: '12px 24px', fontSize: '14px' },
    large: { padding: '16px 32px', fontSize: '16px' },
  };

  return (
    <button style={{ ...variants[variant], ...sizes[size] }} {...props}>
      {children}
    </button>
  );
}
```

---

## 9. TESTING CHECKLIST

### Font Consistency
- [ ] All headlines use Inter 700
- [ ] All body text uses Inter 400
- [ ] All navigation uses Inter 500
- [ ] All buttons use Inter 600
- [ ] No mixed font families on single page
- [ ] Line heights match hierarchy table

### Color Consistency
- [ ] All backgrounds are `#0a0a0a`
- [ ] All cards are `#1a1a1f` with `#2a2a2f` border
- [ ] All primary text is `#ffffff`
- [ ] All secondary text is `#7a7a8d`
- [ ] All nav text is `#9999aa`
- [ ] All accent elements are `#b8ff00`
- [ ] All buttons follow color rules

### Component Consistency
- [ ] All primary buttons have 8px border-radius
- [ ] All cards have 12px border-radius
- [ ] All inputs have 6px border-radius
- [ ] All buttons have consistent padding
- [ ] All cards have Level 2 shadow
- [ ] All hover states are consistent

---

## 10. BRAND VOICE

### Visual Personality
- **Modern** - Clean, minimal, no clutter
- **Bold** - High contrast, neon accents, confident
- **Tech-Forward** - Dark theme, geometric precision
- **Accessible** - High contrast ratios (WCAG AAA)
- **Professional** - Not playful, not casual; serious about hiring

### Color Psychology
- **Neon Green (#b8ff00)** = Energy, AI, innovation, excitement
- **Dark Background (#0a0a0a)** = Professional, focus, sophistication
- **White Text (#ffffff)** = Clarity, trust, directness

---

## 11. DARK MODE ONLY

HireFlow is a **dark-first** product. No light mode variants needed.

All designs assume:
- Dark background
- Light text
- Neon green accents

**Do not create light mode unless explicitly requested.**

---

## QUICK REFERENCE CARD

```
COLORS:
  Background: #0a0a0a
  Card BG: #1a1a1f
  Accent: #b8ff00
  Text: #ffffff
  Secondary: #7a7a8d
  Nav: #9999aa

FONTS:
  All text: Inter
  Headlines: 700 / 64px / -0.5px spacing
  Body: 400 / 16px / 1.6 line height
  Nav: 500 / 14px
  Button: 600 / 14-16px

COMPONENTS:
  Button radius: 8px
  Card radius: 12px
  Card shadow: 0 4px 12px rgba(0,0,0,0.3)
  Card border: 1px solid #2a2a2f

SPACING:
  Default: 16px
  Large: 24px
  Section: 48-64px
```

---

## NOTES FOR DEVELOPERS

1. **Use CSS variables** - No hardcoded color values
2. **Create components** - Reusable Button, Card, Badge components
3. **Test contrast** - Ensure WCAG AAA (4.5:1 minimum for text)
4. **Mobile first** - All sizes should work responsively
5. **Test in browser** - Colors look different on different monitors

---

## NEXT STEPS

1. Create `src/styles/variables.css` with color + typography vars
2. Update global styles to use variables
3. Create Button, Card, Badge components
4. Audit all pages for consistency
5. Update any offending styles to match guidelines
6. Document any edge cases or exceptions

---

**Document Version:** 1.0  
**Last Updated:** April 14, 2026  
**Status:** Ready for Implementation
