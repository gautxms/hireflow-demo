# Admin QA Checklist, Smoke Test Runbook, and Screenshot Baseline Workflow

Purpose: prevent admin regressions in auth state, blocking overlays, route coverage, style-token compliance, and visual drift.

## Scope covered

- Login + EULA + 2FA + session timer + session refresh + logout.
- Every admin tab at **desktop and mobile widths**.
- Visual regression baseline for shell + major pages.
- Smoke checks for key API routes that power admin UI tabs.
- Token/variant acceptance criteria for shared admin primitives.

## How to run smoke checks

### 1) Static smoke checks (CI-safe, no backend required)

```bash
npm run qa:admin-smoke
```

### 2) Visual baseline manifest checks (CI-safe)

```bash
npm run qa:admin-visual-baseline
```

### 3) Style-token compliance checks (CI-safe)

```bash
npm run lint:style-tokens
```

The style-token scan fails when **new** JSX style violations are introduced for:
- hardcoded color literals (`#hex`, `rgb()`, `hsl()`),
- hardcoded font-family values,
- legacy alias token usage (`--ink`, `--accent`, `--text`, etc.),
- non-tokenized inline background gradients,
- inline style usage in `src/pages`, `src/components`, `src/admin` that is not runtime width/height/position data.

Inline style guardrail details:
- Allowed inline properties (without exception): `width`, `minWidth`, `maxWidth`, `height`, `minHeight`, `maxHeight`, `top`, `right`, `bottom`, `left`.
- Allowed inline values must be runtime/data-driven expressions (for example template literals with `${...}` or computed expressions), not static literals.
- Approved exceptions must include an allowlist marker comment near the style block: `inline-style-allow runtime-dimension`.
- Violation output includes file and line plus a suggested fix.

Baseline file for known violations:
`docs/qa/baselines/style-token-violations-baseline.json`.

## Repeatable manual QA checklist (pre-release)

### A. Auth chain: login → EULA → 2FA → session timer/refresh → logout

1. Start from signed-out browser state.
2. Verify invalid credentials fail gracefully.
3. Verify EULA acceptance is required before progression.
4. Verify 2FA invalid/valid paths.
5. Verify session timer warning + refresh behavior.
6. Verify logout clears local keys and returns to `/admin/login`.

### B. Admin tabs across desktop + mobile widths

Viewports:
- Desktop: `1440×1024`
- Mobile: `390×844`

Routes:
- `/admin/overview`
- `/admin/users`
- `/admin/billing`
- `/admin/uploads`
- `/admin/analytics`
- `/admin/logs`
- `/admin/health`
- `/admin/security`
- `/admin/users/:id`
- `/admin/uploads/:id`

For each route, verify shell composition, interaction readiness, and no console/runtime errors.

### C. Overlay persistence regression checks

1. Open mobile nav drawer.
2. Close via backdrop.
3. Navigate tabs.
4. Confirm no stuck backdrop or blocked interactions.

### D. Token and variant acceptance criteria (admin)

#### Canonical token checks
- [ ] Core admin semantics resolve to canonical tokens in `src/styles/variables.css`:
  - `--admin-primary` → `--color-accent-green`
  - `--admin-text` → `--color-text-primary`
  - `--admin-text-muted` → `--color-text-secondary`
  - `--admin-border` / `--admin-border-strong` → `--color-border`
  - `--admin-danger` → `--color-error`
  - `--admin-success-*` → success token set
- [ ] Focus states remain tokenized (`--admin-focus` / token-based `color-mix`).
- [ ] New color/font additions are first added to `src/styles/variables.css`.

#### Component variant checks
- [ ] Buttons: `.ui-btn`, `.ui-btn--primary`, `.ui-btn--ghost`
- [ ] Alerts: `.admin-inline-alert--info`, `--success`, `--warning`, `--error`
- [ ] Cards: `.ui-card`, `.admin-primitive-card`
- [ ] Table shell: `.admin-table-surface`, `.admin-table`
- [ ] Health state variants: `.admin-health--green|yellow|red` plus matching status labels.

### E. Uploads + token usage + export

1. Open `/admin/uploads`.
2. Validate mixed usage completeness rendering.
3. Switch to Token usage preset.
4. Verify values/placeholders render.
5. Trigger CSV export and verify scope.

## Screenshot baseline process (required when visuals change)

Baseline source of truth: `docs/qa/baselines/admin-visual-baseline.json`.

1. Capture **before and after** screenshots for every impacted admin route.
2. Capture both required viewports (`desktop`, `mobile`).
3. Compare and annotate expected diffs.
4. Update baseline metadata: `release`, `reviewedAt`, `reviewedBy`, and `notes`.
5. Run `npm run qa:admin-visual-baseline`.
6. Add screenshot evidence + diff summary to PR.

## Suggested CI wiring

```bash
npm run qa:admin-smoke
npm run qa:admin-visual-baseline
npm run lint
npm run lint:style-tokens
```
