# Resume usage quota RCA and safe simulation plan

## Current behavior RCA

- Usage is stored in `usage_log`; each accepted upload request/session creates one row for the current user and month. Admin limit/reset overrides are stored separately in `usage_overrides`.
- Usage is tracked per authenticated `users.id` and calendar month, not per organization, tenant, billing customer, subscription ID, or plan instance.
- The paid monthly resume analysis limit is `800`; trial/free limit is `10`; an admin `usage_overrides.upload_limit` can replace either.
- Server-side enforcement exists on classic multipart resume upload and chunk upload initialization. The frontend can display usage via `GET /usage/resume-analysis`, but quota safety does not depend on frontend checks.
- Classic multipart upload checks quota after Multer parses files and `requireResumeFiles` validates file presence, but before analysis creation, resume rows, `analysis_items`, or parse jobs are created.
- Chunk upload checks quota during `/uploads/chunks/init`, before creating or resuming an upload session. Chunk storage and completion only require active subscription and rely on the already-created session.
- Bulk multipart uploads are all-or-nothing at the quota guard: requested files are counted as `req.files.length`, and the request is rejected when projected usage exceeds the limit.
- Classic usage is incremented immediately after quota validation and before scanning/enqueueing. This means scan failures still consume usage. If later database/enqueue work fails, usage is not rolled back.
- Chunk usage is incremented when a new chunk session is initialized, not when chunks complete or analysis finishes. Resumed chunk sessions do not increment usage again. Scan/assembly/AI failures after init still consume usage.
- Existing analyses, results, candidates, reports, shortlists, and exports use active-subscription checks but do not apply the resume usage limit, so old completed/partial/processing analyses remain accessible at limit.
- Billing/upgrade copy exists in the quota error response (`Contact support or upgrade your plan to continue.`). `X-Usage-Warning` is set after accepted uploads whose projected usage is at or above 80%, and the usage endpoint returns warning levels at 75%, 90%, and 100%.

## Files and functions involved

- `backend/src/config/resumeAnalysisQuota.js`: limit constants and `resolveMonthlyResumeAnalysisLimit`.
- `backend/src/middleware/subscriptionCheck.js`: `getMonthStart`, `getUsageOverride`, `getUsageCount`, `requireActiveSubscription`, `enforceUploadLimit`, `recordUploadUsage`, and `trackUploadUsage`.
- `backend/src/routes/uploads.js`: classic multipart upload flow; quota middleware runs before analysis/job creation.
- `backend/src/routes/uploadChunks.js`: async/chunk init, chunk, complete flow; quota middleware runs on init.
- `backend/src/services/fileUploadService.js`: creates chunk upload sessions, analyses for no-job uploads, resumes, `analysis_items`, and parse jobs.
- `backend/src/routes/usage.js`: authenticated usage API and warning-level calculation.
- `backend/src/routes/profile.js`: dashboard monthly usage summary, currently counted from `analysis_items`, not `usage_log`.
- `src/pages/Pricing.jsx`: public pricing FAQ stating paid plans include up to 800 resume analyses/month.

## Safe local/staging simulation

Use `backend/scripts/simulateResumeUsage.local.mjs`. It inserts marker rows into `usage_log` with `ip_address = 'quota-simulation-local'` for one user/month, without uploading files or calling AI providers.

Safety controls:

- Refuses to run when `NODE_ENV=production`.
- Requires `HIREFLOW_ALLOW_USAGE_SIMULATION=true`.
- Requires `HIREFLOW_USAGE_SIMULATION_ENV=local` or `HIREFLOW_USAGE_SIMULATION_ENV=staging`.
- Requires an explicit `--user-id`.
- Only accepts target states `750`, `790`, `795`, `799`, `800`, or `801`.
- Deletes/replaces only prior simulation rows with the marker IP; it does not delete real usage.

Example:

```bash
HIREFLOW_ALLOW_USAGE_SIMULATION=true HIREFLOW_USAGE_SIMULATION_ENV=local DATABASE_URL=postgres://... node backend/scripts/simulateResumeUsage.local.mjs --user-id 123 --usage 799
```

## Test matrix: observed from code audit

| Scenario | Observed behavior |
|---|---|
| 750/800 uploads 5 | Allowed. Usage records 5 more immediately; warning header because projected usage is 94%. |
| 790/800 uploads 5 | Allowed. Usage records 5 more immediately; warning header because projected usage is 99%. |
| 799/800 uploads 1 | Allowed. Usage records 1 more immediately; warning header says 100%. |
| 800/800 uploads 1 | Blocked with HTTP 429 before analysis/job creation. |
| 795/800 uploads 10 | Entire bulk request blocked with HTTP 429; no partial acceptance. |
| 800/800 opens old completed analysis | Allowed if subscription remains active; usage quota is not checked on read routes. |
| 800/800 opens candidate results | Allowed if subscription remains active; usage quota is not checked on results/candidate reads. |
| 800/800 tries to create an analysis without a job | Chunk init is blocked with HTTP 429 before `initChunkUpload` can create its no-job analysis. |
| 799/800 starts async analysis with multiple files | Each chunk init is one resume. First new init is allowed and increments to 800; subsequent new inits are blocked. This can produce partial multi-file async acceptance if the frontend starts files one-by-one. |
| Extraction failure or AI failure near limit | Usage has already been consumed at upload/session-init time; later extraction/AI failures do not decrement usage. |

## Recommended final behavior

- Keep server-side all-or-nothing blocking for classic bulk uploads when requested files exceed remaining quota.
- Avoid partial acceptance for classic bulk uploads. Partial acceptance is harder to explain and risks confusing async state, ranking, and result rendering.
- For chunk/multi-file async, add a batch reservation or preflight endpoint before individual file sessions so multi-file async cannot partially cross the limit.
- Near-limit message: `You have used {used} of {limit} resume analyses this month. You have {remaining} remaining. Uploading {requested} will bring you to {projected}/{limit}.`
- Reached-limit message: `You have reached your monthly resume analysis limit of {limit}. Existing analyses remain available. Upgrade or contact support to analyze more resumes this month.`
- Show a billing/support CTA at critical and exceeded states, while preserving access to historical analyses.
- Existing completed, partial, failed, and processing analyses should remain readable at limit.
- Prefer incrementing usage when a resume analysis is accepted for processing (after safe file validation/scanning and immediately before parse job enqueue) or using a reservation with release-on-validation-failure. This avoids charging clearly rejected files while still preventing quota races.

## Acceptance criteria

- Quota is enforced server-side on every resume-analysis creation path.
- Frontend-only changes cannot bypass quota.
- Classic and async bulk uploads cannot exceed remaining quota accidentally.
- Async parse jobs are not created when quota validation fails.
- Existing completed/partial/processing/failed analyses remain viewable at the limit.
- Limit and near-limit errors are friendly and do not expose raw backend errors.
- No stuck modal, stuck upload, or stuck processing state occurs after quota rejection.
- Usage count is accurate after success, scan failure, extraction failure, AI failure, and mixed failure scenarios.
- AI analysis, async processing, candidate scoring/ranking, and results rendering are unchanged by quota checks.

## Suggested tests

- Backend quota guard: exact remaining, exceeded, and admin override cases.
- Classic bulk upload over-limit blocks the entire request and creates no analysis or jobs.
- Exact-limit upload succeeds and reaches `800/800`.
- Near-limit warning header/API warning-level behavior.
- Existing analysis and candidate result reads at `800/800`.
- Async chunk init prevents job/session creation when already over limit.
- Async multi-file preflight/batch reservation prevents partial over-limit starts.
- Usage counter behavior for scan failure, extraction failure, AI failure, and partial failure.

## Low-risk implementation phases

1. Keep this simulation script and add backend tests around current quota middleware behavior.
2. Add a frontend near-limit/exceeded banner that consumes existing usage API data and quota error payloads.
3. Add async multi-file quota preflight/reservation before starting individual chunk sessions.
4. Move or reserve usage accounting to avoid charging rejected scans, with migration-safe observability.
5. Add end-to-end coverage for historical analysis access and no-regression checks for scoring/results rendering.

## Risks and rollback notes

- Moving usage accounting later can introduce quota race conditions unless implemented with reservations or transactions.
- Changing chunk upload quota behavior can disrupt resumable uploads; preserve resumed-session semantics.
- Dashboard currently counts monthly usage from `analysis_items`, while quota enforcement counts `usage_log`; align only after validating historical expectations.
- Rollback for the simulation script is simple: delete marker rows with `ip_address = 'quota-simulation-local'` for the test user/month or revert the script commit.
