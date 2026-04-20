# Design Tokens (Canonical)

This project uses a **single source of truth** for visual tokens in `src/styles/variables.css`.

## Canonical token groups

- **Backgrounds:** `--color-bg-primary`, `--color-bg-secondary`
- **Accent:** `--color-accent-green`, `--color-accent-green-hover`, `--color-accent-green-active`
- **Text:** `--color-text-primary`, `--color-text-secondary`, `--color-text-nav`, `--color-text-muted`
- **UI:** `--color-border`, `--color-success`, `--color-error`, `--color-info`
- **Typography:** `--font-family-base` (Inter stack), `--font-family-display`, weight tokens
- **Layout:** spacing tokens, radius tokens, and shadow tokens

## Enforcement rules

1. Do not define alternate theme roots in feature stylesheets.
2. Legacy aliases are fully removed. Never use `--ink*`, `--accent*`, `--text`, or `--muted`; use canonical `--color-*` tokens only.
3. Prefer tokenized utility alpha colors from `variables.css` instead of hardcoded `rgba(...)` values.
4. Forbidden hardcoded core palette values in component styles:
   - `#0a0a0a`, `#1a1a1f`, `#b8ff00`, `#a8ee00`, `#ffffff`, `#7a7a8d`, `#9999aa`, `#2a2a2f`

When adding new styles, extend `src/styles/variables.css` first, then consume those variables.


## Migration status

Phase 0-5 token migration is complete. Legacy alias tokens are prohibited and enforced by `npm run lint:style-tokens`.
