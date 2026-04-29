# Admin Token + Variant Acceptance Criteria

This document defines merge acceptance criteria for admin UI changes that affect styling.

## Canonical token contract

All admin styles must resolve through canonical tokens from `src/styles/variables.css`.

| Admin semantic token | Required canonical token |
|---|---|
| `--admin-primary` | `--color-accent-green` |
| `--admin-primary-strong` | `--color-accent-green-hover` |
| `--admin-text` | `--color-text-primary` |
| `--admin-text-muted` | `--color-text-secondary` |
| `--admin-text-subtle` | `--color-text-nav` |
| `--admin-border` / `--admin-border-strong` | `--color-border` |
| `--admin-danger` | `--color-error` |
| `--admin-success-subtle` | `--color-success-alpha-12` |
| `--admin-warning-subtle` | `--color-warning-alpha-12` |

## Component variant contract

### Buttons
- Base: `.ui-btn`
- Variants: `.ui-btn--primary`, `.ui-btn--ghost`
- States: default + hover + disabled must be tokenized.

### Alerts
- Base: `.admin-inline-alert`
- Variants: `--info`, `--success`, `--warning`, `--error`
- Border/background/text values must be tokenized.

### Cards and tables
- Cards: `.ui-card`, `.admin-primitive-card`
- Table container: `.admin-table-surface`
- Table element: `.admin-table`
- New card/table variants must use existing token semantics unless explicitly approved.

### Health indicators
- Variants: `.admin-health--green`, `.admin-health--yellow`, `.admin-health--red`
- Matching text variants: `.admin-health__status--green|yellow|red`
- Any newly introduced semantic state must map to a named token.

## JSX inline-style guardrails

Forbidden in JSX `style={{...}}`:
- Hardcoded colors (`#hex`, `rgb()`, `hsl()`).
- Hardcoded font-family lists.
- Legacy aliases (`--ink`, `--accent`, `--text`, `--muted`).

Required:
- Use canonical `var(--token-name)` values.
- Add new tokens to `src/styles/variables.css` before usage.
