# PR QA Checklist Artifact (Public + Admin)

Use this checklist in every PR review. A PR is not ready to merge until all required items are checked or explicitly waived.

## 1) Public experience QA

### Core UX and routing
- [ ] Primary public routes load without runtime errors.
- [ ] Navigation links and CTA buttons route correctly.
- [ ] Responsive behavior validated at `1440x1024` and `390x844`.

### Token and style compliance
- [ ] No hardcoded color literals in JSX `style={{ ... }}` blocks.
- [ ] No hardcoded font stacks in JSX `style={{ ... }}` blocks.
- [ ] Color and font styling in JSX use canonical tokens from `src/styles/variables.css`.
- [ ] No legacy alias tokens (`--ink`, `--accent`, `--text`, `--muted`, etc.) are introduced.

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

## 3) Required automated checks (merge gate)

- [ ] `npm run qa:admin-smoke`
- [ ] `npm run qa:admin-visual-baseline`
- [ ] `npm run lint`
- [ ] `npm run lint:style-tokens`

## 4) Baseline update process (required when visuals change)

1. Capture before/after screenshots for impacted route(s) at desktop and mobile widths.
2. Update `docs/qa/baselines/admin-visual-baseline.json` release metadata.
3. Run `npm run qa:admin-visual-baseline`.
4. If intentional token-compliance deltas were introduced, update the style scan baseline with:
   - `npm run lint:style-tokens:baseline`
5. Include a short “Visual QA + Baseline Updates” section in the PR description.
