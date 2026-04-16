# Admin QA Checklist & Smoke Test Runbook

Purpose: prevent recurrence of admin regressions in auth state, blocking overlays, route coverage, layout consistency, and partial-data rendering.

## Scope covered

- Login + EULA + 2FA + session refresh + logout.
- All admin tabs and detail routes render without persistent overlays and with consistent shell layout.
- Analytics and widgets remain usable with partial/incomplete API payloads.
- Uploads + token usage metrics + CSV export render correctly.

## How to run smoke checks

### 1) Static smoke checks (CI-safe, no backend required)

```bash
npm run qa:admin-smoke
```

This validates:

- Route wiring between `ADMIN_SECTIONS` and `src/App.jsx`.
- Auth flow endpoints are still referenced (`/auth/admin/login`, `/admin/sessions/refresh`, `/auth/admin/logout`).
- Overlay dismissal controls remain present in `AdminShell`.
- Analytics KPI fallback normalization exists (partial-data safety).
- Upload token metrics and CSV export wiring remain intact.

### 2) Optional live API route smoke checks (scripted manual)

If you have a running backend:

```bash
ADMIN_SMOKE_BASE_URL=http://localhost:4000 npm run qa:admin-smoke
```

The script sends lightweight requests to key admin endpoints and fails if any return `404`.

## Repeatable manual QA checklist (pre-release)

> Use this after major auth/admin changes and before deployment.

### A. Auth chain: login → EULA → 2FA → refresh → logout

1. **Start from signed-out browser state**
   - Clear local storage keys `admin_session` and `admin_id`.
   - Open `/admin/login`.
   - Expect login form to render (no blank shell, no redirect loops).

2. **Credential step**
   - Submit invalid credentials.
   - Expect non-crashing inline error and no shell-level overlay persists.

3. **EULA gate**
   - Submit valid credentials while EULA is not accepted.
   - Expect explicit EULA requirement state and blocked progression until accepted.

4. **2FA verification**
   - Submit valid credentials + accepted EULA.
   - Expect 2FA challenge or setup step (depending on account).
   - Verify invalid TOTP/backup code fails gracefully.
   - Verify valid code completes login and persists admin session.

5. **Session refresh**
   - Keep admin page open for at least one timer interval.
   - Trigger activity/refresh path and verify no forced logout while session is active.

6. **Logout**
   - Logout from admin header/session controls.
   - Verify local session keys removed and route lands on `/admin/login`.

### B. Route and tab coverage (404 guard + layout consistency)

For each route, verify:

- Page renders inside admin shell (sidebar/header/breadcrumb/purpose/content/footer).
- No full-screen overlay blocks clicks after initial load.
- Browser console has no route/render errors.

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

1. Open mobile nav drawer (small viewport).
2. Close via backdrop button.
3. Navigate to another tab.
4. Confirm drawer/backdrop unmounts and does not block interaction.

### D. Analytics + widget partial-data resilience

Using a staging fixture or API mocking, return partial payloads (missing nested KPI/token/cohort fields).

- Dashboard still renders with defaults (`0`, empty lists, or empty-state cards).
- No runtime exceptions (especially around `analytics.kpis.*` access).
- Charts/tables show empty state instead of crashing.

### E. Uploads + token usage + export

1. Open `/admin/uploads`.
2. Validate cards and table render with mixed usage completeness (`usageAvailable: true/false/null`).
3. Switch to **Token usage** column preset.
4. Confirm token columns display values or placeholder `—`.
5. Trigger CSV export.
6. Verify export URL contains active filters/page params and downloaded CSV matches visible filter scope.

## Known blocker classes and explicit guards

- **Overlay persistence**
  - Guarded by static smoke check on conditional drawer rendering + close actions in `AdminShell`.
- **Route 404 regressions**
  - Guarded by static route-map assertions and optional live endpoint 404 checks.
- **Auth state regressions**
  - Guarded by checks for login/EULA/2FA/session refresh/logout code paths and session-clearing behavior.

## Suggested CI wiring

Add `npm run qa:admin-smoke` to your PR or deployment pipeline before production promotion.
