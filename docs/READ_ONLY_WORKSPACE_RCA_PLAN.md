# Read-only workspace access RCA and implementation plan

## Scope and safety constraints

This document is RCA/planning only. It intentionally does not change product behavior, AI resume analysis, async processing, candidate scoring/ranking, Paddle webhooks, database schema, or data mutations.

Future implementation must preserve these constraints:

- Authenticated users may view/export their own historical HireFlow data when they are past_due, payment_failed, canceled/cancelled, inactive, trial-ended, or non-subscribed.
- Non-active users must not perform paid workflow mutations.
- Backend enforcement is mandatory; frontend disabled/hidden controls are only UX support.
- All data access must remain scoped to the authenticated user.
- Any UI work must follow `docs/DESIGN_CONSTITUTION.md` exactly, especially the app-shell/public-shell split, typography, canonical colors, Lucide icons, sidebar behavior, and app footer rules.

## RCA summary

### Current behavior

- Frontend workspace shell rendering and most workspace routes are tied to `canAccessProductDashboard(...)`, which currently returns `hasActivePaidAccess(...)`. Non-active authenticated users are redirected to pricing for paid workspace routes.
- Authenticated-account shell currently covers account routes and only a narrow set of historical routes (`/results`, `/analyses/:id`, `/candidates/:id`) for non-active users.
- `/analyses` and `/candidates` list pages are currently treated as paid workspace routes, so non-active users cannot browse historical lists even though detail routes only require authentication.
- `/job-descriptions` is blocked for non-active users at both frontend routing and backend app-level middleware, including GET requests.
- Backend mutation protection exists on many paid actions through `requireActiveSubscription`, but coverage is inconsistent:
  - Strong coverage: uploads/chunk creation, candidate reanalysis/match/tag mutations, shortlists mutations, reports mutations, results CSV export.
  - Risky coverage: `DELETE /api/analyses/:id` is authenticated but not subscription-guarded, so it would allow a historical data mutation by unpaid users if reachable.
  - Route-level ambiguity: `/api/job-descriptions` is mounted behind `requireActiveSubscription`, so even read-only GETs are currently blocked.
  - Export mismatch: `GET /api/profile/export` is account/data export and currently authenticated-only, while `POST /api/results/export/csv` is subscription-guarded; product must decide whether historical export includes results CSV export and then guard only generation-like paid actions.

### Key implementation implication

Read-only workspace access should be introduced as a separate authorization mode, not by weakening active-subscription checks. Future work should add explicit route-policy helpers and backend mutation guards so historical GET/export endpoints are allowed while paid mutations continue to return 403 for every non-active paid state.

## Existing UI/routing patterns inspected

- `src/App.jsx` owns route matching, redirects, shell selection, and inline app nav construction.
- `src/config/userShellRouting.js` defines workspace/account/historical route classifiers.
- `src/config/userNavigation.js` defines legacy account aliases (`/account/*` to current routes).
- `src/utils/subscriptionState.js` defines frontend subscription normalization and access helpers.
- `src/utils/routeGuards.js` wraps auth/subscription guard decisions.
- `src/components/app-shell/UserAppShell.jsx` implements the app sidebar/header/footer pattern.
- `src/components/app-shell/AuthenticatedAccountShell.jsx` implements the limited account shell for non-workspace access.
- Relevant pages inspected at routing/API level include dashboard, jobs/job descriptions, analyses/detail, candidates/detail, shortlists, reports, uploader/create-analysis, settings, billing, checkout/pricing, and export routes.

## Frontend route inventory

| Route | Current classification | Target classification for unpaid authenticated users | Notes |
| --- | --- | --- | --- |
| `/` | Public | Public | Logged-in CTA currently varies by active subscriber state. |
| `/pricing` | Public/upgrade | Public/account billing entry | Active subscribers redirect to `/billing`; non-active users can view plans. |
| `/checkout` | Checkout standalone | Account/billing only | Must remain authenticated/checkout flow; do not alter Paddle behavior. |
| `/billing/success`, `/billing/cancel` | Checkout standalone | Account/billing only | Return pages; no workspace mutation semantics. |
| `/dashboard` | Active paid access | Read-only allowed with limited/historical dashboard if backed by GET-only data | Current guard redirects non-active users to pricing. Future dashboard must not expose create/upload/analyze/report-generation actions. |
| `/dashboard/legacy` | Active paid access | Blocked or read-only allowed only if legacy dashboard is made safe | Legacy dashboard should be audited before exposing; safer initial phase is block/redirect to read-only landing. |
| `/jobs` | Active paid access alias to `/job-descriptions` | Read-only allowed for historical job descriptions if backend GETs are unblocked | Alias exists in navigation and shell route set, but no direct App branch except alias resolution. |
| `/job-descriptions` | Active paid access | Read-only allowed | Must hide/disable create/edit/delete/duplicate/upload attachment actions in UI and rely on backend mutation guard. |
| `/analyses` | Active paid access | Read-only allowed | Should list historical completed/partial/failed/processing analyses without create-analysis CTA for read-only users. |
| `/analyses/:id` | Authenticated historical route | Read-only allowed | Already auth-only in route; must preserve completed/partial/failed/processing rendering. |
| `/candidates` | Active paid access | Read-only allowed | Candidate directory should be GET-only and hide paid matching/tag mutation controls. |
| `/candidates/:id` | Authenticated historical route | Read-only allowed | Already auth-only in route. Must preserve rendering and owner scoping. |
| `/shortlists` | Active paid access | Read-only allowed | GET list/detail can be historical; create/update/delete/add/remove/archive actions must be blocked. |
| `/reports` | Active paid access | Read-only allowed for existing saved report definitions only; report generation is paid mutation | Current page may create report definitions; future read-only mode must suppress generation/edit/delete. |
| `/uploader` | Active paid access | Blocked for unpaid authenticated users | Paid workflow action that leads to resume upload/AI analysis. |
| `/create-analysis` | Active paid access | Blocked for unpaid authenticated users | Paid workflow action; must not be enabled for read-only states. |
| `/settings` | Authenticated account | Account/billing only | Profile/account updates are not paid workspace actions, but still mutate account data. |
| `/billing` | Authenticated account | Account/billing only | Must remain available for past_due/payment_failed/canceled users where provider IDs exist. |
| `/account` | Legacy account path | Account/billing only | Currently normalized to `/settings`. |
| `/account/payment-method` | Authenticated account | Account/billing only | Must not change Paddle/payment behavior. |
| `/account/dashboard` | Legacy alias to `/dashboard` | Same as `/dashboard` | Alias resolution should avoid redirect loops. |
| `/account/results` | Legacy alias to `/results` | Read-only allowed | Historical latest local/session results route. |
| `/account/analyses` | Legacy alias to `/analyses` | Read-only allowed | Alias resolution should preserve read-only route policy. |
| `/account/candidates` | Legacy alias to `/candidates` | Read-only allowed | Alias resolution should preserve read-only route policy. |
| `/account/shortlists` | Legacy alias to `/shortlists` | Read-only allowed | Alias resolution should preserve read-only route policy. |
| `/account/job-descriptions` | Legacy alias to `/job-descriptions` | Read-only allowed | Backend GET unblocking required. |
| `/account/reports` | Legacy alias to `/reports` | Read-only allowed for saved reports | Generation/edit/delete remain blocked. |
| `/account/billing` | Legacy alias to `/billing` | Account/billing only | Authenticated account route. |
| `/account/settings` | Legacy alias to `/settings` | Account/billing only | Authenticated account route. |
| `/results` | Authenticated historical route | Read-only allowed | Current local/session latest results; should not be confused with persisted analyses. |
| `/results/:token` | Public shared results | Public shared read-only | No auth; data exposed only by share token. Sharing creation is a mutation and should be reviewed. |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify*` | Public/auth | Public/auth | No workspace access implications. |
| `/about`, `/help`, `/contact`, `/demo`, `/privacy`, `/terms`, `/ai-disclosure`, `/trust`, `/cookie-policy`, `/refund-policy`, SEO intent routes | Public | Public | No workspace access implications. |
| `/admin*` | Admin | Admin only | Separate admin auth; do not include in user read-only workspace. |

## Backend mutation inventory

Important mount finding: `app.js` mounts `/api/job-descriptions` with `requireActiveSubscription` before the route module, so every job-description GET is currently blocked for unpaid users even though route-level GET handlers have no subscription middleware.

| API route | Current classification | Target classification | Notes |
| --- | --- | --- | --- |
| `GET /api/profile/dashboard/kpis` | Read-only safe | Read-only allowed | User-scoped dashboard analytics; ensure no paid-only aggregate is exposed if dashboard is shown. |
| `GET /api/profile/me` | Account | Account/billing allowed | Authenticated profile. |
| `PATCH /api/profile/me` | Account mutation | Account/billing allowed | Not a paid workspace mutation; retain auth validation. |
| `POST /api/profile/change-password` | Account mutation | Account/billing allowed | Retain auth validation. |
| `GET /api/profile/export` | Read-only safe export | Read-only allowed | Best fit for historical data export. |
| `DELETE /api/profile/me` | Account deletion | Account/billing allowed with existing safeguards | Not a paid workspace mutation but high-impact; leave unchanged unless separately scoped. |
| `GET /api/job-descriptions` | Currently blocked by app-level subscription middleware | Read-only allowed | Move app-level paid guard to mutation routes only in future PR. |
| `GET /api/job-descriptions/:id` | Currently blocked by app-level subscription middleware | Read-only allowed | Must remain owner-scoped. |
| `GET /api/job-descriptions/:id/attachment` | Currently blocked by app-level subscription middleware | Read-only allowed if attachment belongs to user | Verify attachment access remains owner-scoped. |
| `POST /api/job-descriptions` | Paid mutation | Paid mutation blocked for read-only | Already guarded by `requireActiveSubscription`; preserve/centralize. |
| `PUT /api/job-descriptions/:id` | Paid mutation | Paid mutation blocked for read-only | Already guarded. |
| `DELETE /api/job-descriptions/:id` | Paid mutation | Paid mutation blocked for read-only | Already guarded. |
| `POST /api/job-descriptions/:id/duplicate` | Paid mutation | Paid mutation blocked for read-only | Creates new job description; already guarded. |
| `POST /api/uploads` | Paid mutation / AI analysis entry | Paid mutation blocked for read-only | Guarded by active subscription and upload quota. Do not touch analysis logic. |
| `POST /api/uploads/chunks/init` | Paid mutation / upload start | Paid mutation blocked for read-only | Guarded by active subscription and quota. |
| `POST /api/uploads/chunks/:uploadId/chunk` | Paid mutation / upload write | Paid mutation blocked for read-only | Guarded. |
| `POST /api/uploads/chunks/:uploadId/complete` | Paid mutation / async queue trigger | Paid mutation blocked for read-only | Guarded and likely queues parsing; do not alter processing. |
| `GET /api/uploads/chunks/:uploadId/status` | Read-only safe | Read-only allowed | Authenticated and user scoped; OK for historical/processing status. |
| `GET /api/uploads/:id/parse-status` | Read-only safe | Read-only allowed | Authenticated status endpoint. |
| `GET /api/analyses` | Read-only safe | Read-only allowed | Authenticated list includes complete/failed/processing/partial state. |
| `GET /api/analyses/:id` | Read-only safe | Read-only allowed | Owner check in loader. |
| `GET /api/analyses/:id/status` | Read-only safe | Read-only allowed | Must preserve processing/partial/failed state rendering. |
| `DELETE /api/analyses/:id` | Unclear/risky mutation | Paid mutation blocked for read-only or disallowed entirely | Currently only `requireAuth`; future guard required before read-only users can access analysis pages broadly. |
| `POST /api/candidates/reanalyse` | Paid mutation / AI analysis | Paid mutation blocked for read-only | Guarded. Do not touch AI scoring/ranking. |
| `GET /api/candidates/profiles` | Read-only safe | Read-only allowed | Authenticated and user scoped. |
| `GET /api/candidates/directory` | Read-only safe | Read-only allowed | Authenticated and user scoped. |
| `POST /api/candidates/match` | Paid mutation / scoring-match action | Paid mutation blocked for read-only | Guarded. Do not change scoring/ranking. |
| `POST /api/candidates/tags/bulk` | Paid/user workspace mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/candidates/tags/lookup` | Read-only-ish lookup | Read-only allowed if no write side effects | Confirm no writes; currently auth-only. |
| `GET /api/candidates/:resumeId/resume` | Read-only safe | Read-only allowed | Must remain owner-scoped file access. |
| `GET /api/candidates/:resumeId` | Read-only safe | Read-only allowed | Must remain owner-scoped. |
| `GET /api/shortlists` | Read-only safe | Read-only allowed | App-level requireAuth applies via mount. |
| `GET /api/shortlists/:id` | Read-only safe | Read-only allowed | Must remain owner-scoped. |
| `POST /api/shortlists` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `PATCH /api/shortlists/:id` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/shortlists/:id/archive` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/shortlists/:id/unarchive` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `DELETE /api/shortlists/:id` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/shortlists/:id/candidates` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/shortlists/:id/candidates/batch` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `DELETE /api/shortlists/:id/candidates/:resumeId` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `POST /api/shortlists/:id/candidates/batch-remove` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `GET /api/reports` | Read-only safe | Read-only allowed | Existing saved report definitions only. |
| `POST /api/reports` | Paid mutation / report generation-definition | Paid mutation blocked for read-only | Guarded. |
| `PUT /api/reports/:id` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `DELETE /api/reports/:id` | Paid mutation | Paid mutation blocked for read-only | Guarded. |
| `GET /api/results` and `GET /api/resumes` | Read-only safe | Read-only allowed | Authenticated persisted results/resumes. |
| `POST /api/results/share` | Unclear/risky mutation | Paid mutation blocked for read-only unless product explicitly allows sharing | Creates a share token; currently auth-only. Needs decision. |
| `GET /api/results/shared/:shareToken` | Public read-only | Public | Existing public shared-token route. |
| `POST /api/results/export/csv` | Currently paid mutation/export | Product decision needed | If “export historical data” includes CSV result export, convert to authenticated read-only export with strict owner scoping; if it performs paid generation, keep blocked. |
| `/api/payments`, `/api/subscriptions`, `/api/paddle/*` | Billing/payment | Account/billing allowed | Do not alter Paddle webhook/payment behavior in read-only workspace PRs. |
| `/api/admin/*` | Admin | Admin only | Out of scope for ordinary user read-only workspace. |

## Subscription-state policy

### Active paid workspace

Users can enter full workspace and perform paid mutations only when one of these is true:

- status is `active`;
- status is `trialing` or `trial`, if product intentionally treats trial access as paid access;
- status indicates scheduled cancellation and a future paid-through/access end date exists.

### Read-only historical workspace

Users can view/export their own historical data but cannot perform paid mutations when authenticated and any of these are true:

- `past_due`;
- `payment_failed`;
- `canceled` or `cancelled` after paid-through/access period ended;
- `inactive` with historical data;
- non-subscribed/free/no-subscription users with historical data;
- trial ended / no longer active.

### Blocked paid mutations

Every state outside active paid workspace must receive a backend 403 for paid workflow actions, including uploads, create analysis, retry/reprocess/reanalyse, queue triggers, job create/edit/delete/duplicate, candidate match/tag mutations, shortlist mutations, and report creation/edit/delete/generation.

Recommended frontend helper names for future PRs:

- `hasActivePaidAccess(state)` remains the full workspace/mutation predicate.
- `canUsePaidMutation(state)` remains equivalent to active paid access.
- Add `isReadOnlyWorkspace(state, { hasHistoricalData })` to identify authenticated non-active users who should see historical routes.
- Add route helpers such as `isReadOnlyWorkspaceRoutePath`, `isPaidMutationRoutePath`, `canAccessRouteForSubscriptionState`, and tests before UI changes.

Recommended backend helper names for future PRs:

- Preserve `requireActiveSubscription` for paid mutations.
- Optionally rename/alias to `requirePaidMutationAccess` for clarity without behavior change.
- Add route-level tests proving all paid mutations return the same clear 403 for read-only states.

## Recommended phased PR sequence

### Phase 1 — Policy helpers and tests only

- Add frontend `isReadOnlyWorkspace` subscription helper.
- Add route policy helpers without changing rendered routes.
- Add backend test fixtures for read-only statuses against existing `canUsePaidMutation`/`hasActivePaidAccess` behavior.
- No UI, API, schema, billing, webhook, AI, or processing behavior changes.

Acceptance criteria:

- Helper tests cover active, trial/trialing, scheduled cancellation with future date, scheduled cancellation after access end, past_due, payment_failed, inactive, canceled/cancelled, and non-subscribed/free statuses.
- No route behavior changes are shipped.
- No AI/resume analysis files or Paddle webhook files are changed.

### Phase 2 — Frontend read-only route access and shell

- Allow read-only users into historical routes: `/dashboard` read-only summary if safe, `/jobs`, `/job-descriptions`, `/analyses`, `/analyses/:id`, `/candidates`, `/candidates/:id`, `/shortlists`, `/reports`, `/results`, `/settings`, `/billing`, and export entry points.
- Keep `/uploader` and `/create-analysis` blocked with a clear upgrade/billing redirect/message.
- Show app/account shell with limited nav for read-only users.
- Add a read-only banner using existing design tokens and app-shell patterns.
- Hide or disable create/upload/analyze/reanalyse/match/tag/report-generation/shortlist mutation actions.
- Avoid relying on frontend gating for security; label this phase incomplete until Phase 3 lands.

Acceptance criteria:

- Read-only users can navigate to historical list/detail routes without redirect loops.
- Create/upload/analyze CTAs are absent or disabled with clear copy.
- Candidate results and analysis detail rendering are unchanged for completed, partial, failed, and processing analyses.
- UI follows `DESIGN_CONSTITUTION.md` app shell, colors, fonts, Lucide icon rules, and footer rules.

### Phase 3 — Backend paid mutation guard hardening

- Move `/api/job-descriptions` app-level subscription guard off the entire router and keep paid guards on POST/PUT/DELETE/duplicate only.
- Add/confirm guard coverage for every paid mutation.
- Add guard to `DELETE /api/analyses/:id` or decide to disallow that endpoint for read-only users.
- Decide and implement policy for `POST /api/results/share` and `POST /api/results/export/csv`.
- Ensure every paid mutation returns a clear 403 with upgrade/billing copy for non-active states.
- Preserve all read-only GET endpoints and owner scoping.

Acceptance criteria:

- Read-only statuses receive 403 for paid mutations across jobs, uploads/chunks, analysis delete/retry/reprocess, candidates reanalyse/match/tags, shortlists, and reports.
- Read-only statuses can call approved GET/export endpoints for their own data.
- Cross-user access tests continue to pass.
- No AI/resume analysis logic, scoring/ranking, async queue behavior, or Paddle webhook/payment behavior changes.

### Phase 4 — UI polish under the Design Constitution

- Refine read-only banner, empty states, nav labels, locked-action copy, and billing/upgrade CTA copy.
- Ensure shell state, sidebar pin behavior, footer, fonts, colors, spacing, and Lucide icons match the constitution.
- Add accessible messaging for disabled actions.

Acceptance criteria:

- Product copy distinguishes past_due/payment_failed from canceled/inactive without confusing users.
- Empty states explain that historical data remains available and paid actions require active access.
- Screenshots are captured for any perceptible web-app UI changes.

### Phase 5 — Regression tests and rollout checks

- Add frontend route-guard tests for active, scheduled-cancel, and read-only states.
- Add page-level tests for hidden/disabled mutation controls.
- Add backend route tests for 403 paid mutation enforcement and allowed GET/export behavior.
- Run build and targeted test suites.
- Consider a feature flag for read-only workspace access rollout.

Acceptance criteria:

- Route inventory and backend mutation inventory are reflected in automated tests.
- No regression in active paid user workspace access.
- No regression in historical analysis detail/candidate rendering.
- Rollback can disable read-only route access without changing data/schema.

## Tests needed

Frontend:

- `subscriptionState` tests for read-only helper and scheduled cancellation edge cases.
- `routeGuards` / route policy tests for each route class.
- `App` route access tests:
  - active users enter all paid routes;
  - scheduled-cancellation users with future paid-through retain full access;
  - read-only users can enter historical routes;
  - read-only users cannot enter `/uploader` or `/create-analysis`;
  - unauthenticated users still get auth prompts;
  - no redirect loops for `/account/*` aliases.
- Page tests proving create/upload/analyze/reanalyse/match/tag/shortlist/report mutation controls are hidden/disabled in read-only mode.
- Existing candidate results, analysis detail, scoring display, and normalization tests must continue passing.

Backend:

- Middleware tests for active, trial/trialing, future scheduled cancellation, expired cancellation, past_due, payment_failed, inactive, canceled/cancelled, and free/no-subscription.
- Route tests proving allowed read-only GET/export endpoints return own-user data and reject cross-user data.
- Route tests proving paid mutations return 403 for non-active states:
  - job create/edit/delete/duplicate;
  - upload and upload chunk init/chunk/complete;
  - analysis delete/retry/reprocess if present;
  - candidate reanalyse/match/tags;
  - shortlist create/update/archive/unarchive/delete/add/remove/batch actions;
  - report create/update/delete/generation;
  - share/export endpoints once product policy is finalized.
- Regression tests for active paid users still performing paid mutations.
- Existing Paddle webhook/payment tests unchanged and passing.

## Risks and mitigations

- Accidentally enabling AI analysis for unpaid users: keep `/uploader`, `/create-analysis`, upload/chunk complete, candidate reanalyse, and match routes behind backend paid guards.
- Blocking active paid users: preserve `hasActivePaidAccess` semantics and test active/trial/scheduled-cancel future-date states.
- Blocking scheduled-cancellation users who still have paid access: always check future paid-through/access end date.
- Breaking completed/partial/failed/processing analyses: keep analysis GET/status payloads unchanged and run existing analysis rendering tests.
- Exposing cross-user data: require owner-scoped SQL/tests on every GET/export route.
- Frontend-only gating: Phase 3 backend guard hardening is mandatory before considering feature complete.
- Redirect loops: centralize route policy and test `/account/*`, `/pricing`, `/billing`, historical routes, and blocked paid actions.
- Confusing past-due/canceled copy: tailor banner/403 copy by subscription state.
- Job description GET blockage: app-level `/api/job-descriptions` subscription guard must be refactored carefully so only mutations are guarded.
- Export ambiguity: settle product policy for results CSV/share-token creation before implementation.

## Rollback plan

- Keep changes phased and feature-flag frontend read-only route exposure if possible.
- If issues appear after Phase 2, disable read-only route exposure and revert to current pricing redirects while preserving helper tests.
- If Phase 3 guard issues appear, revert route-mount changes and keep `requireActiveSubscription` on risky routers, then re-open only audited GET endpoints one route at a time.
- No database schema changes are proposed, so rollback is code-only.
- No AI/resume analysis or Paddle webhook changes are proposed, reducing rollback blast radius.
