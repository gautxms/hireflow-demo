# Text Style Audit (`src/`)

## Constitution baseline used
- **Fonts**: `Syne` only for **hero H1**; `DM Sans` everywhere else.
- **Type scale tokens**:
  - nav: `var(--type-nav-size)` / `var(--type-nav-weight)`
  - body: `var(--type-body-size)` / `var(--type-body-weight)`
  - small: `var(--type-small-size)` / `var(--type-small-weight)`
  - button: `var(--type-button-size)` / `var(--type-button-weight)`
- **Text colors** (via variables only): `#fff`, `#aaa`, `#888`, `#666`.

## Violations + exact fixes (file-by-file)

### Public pages
1. **`src/globals.css`**
   - Violations:
     - Non-token hardcoded text colors (e.g. `#ffffff`, `#aaaaaa`, `#888888`, `#2a2a2a`, `#1e1e1e`) mixed with semantic color vars.
     - Duplicate declarations overriding constitution scale (e.g. nav/button rules set tokenized size+weight, then override with `0.9rem`, `400`, etc.).
     - `var(--font-family-display)` used in non-hero text blocks/cards/headings outside hero H1.
   - Fix:
     - Replace all hardcoded text colors with canonical vars:
       - `--color-text-primary: #fff`
       - `--color-text-secondary: #aaa`
       - `--color-text-nav: #888`
       - `--color-text-muted: #666`
     - Remove duplicate size/weight declarations after tokenized declarations.
     - Keep `Syne` only on hero H1 selector(s); switch other display uses to `var(--font-family-base)`.

2. **`src/styles/landing.css`**
   - Violations:
     - Uses display-family aliases outside hero H1.
     - Contains hardcoded grayscale text values that should be tokenized.
   - Fix:
     - Restrict `Syne` to the main hero H1 only.
     - Use token color vars for every text color assignment.
     - Swap ad-hoc type sizes in nav/body/small/button-like selectors to constitution tokens.

3. **`src/styles/public-page-layout.css`** and **`src/styles/public-content-pages.css`**
   - Violations:
     - Mixed direct grayscale values and non-constitutional text colors.
     - Inconsistent typography declarations for body/small copy.
   - Fix:
     - Normalize all text colors to constitutional variables.
     - Replace raw `font-size`/`font-weight` values for nav/body/small/button selectors with token pairs.

4. **`src/styles/pricing.css`** and **`src/styles/pricing-page-marketing.css`**
   - Violations:
     - Button/body text sizes diverge from token scale.
     - Hardcoded grayscale text in pricing labels/meta text.
   - Fix:
     - Use `var(--type-button-*)`, `var(--type-body-*)`, `var(--type-small-*)` consistently.
     - Replace direct grayscale colors with constitutional text vars.

### Auth pages
5. **`src/components/AuthPage.css`**
   - Violations:
     - Uses `var(--font-display)` for auth headings not scoped as hero H1.
     - Hardcoded text colors like `#cfcfda` in helper/error/support text.
     - Small/body text styles use custom values (`0.92rem`, `0.9rem`, `500`) instead of tokens.
   - Fix:
     - Change non-hero headings to `var(--font-family-base)`.
     - Replace hardcoded text colors with constitutional vars.
     - Map helper text to small token and form body text to body token.

### App shell / logged-in application
6. **`src/index.css`**
   - Violations:
     - Defines local text aliases (`--hf-text-muted`, `--hf-text-inverse`, `--hf-text-strong`) using non-constitutional hardcoded values.
     - Header/meta/button text sections hardcode grayscale colors (`#fff`, `#666`, `#000`, `#555`, `#333`).
   - Fix:
     - Alias `--hf-*` text vars to constitutional vars where applicable.
     - Remove hardcoded text color declarations in shell components and map to the 4 canonical text vars.

7. **`src/components/NewDashboard.css`**
   - Violations:
     - Hardcoded text colors (`#000000`, `#aaaaaa`, `#ffffff`, `#555555`) and `var(--font-family-display)` in non-hero context.
     - Small/body text sizes use raw px values.
   - Fix:
     - Replace text colors with constitutional variables.
     - Replace display family with base family unless explicitly hero H1 (not applicable here).
     - Replace `13px/14px/12px` etc. with body/small/button/nav token scale based on semantic role.

8. **`src/styles/candidate-results.css`**
   - Violations:
     - Large volume of hardcoded grayscale and non-token text colors.
     - Multiple non-hero uses of display font.
     - Extensive raw size/weight assignments in nav/body/small/button-like UI elements.
   - Fix:
     - First pass: normalize only neutral text to constitutional vars; leave semantic status colors (success/warn/error) intact.
     - Convert non-hero display font usage to base font.
     - Replace repeated raw text styles with utility/tokenized patterns per component block.

## Follow-up PR batch plan (grouped by area)
1. **PR A — Public pages typography/color normalization**
   - Scope: `globals.css`, `landing.css`, `public-page-layout.css`, `public-content-pages.css`, `pricing*.css`.
   - Goal: hero-H1-only Syne, tokenized nav/body/small/button scale, remove duplicate overrides, canonical text color vars.

2. **PR B — Auth pages typography contract cleanup**
   - Scope: `src/components/AuthPage.css` (+ any auth-only style file touched by the same route).
   - Goal: DM Sans across auth (except hero H1 if present), tokenized type scale, canonical neutral text colors.

3. **PR C — App shell and results UI normalization**
   - Scope: `src/index.css`, `src/components/NewDashboard.css`, `src/styles/candidate-results.css`, related shell CSS.
   - Goal: eliminate hardcoded neutral text values, reduce duplicate declarations, align to constitution type tokens.

## Notes
- `src/styles/variables.css` already defines most foundational tokens, but contains duplicate root assignments and legacy color values; harmonization should be included opportunistically in PR A.
- Sequence recommended: **A → B → C** to reduce merge conflicts and establish global token behavior first.

## Coverage confirmation (requested page list)

Checked against route/component inventory in `src/App.jsx` and page/component files:

- **SEO pages**: Yes (`src/pages/seo/IntentLandingPage.jsx`, `src/pages/seo/intentPages.js`).
- **About**: Yes (`src/components/AboutPage.jsx`).
- **Help**: Yes (`src/components/HelpPage.jsx`).
- **Pricing**: Yes (`src/pages/Pricing.jsx`, `src/components/PricingPage.jsx`, pricing CSS files).
- **Contact**: Yes (`src/components/ContactPage.jsx`).
- **Demo**: Yes (`src/components/DemoBookingPage.jsx`).
- **Solutions**: No dedicated route/page found in current app route map.
- **Privacy**: Yes (`src/components/PrivacyPage.jsx`).
- **Refund Policy**: Yes (`src/pages/RefundPolicy.jsx`).
- **Terms**: Yes (`src/pages/Terms.jsx`, `src/components/TermsPage.jsx`).
- **Dashboard**: Yes (`src/components/NewDashboard.jsx`, `src/components/Dashboard.jsx`).
- **Analyses**: Yes (`src/pages/AnalysesPage.jsx`, `src/pages/AnalysisDetailPage.jsx`).
- **Jobs**: Yes (`src/pages/JobDescriptionPage.jsx`, `/jobs` mapped in user shell routes).
- **Candidates**: Yes (`src/pages/CandidatesPage.jsx`, `src/pages/CandidateDetailPage.jsx`).
- **Reports**: Yes (`src/pages/ReportsPage.jsx`).
- **Account**: Yes (`src/pages/AccountPage.jsx`, `src/pages/AccountSettingsPage.jsx`).
- **Shortlists**: Route is present (`/shortlists`) and UI component audited (`src/components/ShortlistManager.jsx` + `ShortlistManager.css`).

### Additional pages included in audit scope
- Auth pages: login/signup/forgot/reset/verify email flows.
- Billing/checkout pages: billing page, update payment method, success/cancel, checkout.
- Uploader/results flows and app shell global CSS.

