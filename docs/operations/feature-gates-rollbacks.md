# Feature gates and rollback playbook

This release introduces gated rollouts for the following user-facing modules:

- Sidebar shell (`sidebar_shell`)
- Analyses pages (`analyses_pages`)
- Candidate module (`candidate_module`)
- Dashboard + reports (`dashboard_reports`)
- Shortlist v2 (`shortlist_v2`)

## Runtime controls

Each gate supports environment-level toggles and cohort rollouts through Vite env vars.

### Env var naming

Use the feature prefix table below:

- `SIDEBAR_SHELL`
- `ANALYSES_PAGES`
- `CANDIDATE_MODULE`
- `DASHBOARD_REPORTS`
- `SHORTLIST_V2`

For each feature prefix, configure:

- `VITE_FF_<PREFIX>_ENABLED`
  - `on` / `true` / `1` to force enable
  - `off` / `false` / `0` to force disable
- `VITE_FF_<PREFIX>_ALLOWLIST`
  - Comma-separated user IDs or emails for explicit access
- `VITE_FF_<PREFIX>_ROLLOUT`
  - Percentage `0-100` rollout based on stable user hash

### Default behavior

- **Production (`import.meta.env.PROD === true`) defaults to OFF** when no toggle is configured.
- **Non-production defaults to ON** so staging/dev can validate without extra setup.

### Per-user local override (debug)

In browser local storage, set:

- `hireflow_ff_sidebar_shell`
- `hireflow_ff_analyses_pages`
- `hireflow_ff_candidate_module`
- `hireflow_ff_dashboard_reports`
- `hireflow_ff_shortlist_v2`

Supported values:

- `on`
- `off`

## Rollback procedures (preserve legacy uploader/results)

If any newly gated module degrades production, disable only the affected gate and keep legacy flows intact.

### 1) Sidebar shell failure

1. Set `VITE_FF_SIDEBAR_SHELL_ENABLED=off`.
2. Redeploy frontend.
3. Validate users can still access uploader/results through the legacy top nav.

Expected fallback:

- App renders legacy layout (no sidebar shell).
- Uploader/results workflow remains available.

### 2) Analyses pages failure

1. Set `VITE_FF_ANALYSES_PAGES_ENABLED=off`.
2. Redeploy frontend.
3. Validate `/analyses` and `/analyses/:id` redirect users to `/results`.

Expected fallback:

- Legacy results experience remains primary for completed uploads.

### 3) Candidate module failure

1. Set `VITE_FF_CANDIDATE_MODULE_ENABLED=off`.
2. Redeploy frontend.
3. Validate `/candidates` and `/candidates/:id` redirect to `/results`.

Expected fallback:

- Legacy uploader/results flow remains available.

### 4) Dashboard/reports failure

1. Set `VITE_FF_DASHBOARD_REPORTS_ENABLED=off`.
2. Redeploy frontend.
3. Validate `/dashboard` loads the legacy dashboard and `/reports` routes users to `/dashboard/legacy`.

Expected fallback:

- Legacy dashboard remains available.
- Core uploader/results workflow is unchanged.

### 5) Shortlist v2 failure

1. Set `VITE_FF_SHORTLIST_V2_ENABLED=off`.
2. Redeploy frontend.
3. Validate candidate results still support shortlist operations via legacy single-candidate API flow.

Expected fallback:

- Shortlist side panel and batch-first v2 interactions are disabled.
- Results page still allows shortlist additions (legacy behavior).

## Recommended emergency response order

1. Disable only the impacted gate.
2. Confirm `/` -> uploader -> `/results` still works end-to-end.
3. Confirm no auth regression on protected routes.
4. Re-enable for a small cohort using `ROLLOUT` after fix verification.
