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

## Resume parse failure transparency rollout (recommended)

If rollout risk is a concern for mixed success/failure batch rendering, gate the UI wiring behind `ANALYSES_PAGES` cohorts first, then ramp to 100% after KPI validation.

### KPI monitoring window

Monitor for **1–2 weeks** after enabling for production traffic:

- Parse-failure rate (`failedCount / totalResumes`) by file type and provider.
- Retry/re-upload rate for failed resumes.
- Token-per-successful-resume (provider usage divided by successful parses).
- Reduction in ambiguous `Unknown Candidate` incidents in support tickets and logs.

### Rollout checkpoints

1. Day 0–2: 10% cohort, verify no spike in parse-failure or re-upload metrics.
2. Day 3–7: 50% cohort, compare token-per-successful-resume against baseline.
3. Day 8–14: 100% cohort if KPI deltas are neutral or improved.

## Parse validation reason observability (Task 4.1)

### Metric/event emitted
- Event type: `parse_validation_failure_reason`
- Metric key in metadata: `parse_validation_failure_reason_total`
- Dimensions/tags: `reason`, `model`, `provider`, `promptVersion`, `mimeType`, `extractionMethod`
- Count value in metadata: `count`

### Single-query top-5 failure reasons (last 24h)
```sql
SELECT
  metadata->>'reason' AS reason,
  SUM(COALESCE((metadata->>'count')::int, 0)) AS failure_count
FROM events
WHERE event_type = 'parse_validation_failure_reason'
  AND timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 5;
```

### Dashboard panels
1. **Top parse failure reasons (24h)**
   - Query: top-5 SQL above.
2. **Failure reason trend by hour**
   - Group by `date_trunc('hour', timestamp)` and `reason`.
3. **Failure reason breakdown by provider/model**
   - Group by `provider`, `model`, and `reason`.
4. **Failure reason by extraction method + MIME**
   - Group by `extractionMethod`, `mimeType`, and `reason`.

### Alert threshold
- Alert name: `parse-validation-failure-spike`
- Condition: in a 15-minute window, either:
  - `failure_placeholder_detected` total count >= 25, or
  - `failure_narrative_detected` total count >= 25, or
  - combined total (`failure_placeholder_detected` + `failure_narrative_detected`) >= 40.
- Severity: warning (page on-call only if sustained for 3 consecutive windows).

## Backend parse stabilization staged rollout (Task 6.1)

Feature flags (server-side, deterministic cohorting):

- `enable_placeholder_retry`
  - Env: `FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT`
- `enable_extended_resume_signals`
  - Env: `FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT`
- `enable_validation_sample_logging`
  - Env: `FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT`

Each env value is a rollout percentage (`0-100`) evaluated against a stable hash of `userId:resumeId`.

### Staged rollout sequence

1. Start at `10%` for all three flags.
2. Ramp to `50%` if KPI deltas remain within limits.
3. Ramp to `100%` when the 50% window remains healthy.

Recommended production env progression:

```bash
# Stage 1 (10%)
FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT=10
FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT=10
FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT=10

# Stage 2 (50%)
FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT=50
FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT=50
FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT=50

# Stage 3 (100%)
FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT=100
FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT=100
FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT=100
```

### Acceptance criteria guardrail

Do not advance between stages unless both hold vs the 7-day pre-rollout baseline:

- P95 parse latency regression <= agreed threshold.
- Token/cost per successfully scored resume regression <= agreed threshold.

If either exceeds limits, hold current stage or roll back impacted flags to the prior percentage.
