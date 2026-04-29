# PR QA Checklist Artifact (Public + Admin)

Use this checklist in every PR review. A PR is not ready to merge until all required items are checked or explicitly waived.

## 1) Public experience QA

### Core UX and routing
- [ ] Primary public routes load without runtime errors.
- [ ] Navigation links and CTA buttons route correctly.
- [ ] Responsive behavior validated at `1440x1024` and `390x844`.
- [ ] Public SEO routes (`/`, `/pricing`, `/about`, `/contact`, `/help`, `/terms`, `/privacy`, `/refund-policy`) return readable heading/body copy in raw HTTP responses.
- [ ] “View Source” for each public SEO route includes readable marketing/legal text before hydration.

### Token and style compliance
- [ ] No hardcoded color literals in JSX `style={{ ... }}` blocks.
- [ ] No hardcoded font stacks in JSX `style={{ ... }}` blocks.
- [ ] Color and font styling in JSX use canonical tokens from `src/styles/variables.css`.
- [ ] Zero legacy alias token usage (`--ink*`, `--accent*`, `--text`, `--muted`) in `src/`.
- [ ] In `src/pages`, `src/components`, and `src/admin`, inline styles are runtime-only width/height/position values, data-driven, and explicitly allowlisted via `inline-style-allow` marker when retained.

### Visual QA evidence
- [ ] Before/after screenshots attached for any visual-impact change.
- [ ] Screenshot labels include route + viewport + scenario.
- [ ] If expected visual diffs exist, reviewer-approved notes are included in the PR.

## 2) Admin experience QA

### Auth and shell flows
- [ ] Login → EULA → 2FA → session refresh → logout flow validated.
- [ ] Sidebar/mobile drawer opens and closes without persistent overlay.
- [ ] Major admin pages render with no blocking shell overlays.

### Component-variant verification
- [ ] Buttons use approved variants (`.ui-btn`, `.ui-btn--primary`, `.ui-btn--ghost`).
- [ ] Alerts use approved tones (`.admin-inline-alert--info|success|warning|error`).
- [ ] Cards and table surfaces use approved primitives (`.ui-card`, `.admin-table-surface`).

### Token-acceptance verification
- [ ] Admin shell semantic tokens map to canonical tokens (`--admin-primary`, `--admin-text`, `--admin-border`, etc.).
- [ ] Variant states (hover/active/focus/disabled) consume tokenized values, not hardcoded values.
- [ ] New admin styles are documented in `docs/qa/admin-smoke-checklist.md` acceptance criteria.

## 3) Primitive composition policy gate

### Primitive composition policy
- [ ] New major UI in scoped public/admin folders composes from approved primitives by default.
- [ ] No new ad-hoc palette/surface utility bypass patterns introduced in critical directories.
- [ ] Any primitive bypass is documented with a valid `PCX-###` exception and design approval in `docs/PRIMITIVE_COMPOSITION_EXCEPTIONS.md`.

## 4) Required automated checks (merge gate)

- [ ] `npm run qa:admin-smoke`
- [ ] `npm run qa:admin-visual-baseline`
- [ ] `npm run lint`
- [ ] `npm run lint:style-tokens`
- [ ] `npm run lint:primitives`
- [ ] `npm run qa:primitive-visual-baseline`

## 5) Token migration gate (required before merge)

- [ ] `npm run lint:style-tokens` passes with **0 new violations**.
- [ ] Any allowed token violation is explicitly listed in `docs/qa/baselines/style-token-violations-baseline.json` with an active Exception ID from `docs/BRAND_GUIDELINE_EXCEPTIONS.md`.
- [ ] No legacy alias usage exists in JSX inline styles or CSS (`--ink*`, `--accent*`, `--text`, `--muted`).
- [ ] No new inline-style guardrail findings (`inline-style-non-runtime-forbidden`, `inline-style-runtime-value-required`) are introduced.
- [ ] If this PR is part of a phased migration, confirm this gate remains green to prevent regressions/conflicts in later phases.

## 6) Baseline update process (required when visuals change)

1. Capture before/after screenshots for impacted route(s) at desktop and mobile widths.
2. Update `docs/qa/baselines/admin-visual-baseline.json` and/or `docs/qa/baselines/primitive-visual-regression-baseline.json` release metadata.
3. Run `npm run qa:admin-visual-baseline` and `npm run qa:primitive-visual-baseline`.
4. If primitive visual baseline changed, require reviewer sign-off from Design Systems and QA in the PR before merge.
5. If intentional token-compliance deltas were introduced, update the style scan baseline with:
   - `npm run lint:style-tokens:baseline`
6. Include a short “Visual QA + Baseline Updates” section in the PR description.

## 7) Preview-to-production visual verification (PH6-T2)

- [ ] Follow `docs/qa/preview-to-production-visual-verification.md` end-to-end.
- [ ] Validate PR Preview URL first, then re-validate production after merge.
- [ ] Verify production deployment commit SHA matches merged PR commit SHA.
- [ ] Confirm Vercel serves `dist` from root project build config (no subdirectory mismatch).
- [ ] Attach desktop + mobile screenshots for Hero and key routes in preview and production.
