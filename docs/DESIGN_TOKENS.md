# Design Tokens (Canonical)

This project uses a **single source of truth** for visual tokens in `src/styles/variables.css`.

## Canonical token groups

- **Backgrounds:** `--color-bg-primary`, `--color-bg-secondary`
- **Accent:** `--color-accent-green`, `--color-accent-green-hover`, `--color-accent-green-active`
- **Text:** `--color-text-primary`, `--color-text-secondary`, `--color-text-nav`, `--color-text-muted`
- **UI:** `--color-border`, `--color-success`, `--color-error`, `--color-info`
- **Typography:** `--font-family-base` (Inter stack), `--font-family-display`, weight tokens
- **Semantic type scale:** `--type-display`, `--type-h1`, `--type-h2`, `--type-h3`, `--type-body`, `--type-small`, `--type-nav`, `--type-button` (+ per-token `-size`, `-line-height`, `-weight`, `-tracking` values)
- **Layout:** spacing tokens, radius tokens, and shadow tokens

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
2. Do not introduce legacy aliases such as `--ink`, `--accent`, `--accent-2`, or standalone admin color roots.
3. Prefer tokenized utility alpha colors from `variables.css` instead of hardcoded `rgba(...)` values.
4. Forbidden hardcoded core palette values in component styles:
   - `#0a0a0a`, `#1a1a1f`, `#b8ff00`, `#a8ee00`, `#ffffff`, `#7a7a8d`, `#9999aa`, `#2a2a2f`

When adding new styles, extend `src/styles/variables.css` first, then consume those variables.
