# Resume analysis quota contract

## Scope

HireFlow paid subscriptions include 800 resume analyses in each monthly quota
period. This allowance is monthly for both monthly and annual subscriptions; an
annual subscription does not receive 9,600 units up front.

The quota foundation introduced a stable billing anchor, an atomic reservation
ledger, and provider-start accounting in phases. PR 9 makes that ledger
authoritative whenever Paddle billing is configured; a false or missing local
rollout flag cannot return a Paddle-backed runtime to the legacy
read-then-write path.

Classic multipart uploads reserve their full batch in one transaction. Chunked
uploads call a batch preflight endpoint before any session is initialized and
allocate one reserved unit per new session. Reserved files receive idempotent
allocation records, and usage is consumed immediately before the first
external AI-provider attempt.

## Period contract

- Quota periods use UTC timestamps with an inclusive start and exclusive end.
- The stable `users.quota_anchor_at` timestamp is normally set once from a
  provider-backed paid billing-period boundary. The sole recovery exception is
  a verified overdue recurring renewal after a read-only Past Due period: once
  Paddle confirms the adjusted billing date, the anchor moves exactly once to
  that transaction's authoritative captured-payment timestamp.
- Each monthly boundary is derived from that original anchor.
- Anchors on the 29th, 30th, or 31st clamp to the last day of shorter months and
  return to the original day when a later month supports it.
- Monthly and annual plans use the same monthly anniversary calculation.
- Trial and free allowances continue to use UTC calendar months.
- An active legacy user can be backfilled from a known `current_period_end`
  boundary. Other paid users without a valid anchor continue to use UTC calendar
  months until trustworthy billing data is available.
- A legacy period end that lands on the last day of a short month is ambiguous:
  it cannot prove whether the original anniversary was the 28th, 29th, 30th, or
  31st. Those backfilled anchors are cleared and remain on the safe calendar
  fallback until a provider-backed period start is observed.
- Trial events never establish the paid quota anchor.

### Subscription lifecycle rules

| Event | Quota period effect |
|---|---|
| Monthly renewal | Continue anniversary-based monthly periods |
| Annual renewal | Continue anniversary-based monthly periods |
| Monthly to annual switch | No reset and no anchor change |
| Annual to monthly switch | No reset and no anchor change |
| Scheduled cancellation | Paid access and the existing period continue until entitlement ends |
| Payment failure | Read-only access; no reset while payment remains unpaid |
| Verified Past Due recurring-payment recovery | After Paddle confirms the adjusted billing date, start one new monthly period at `payments[].captured_at`; duplicate events do not move it again |
| Reactivation/resubscription for the same user | Reuse the stable anchor; do not grant an extra immediate reset |
| Missing or invalid anchor | Use UTC calendar-month fallback |

## Counting contract

The target accounting contract for the reservation and enforcement phases is:

- One unit represents one resume/JD analysis item that requires new
  provider-backed AI work.
- A no-job resume analysis still counts when it starts new provider-backed AI
  work.
- A bulk upload requests one unit per resume analysis item.
- The full bulk amount must be reserved atomically before any item starts.
- Local validation, malware scanning, unsupported/corrupt-file rejection, and
  local extraction failures before an AI provider request release the
  reservation and do not consume a unit.
- The first AI provider request for the item converts its reservation to one
  consumed unit.
- Retries, provider fallbacks, webhook replays, and worker restarts for the same
  analysis item do not consume additional units.
- A cache hit for the same resume and job that avoids all new provider work does
  not consume a unit.
- Failed provider work remains one consumed unit once provider-backed processing
  has started.
- Admin overrides remain supported and must be auditable.

The legacy path continues to record accepted uploads before scanning, but it is
limited to isolated non-Paddle local/test runtimes. Paddle-configured Sandbox
and Production runtimes cannot select that fallback.

### Customer-facing availability contract

`GET /api/usage/resume-analysis` keeps `used`, `remaining`, and
`percentageUsed` consumption-based for backward compatibility. In particular,
`used` counts `usage_log` rows and `remaining` is `limit - used`; neither field
includes active capacity reservations that have not reached provider start.

The additive `available` field is the amount that atomic enforcement can accept
now: `max(limit - used - active reserved, 0)`. `canCreateAnalysis` is the
authoritative server decision for whether at least one new resume may be
submitted. It is true only when `canUsePaidMutation(user) && available > 0`,
so past-due, expired, inactive, and other read-only users are not advertised as
able to submit even when unused quota capacity remains. When reservation
enforcement is disabled, there is no active reservation capacity to subtract and
`available` equals `remaining`.

Customer UI must use `available` and `canCreateAnalysis` for submission guidance,
while it may use `used`, `percentageUsed`, and `warningLevel` to describe actual
consumption. Active reservations must not be described as completed or analyzed
resumes. On the reservation-enabled path, consumed usage, active reservations,
and the next availability transition are read in one database snapshot so a
provider-start conversion cannot disappear between counters.

The additive `nextRevalidationAt` field is the nearest server-known time when
availability may change: the earlier of the current `periodEnd` and an active
reservation expiry that can release unallocated capacity. The shared frontend
quota store schedules one refresh just after that boundary. Because provider
completion and explicit releases do not have a predictable transition time, the
store also performs one deduplicated five-minute refresh while at least one
consumer is mounted and the document is visible. Focus, reconnect, and returning
to a visible tab refresh immediately; the timer is removed when the last consumer
unmounts. Shared stores and in-flight requests are scoped to the current auth
token, and the previous identity's store is discarded when its final consumer
unmounts. This revalidation changes no reservation or accounting semantics.

## Atomic reservation behavior

- Paddle-configured runtimes always use atomic reservations. Isolated non-Paddle
  local/test runtimes may opt in with `RESUME_QUOTA_RESERVATIONS_ENABLED=true`.
- Availability is serialized per user with a PostgreSQL transaction advisory
  lock.
- `used + unexpired reserved + requested` must be less than or equal to the
  applicable limit.
- A caller-provided idempotency key returns the original reservation and cannot
  reserve the same batch twice.
- The client retains that key across an unknown preflight outcome, so a lost
  response can recover the original reservation instead of allocating another.
  Both analysis-submission flows retire it only after sessions are definitively
  initialized or an unused reservation release succeeds; a later intentional
  rerun then gets a fresh key.
- Reservations expire after two hours if a client abandons an upload.
- Clients explicitly release every unused unit when initial session creation
  fails; successful sibling sessions continue instead of being abandoned.
- Each file receives a stable identity within its logical batch. This keeps
  same-named, same-sized files in distinct sessions while making a lost init
  response safely resumable.
- A new upload session allocates one reserved unit without writing `usage_log`.
  Retrying that session with the same reservation is a no-op, while a retry
  carrying a different reservation releases only the newly supplied unit.
- If quota allocation fails after the upload session is created, its reserved
  unit remains attached so the stable file identity can retry idempotently.
- While an isolated non-Paddle runtime leaves the local flag off, the current
  calendar-month limit and pre-provider counting semantics remain authoritative.

## Provider-start behavior

- The local/test flag cannot disable provider-start accounting in a
  Paddle-configured runtime.
- Paid monthly and annual users with a trustworthy billing anchor are enforced
  against monthly anniversary periods. Trials and legacy accounts without an
  anchor retain the UTC calendar fallback.
- Each accepted file has one durable allocation shared by worker retries and
  provider fallbacks.
- The reachable candidate reanalysis API reserves its complete provider-backed
  batch and allocates/consumes one unit per stored resume before its first AI
  provider attempt.
- Validation, malware scanning, abandoned upload sessions, enqueue failures,
  invalid job-description references, analysis deletion/cancellation, and
  terminal local extraction failures release an unconsumed allocation.
- The provider orchestration hook consumes the allocation once, immediately
  before its first external provider adapter call.
- Provider fallback, token-budget retries, queue retries, and worker restarts
  reuse the consumed allocation and cannot write a second usage row.
- Once the provider-start transaction commits, a later provider or persistence
  failure remains one consumed unit.
- The usage API reads the same period and ledger-backed count as enforcement
  whenever the rollout flag is enabled.
- Allocation-backed usage is assigned to the exact timestamp-precise period on
  its durable reservation, so a recovery later on the same UTC date starts a
  fresh period without rewriting pre-recovery usage or allocations. If an
  existing reservation is consumed after the new recovery boundary but before
  local confirmation, its precise provider-start usage time counts in the new
  period. The recovery commit shares the reservation ledger's per-user lock,
  and outstanding allocations from older reservation periods reserve capacity
  in the new period without changing their identities.
- If an isolated non-Paddle runtime turns its local flag off mid-period,
  calendar-month enforcement still includes allocation-backed usage written
  during the atomic rollout.

## PR 1 shadow-mode behavior

- Existing calendar-month checks remain the only checks that allow or reject an
  upload.
- For paid users with a billing anchor, the backend also counts usage by
  `usage_log.created_at` inside the proposed anniversary period.
- A structured log compares legacy and proposed counts and records whether the
  decisions would differ.
- Shadow query failures are logged and never block an upload.
- Set `RESUME_QUOTA_BILLING_PERIOD_SHADOW_MODE=false` to disable comparison
  immediately without reverting the migration or period resolver.
- `RESUME_QUOTA_RESERVATIONS_ENABLED=false` bypasses the reservation ledger only
  in isolated non-Paddle local/test runtimes. It is ignored once any Paddle
  environment is configured.

## Rollback

The migration is additive. Rolling back application code leaves
`users.quota_anchor_at` unused and does not change existing calendar-month
enforcement. The column should be retained for forward compatibility rather than
dropped during an emergency rollback.
