# HireFlow Launch Smoke-Test Checklist

Use this checklist before controlled beta, early customer launch, preview promotion, or production release. It is intended for manual verification only and must not require product behavior changes.

## How to use this checklist

For every item, record:

- **Status:** Pass, Fail, or Not applicable.
- **Environment tested:** Local, Preview, or Production.
- **Notes:** Include user, browser, device, data setup, observed behavior, and next action.
- **Evidence:** Link screenshots, screen recordings, logs, Vercel deployment URLs, Paddle events, email messages, or backend traces when needed.

Recommended evidence for launch sign-off:

- One desktop screenshot for the public landing page, dashboard, job list, analysis result, candidates page, shortlist page, settings/account page, pricing checkout entry, checkout success, and checkout cancel.
- One mobile screenshot for the public landing page and pricing page.
- One backend health-check result.
- One queue/worker status confirmation.
- One webhook delivery confirmation from Paddle.
- One email delivery confirmation for signup verification and password reset when those flows are enabled.

## Required test accounts

| Account | Purpose | Required setup | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| New unsubscribed user | Signup, onboarding, non-subscribed restrictions, empty states | Email inbox accessible; no active subscription | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Existing unsubscribed user | Login, protected routes, persisted non-subscribed behavior | Known valid password; no active subscription | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Subscribed user | Billing access, subscribed behavior, dashboard with real data | Active subscription in target environment | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| User with completed analyses | Results rendering, old analysis compatibility, candidates, shortlists | At least one completed analysis with job selected | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| User with no data | Empty states for dashboard, reports, candidates, shortlists, jobs | No jobs, analyses, candidates, or shortlists | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Admin/operator access, if available | Production checks, logs, webhook events, workers, health checks | Access to provider dashboards and logs | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## Required test files

Store test files outside the repository unless they are already approved fixtures. Do not use real candidate personal data for smoke testing.

| File | Purpose | Required characteristics | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Sample resume PDF | PDF upload and analysis creation | Small valid PDF with synthetic candidate data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Sample resume DOCX | DOCX upload and analysis creation | Valid DOCX with synthetic candidate data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Sample resume DOC | DOC upload and analysis creation | Valid legacy DOC with synthetic candidate data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Sample resume TXT | TXT upload and analysis creation | Plain-text synthetic candidate data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Unsupported file | Rejection behavior | Example: PNG, ZIP, or executable-style file not supported by product | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Oversized file | File size limit behavior | Larger than configured upload limit; synthetic data only | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Multi-file batch | Multiple upload behavior | Mix of supported resume files with synthetic data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## Required environment variables and external services to confirm

Confirm names against the active deployment configuration. Do not paste secret values into this checklist; record only whether each variable or service is present and appears to point to the intended environment.

| Variable or service | Purpose | Expected confirmation | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Frontend public app URL | Canonical production/preview routing | URL matches target environment | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Backend/API base URL | API calls from the app | URL matches target backend and CORS origin | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `VITE_DEMO_VIDEO_URL` | Demo video CTA behavior | Set for environments where demo video should open; unset where fallback behavior is expected | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Auth/session secrets and URLs | Signup, login, logout, reset password, protected routes | Present and configured for target domain | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Email provider configuration | Verification and reset emails | Provider active; sender/domain verified; test email delivered | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Database connection | Persistent app data | Points to correct environment; migrations applied | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Redis/queue configuration | Async resume processing | Queue reachable; workers online | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| AI provider configuration | Resume analysis execution | Present for target environment; no secrets exposed in logs | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| File storage configuration | Resume upload storage | Correct bucket/container and access policy | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Paddle environment mode | Checkout and billing | Sandbox or production mode matches release intent | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Paddle client/vendor/product/price IDs | Checkout and subscription status | IDs match target Paddle environment | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Paddle webhook secret and endpoint | Subscription updates | Endpoint configured; recent test delivery succeeds | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Observability/logging | Launch diagnostics | Logs available without exposing sensitive data | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 1. Public site

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| `/` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/pricing` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/about` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/contact` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/help` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/privacy` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/terms` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/refund-policy` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| `/ai-disclosure` loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Direct browser refresh works on each public route above. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Mobile viewport check passes on key public pages. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Landing CTAs navigate to the expected signup, pricing, contact, or demo flow. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Demo video CTA opens or plays expected demo behavior when `VITE_DEMO_VIDEO_URL` is set. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Demo video CTA has acceptable fallback behavior when `VITE_DEMO_VIDEO_URL` is not set. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 2. Auth

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Signup creates a new account with the expected confirmation or onboarding state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Email verification flow works if enabled and testable in the target environment. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Login succeeds for a valid test user. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Logout clears the session and returns the user to the expected public or auth page. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Forgot password sends a reset email or shows the expected safe response. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Reset password completes successfully with a valid reset token. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Invalid credentials show a safe error and do not log in the user. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Expired or invalid reset token shows a safe error and does not reset the password. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Protected route access while logged out redirects to the expected login or signup flow. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 3. Subscription / billing

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Pricing CTA starts the expected subscription or checkout flow. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Paddle checkout works in sandbox or production test mode as appropriate for the environment. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Checkout success route loads and shows the expected post-purchase state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Checkout cancel route loads and shows the expected cancellation state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Billing page access works for the appropriate account type. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Payment method update flow opens and completes or safely cancels. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Subscription status display matches Paddle/backend subscription state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Webhook processing updates the user subscription state after a test event. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Subscribed user behavior is enabled where expected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Non-subscribed user behavior is restricted or messaged where expected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 4. Jobs / job descriptions

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Create job succeeds with valid required fields. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Edit job persists changes after save and refresh. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Delete job removes or archives the job as designed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Required field validation prevents incomplete job submission. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Skills handling supports add, edit, remove, and display of skills. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Experience min/max handling accepts valid ranges and rejects invalid ranges. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Job status handling displays and persists the expected status. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Direct browser refresh works on job list, create, edit, and detail routes. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 5. Resume upload / analysis creation

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Create analysis succeeds with a selected job. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Upload PDF succeeds and creates or queues analysis. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Upload DOCX succeeds and creates or queues analysis. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Upload DOC succeeds and creates or queues analysis. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Upload TXT succeeds and creates or queues analysis. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Unsupported file is rejected with safe, understandable messaging. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| File size limit behavior rejects oversized files safely. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Multiple file upload succeeds or safely reports per-file issues. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Empty or no-job analysis behavior matches supported product behavior. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Modal close/loading behavior prevents duplicate submission and recovers cleanly. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 6. Async analysis processing

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Analysis moves from processing to complete without manual intervention. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Partial failure behavior is clear when one file in a batch fails. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Failed file behavior is clear and does not block successful files. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Retry or recovery behavior works if available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Page refresh while processing preserves state and shows current progress. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Old completed analysis still renders correctly. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 7. Analysis results

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Ranking is visible when a job is selected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| No-ranking message appears when no job is selected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Candidate score is displayed and appears consistent with the result. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Match status is displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Summary is displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| AI reasoning is displayed where expected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Strengths are displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Gaps or considerations are displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Top skills are displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Recent experience is displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| JD matches are displayed when available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Missing requirements are displayed when available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Resume filename is displayed. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Score breakdown is displayed where available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Long text truncation or tooltips remain readable and accessible. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Direct browser refresh works on result routes. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 8. Candidates

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Candidates page loads real data for a user with analyzed candidates. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Candidate detail opens and shows expected candidate information. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Filters and search work if present. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Add to shortlist works from candidate surfaces where available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Schedule interview CTA behavior is correct if present. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Empty state is clear for users with no candidates. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Error state is clear and distinguishable from empty state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 9. Shortlists

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Create shortlist succeeds. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Add candidate to shortlist succeeds. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Remove candidate from shortlist succeeds. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| View shortlist shows the expected candidates. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Empty state is clear for no shortlists or empty shortlist. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Direct browser refresh works on shortlist routes. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Delete behavior works if present and confirms destructive action as expected. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 10. Dashboard / reports

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Dashboard loads real data for an account with activity. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Dashboard shows the correct empty state for an account with no data. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Empty state is distinguishable from API failure. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Reports route loads without client or server error. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Export CSV works if available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Direct browser refresh works on dashboard and reports routes. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 11. Settings / account

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Account page access works for a logged-in user. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Settings update works if available. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Billing/account access works for subscribed user. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Billing/account restriction works for non-subscribed user. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Logout or session expiry behavior returns user to expected safe state. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## 12. Production safety

| Checklist item | Status | Environment tested | Notes | Evidence |
| --- | --- | --- | --- | --- |
| No fake metrics appear on public or authenticated launch-critical surfaces. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| No fake team or customer claims appear on launch-critical surfaces. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| No mock-only copy appears in user-facing production surfaces. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| No raw browser styling appears in touched or launch-critical surfaces. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Browser console logs do not expose tokens, emails, resume text, or other sensitive data. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| CORS works on the production domain. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Vercel direct refresh works for public and authenticated SPA routes. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Backend health check works. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Redis and queue workers are running. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Database migrations are applied. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Paddle webhook endpoint is configured and receives events. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |
| Email provider is configured and sends required launch emails. | [ ] Pass [ ] Fail [ ] N/A | [ ] Local [ ] Preview [ ] Production |  |  |

## Go/no-go criteria

Launch is **Go** only when all of the following are true:

- No open blocker remains in the blockers section below.
- All production-critical public routes load and survive direct refresh.
- Signup, login, logout, forgot password, and reset password are either passing or explicitly not applicable with owner approval.
- Billing checkout, checkout success, checkout cancel, subscription status, and webhook processing are passing in the intended Paddle mode.
- At least one supported resume upload creates an analysis that reaches complete status.
- Existing completed analyses render after refresh.
- Dashboard, candidates, shortlists, jobs, reports, settings, and billing pages show either real data or the correct empty/restricted state.
- No sensitive data appears in browser console output or application logs reviewed during testing.
- Backend health, database, Redis/queue workers, email provider, and Paddle webhook configuration are confirmed for the target environment.
- Any failed non-critical item has an owner, mitigation, and explicit launch approval.

Launch is **No-go** if any of the following are true:

- Users cannot sign up, log in, or access protected routes correctly.
- Payment or subscription state is incorrect for the target environment.
- Resume upload or async processing is broadly unavailable.
- Analysis results fail to render for completed analyses.
- Production routes fail direct refresh.
- Sensitive user, auth, billing, or resume data is exposed in logs or the browser console.
- A production dependency is missing or pointed at the wrong environment.

## Rollback notes

| Rollback item | Owner | Trigger | Rollback action | Status | Notes | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Frontend deployment |  | Public or authenticated route regression | Promote previous known-good deployment or revert release commit | [ ] Ready [ ] Not ready [ ] N/A |  |  |
| Backend deployment |  | API, auth, billing, upload, or processing regression | Restore previous known-good deployment | [ ] Ready [ ] Not ready [ ] N/A |  |  |
| Worker deployment |  | Queue processing stalls or fails broadly | Restore previous worker deployment and drain or retry queue as designed | [ ] Ready [ ] Not ready [ ] N/A |  |  |
| Database migration |  | Migration-related production issue | Follow approved database rollback or forward-fix plan | [ ] Ready [ ] Not ready [ ] N/A |  |  |
| Paddle configuration |  | Checkout, webhook, or subscription state issue | Disable affected launch CTA or restore prior Paddle configuration | [ ] Ready [ ] Not ready [ ] N/A |  |  |
| Email provider configuration |  | Verification or reset email delivery failure | Restore prior provider settings or switch to approved backup sender | [ ] Ready [ ] Not ready [ ] N/A |  |  |

## Blockers found

| ID | Severity | Area | Description | Owner | Environment | Evidence | Mitigation or decision | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | Blocker / High / Medium / Low |  |  |  | Local / Preview / Production |  |  | Open / Mitigated / Closed |
|  | Blocker / High / Medium / Low |  |  |  | Local / Preview / Production |  |  | Open / Mitigated / Closed |
|  | Blocker / High / Medium / Low |  |  |  | Local / Preview / Production |  |  | Open / Mitigated / Closed |
