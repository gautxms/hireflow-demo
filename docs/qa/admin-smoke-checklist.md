# Admin QA Checklist, Smoke Test Runbook, and Screenshot Baseline Workflow

Purpose: prevent recurrence of admin regressions in auth state, blocking overlays, route coverage, layout consistency, visual drift, and API connectivity after rapid fixes.

## Scope covered

- Login + EULA + 2FA + session timer + session refresh + logout.
- Every admin tab at **desktop and mobile widths**.
- Visual regression baseline for shell + major pages.
- Smoke checks for key API routes that power admin UI tabs.

## How to run smoke checks

### 1) Static smoke checks (CI-safe, no backend required)

```bash
npm run qa:admin-smoke
```

This validates:

- Route wiring between `ADMIN_SECTIONS` and `src/App.jsx`.
- Auth flow endpoints remain wired (`/auth/admin/login`, `/admin/sessions/refresh`, `/auth/admin/logout`).
- EULA + 2FA + session timer + logout controls remain present in admin auth flow.
- Overlay dismissal controls remain present in `AdminShell`.
- Analytics KPI fallback normalization exists (partial-data safety).
- Upload token metrics and CSV export wiring remain intact.

### 2) Visual baseline manifest checks (CI-safe)

```bash
npm run qa:admin-visual-baseline
```

This validates baseline metadata is populated and includes:

- Required viewports: `desktop` and `mobile`.
- Required routes: login + all major admin pages (`/admin/overview`, `/admin/users`, `/admin/billing`, `/admin/uploads`, `/admin/analytics`, `/admin/logs`, `/admin/health`, `/admin/security`).

### 3) Optional live API route smoke checks (scripted manual)

If you have a running backend:

```bash
ADMIN_SMOKE_BASE_URL=http://localhost:4000 npm run qa:admin-smoke
```

The script sends lightweight requests to key admin endpoints (auth/session + each admin tab API) and fails if any return `404`.

## Repeatable manual QA checklist (pre-release)

> Use this after rapid fixes to auth/navigation/layout or before production deployment.

### A. Auth chain: login → EULA → 2FA → session timer/refresh → logout

1. **Start from signed-out browser state**
   - Clear local storage keys `admin_session` and `admin_id`.
   - Open `/admin/login`.
   - Expect login form to render (no blank shell, no redirect loops).

2. **Credential step**
   - Submit invalid credentials.
   - Expect non-crashing inline error and no persistent shell-level overlay.

3. **EULA gate**
   - Submit valid credentials while EULA is not accepted.
   - Expect explicit EULA requirement and blocked progression until accepted.

4. **2FA verification**
   - Submit valid credentials + accepted EULA.
   - Expect 2FA challenge or setup step (depending on account).
   - Verify invalid TOTP/backup code fails gracefully.
   - Verify valid code completes login and persists admin session.

5. **Session timer + refresh**
   - Confirm `Session timer` is visible and decrements.
   - Keep admin open until near warning threshold.
   - Trigger activity/refresh path and verify timer extends without forced logout.

6. **Logout**
   - Logout from admin session controls.
   - Verify local session keys are removed and route lands on `/admin/login`.

### B. Admin tabs across desktop + mobile widths

Use both widths for each page below:

- **Desktop:** `1440×1024`
- **Mobile:** `390×844`

For each route, verify:

- Page renders inside admin shell (sidebar/header/breadcrumb/purpose/content/footer).
- No full-screen overlay blocks clicks after initial load.
- Browser console has no route/render errors.
- Mobile drawer opens and closes cleanly, with no persistent backdrop.

Routes to verify:

- `/admin/overview`
- `/admin/users`
- `/admin/billing`
- `/admin/uploads`
- `/admin/analytics`
- `/admin/logs`
- `/admin/health`
- `/admin/security`
- `/admin/users/:id` (open from user row)
- `/admin/uploads/:id` (open from uploads row)

### C. Overlay persistence regression checks

1. Open mobile nav drawer.
2. Close via backdrop button.
3. Navigate to another tab.
4. Confirm drawer/backdrop unmounts and does not block interaction.

### D. Analytics + widget partial-data resilience

Using a staging fixture or API mocking, return partial payloads (missing nested KPI/token/cohort fields).

- Dashboard renders with defaults (`0`, empty lists, or empty-state cards).
- No runtime exceptions (especially around `analytics.kpis.*`).
- Charts/tables show empty state instead of crashing.

### E. Uploads + token usage + export

1. Open `/admin/uploads`.
2. Validate cards and table render with mixed usage completeness (`usageAvailable: true/false/null`).
3. Switch to **Token usage** column preset.
4. Confirm token columns display values or placeholder `—`.
5. Trigger CSV export.
6. Verify export URL contains active filters/page params and downloaded CSV matches visible scope.

## Screenshot baseline process (required each release)

Baseline source of truth: `docs/qa/baselines/admin-visual-baseline.json`.

Per release:

1. Capture screenshots for every baseline route at both required widths.
2. Compare with previous baseline and flag visual diffs for review.
3. Update `release`, `reviewedAt`, and `reviewedBy` in baseline JSON.
4. Run `npm run qa:admin-visual-baseline`.
5. Attach screenshot diff review summary to PR/release notes.

## Known blocker classes and explicit guards

- **Persistent overlay/backdrop**
  - Guarded by static smoke check on conditional drawer rendering + close actions in `AdminShell`.
- **Auth chain drift (EULA/2FA/session/logout)**
  - Guarded by static checks on admin auth hook and login page controls.
- **Admin tab API route regressions**
  - Guarded by optional live endpoint smoke checks that assert non-404 for key UI-backed routes.
- **Screenshot baseline drift**
  - Guarded by baseline manifest validation and release review metadata.

## Suggested CI wiring

Run these before production promotion:

```bash
npm run qa:admin-smoke
npm run qa:admin-visual-baseline
```

Optionally add a staging job with backend enabled:

```bash
ADMIN_SMOKE_BASE_URL=https://<staging-api-host> npm run qa:admin-smoke
```
