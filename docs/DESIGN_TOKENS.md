# Design Tokens (Canonical)

This project uses a **single source of truth** for visual tokens in `src/styles/variables.css`.

Legacy alias tokens (`--ink`, `--accent`, `--text`, `--muted`, and related variants) have been fully removed and are not allowed.

## Canonical token groups

- **Backgrounds:** `--color-bg-primary`, `--color-bg-secondary`
- **Accent:** `--color-accent-green`, `--color-accent-green-hover`, `--color-accent-green-active`
- **Text:** `--color-text-primary`, `--color-text-secondary`, `--color-text-nav`, `--color-text-muted`
- **UI:** `--color-border`, `--color-success`, `--color-error`, `--color-info`
- **Typography:** `--font-family-base` (Inter stack), `--font-family-display`, weight tokens
- **Semantic type scale:** `--type-display`, `--type-h1`, `--type-h2`, `--type-h3`, `--type-body`, `--type-small`, `--type-nav`, `--type-button` (+ per-token `-size`, `-line-height`, `-weight`, `-tracking` values)
- **Layout:** spacing tokens, radius tokens, and shadow tokens

## Semantic layout tiers

Use these semantic aliases for shared primitives and component styles:

| Category | Semantic token | Maps to primitive | Intended use |
| --- | --- | --- | --- |
| Spacing | `--spacing-inline` | `--spacing-sm` | Tight, inline controls (button/icon groups, compact row actions). |
| Spacing | `--spacing-stack` | `--spacing-base` | Default vertical rhythm inside forms and dense panels. |
| Spacing | `--spacing-card` | `--spacing-lg` | Card interior padding and major content containers. |
| Spacing | `--spacing-section` | `--spacing-xl` | Page/section separation between layout regions. |
| Radius | `--radius-interactive` | `--radius-md` | Interactive controls (buttons, inputs, chips, alerts). |
| Radius | `--radius-surface` | `--radius-lg` | Surfaces like cards, tables, and panel containers. |
| Radius | `--radius-dialog` | `--radius-lg` | Modal and drawer containers. |
| Shadow | `--shadow-surface` | `--shadow-sm` | Subtle elevation for contained surfaces. |
| Shadow | `--shadow-elevated` | `--shadow-md` | Standard elevated UI (cards, toasts, primary containers). |
| Shadow | `--shadow-overlay` | `--shadow-xl` | Overlay-level elevation for dialogs/drawers. |

## Semantic typography levels

| Semantic level | Utility class | Intended use |
| --- | --- | --- |
| `--type-display` | `.type-display` | Marketing hero headlines and major above-the-fold statements. |
| `--type-h1` | `.type-h1` | Page titles / primary section entry points. |
| `--type-h2` | `.type-h2` | Section titles in dense layouts (public + admin). |
| `--type-h3` | `.type-h3` | Card headings, sub-section headers, and compact heading rows. |
| `--type-body` | `.type-body` | Default paragraph and explanatory copy. |
| `--type-small` | `.type-small` | Supporting labels, captions, helper text, and metadata. |
| `--type-nav` | `.type-nav` | Navigation links, tabs, and route controls. |
| `--type-button` | `.type-button` | CTA/button text across shared primitives. |

## Enforcement rules

1. Do not define alternate theme roots in feature stylesheets.
2. Use canonical token names only; legacy aliases are removed and blocked by style-token compliance checks.
3. Prefer tokenized utility alpha colors from `variables.css` instead of hardcoded `rgba(...)` values.
4. Forbidden hardcoded core palette values in component styles:
   - `#0a0a0a`, `#1a1a1f`, `#b8ff00`, `#a8ee00`, `#ffffff`, `#7a7a8d`, `#9999aa`, `#2a2a2f`

## When to use raw tokens vs semantic tokens

- **Use semantic tokens by default** in shared primitives and feature-level component styles, especially for cards, modals, forms, tables, and buttons.
- **Use raw primitive tokens** only when you are defining or updating the semantic map in `src/styles/variables.css`, or when introducing a genuinely new tier that does not fit an existing semantic alias.
- If a component needs one-off values for experimentation, convert that value into a semantic alias before shipping instead of adding new direct `--spacing-*`, `--radius-*`, or `--shadow-*` usage in component styles.

When adding new styles, extend `src/styles/variables.css` first, then consume those variables.
