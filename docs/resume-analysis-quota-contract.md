# Resume analysis quota contract

## Scope

HireFlow paid subscriptions include 800 resume analyses in each monthly quota
period. This allowance is monthly for both monthly and annual subscriptions; an
annual subscription does not receive 9,600 units up front.

PR 1 introduces the billing-period contract, a stable anchor, and shadow
comparison only. Calendar-month enforcement remains authoritative until the
reservation and accounting phases are implemented and verified.

PR 2 adds an atomic reservation ledger behind
`RESUME_QUOTA_RESERVATIONS_ENABLED=false` by default. When enabled for
controlled verification, classic multipart uploads reserve their full batch in
one transaction. Chunked uploads call a batch preflight endpoint before any
session is initialized and allocate one reserved unit per new session.

PR 3 completes provider-start accounting behind that same disabled-by-default
flag. On the flagged path, billing-anniversary periods are authoritative,
reserved files receive idempotent allocation records, and usage is consumed
immediately before the first external AI-provider attempt.

## Period contract

- Quota periods use UTC timestamps with an inclusive start and exclusive end.
- The stable `users.quota_anchor_at` timestamp is set once from a provider-backed
  paid billing-period boundary and is not moved by renewal, plan changes,
  scheduled cancellation, payment recovery, or reactivation.
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
| Payment failure/recovery | No reset and no anchor change |
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

The legacy path continues to record accepted uploads before scanning. It remains
the immediate rollback path while `RESUME_QUOTA_RESERVATIONS_ENABLED=false`.

## PR 2 reservation behavior

- Reservation rollout is disabled by default.
- Availability is serialized per user with a PostgreSQL transaction advisory
  lock.
- `used + unexpired reserved + requested` must be less than or equal to the
  applicable limit.
- A caller-provided idempotency key returns the original reservation and cannot
  reserve the same batch twice.
- The client retains that key across an unknown preflight outcome, so a lost
  response can recover the original reservation instead of allocating another.
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
- While the rollout flag is off, the current calendar-month limit and
  pre-provider counting semantics remain authoritative.

## PR 3 provider-start behavior

- The rollout remains disabled by default and uses
  `RESUME_QUOTA_RESERVATIONS_ENABLED` as the kill switch.
- Paid monthly and annual users with a trustworthy billing anchor are enforced
  against monthly anniversary periods. Trials and legacy accounts without an
  anchor retain the UTC calendar fallback.
- Each accepted file has one durable allocation shared by worker retries and
  provider fallbacks.
- Validation, malware scanning, abandoned upload sessions, enqueue failures,
  analysis cancellation, and terminal local extraction failures release an
  unconsumed allocation.
- The provider orchestration hook consumes the allocation once, immediately
  before its first external provider adapter call.
- Provider fallback, token-budget retries, queue retries, and worker restarts
  reuse the consumed allocation and cannot write a second usage row.
- Once the provider-start transaction commits, a later provider or persistence
  failure remains one consumed unit.
- The usage API reads the same period and ledger-backed count as enforcement
  whenever the rollout flag is enabled.

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
- Set `RESUME_QUOTA_RESERVATIONS_ENABLED=false` to bypass the reservation
  ledger and return immediately to the legacy quota path.

## Rollback

The migration is additive. Rolling back application code leaves
`users.quota_anchor_at` unused and does not change existing calendar-month
enforcement. The column should be retained for forward compatibility rather than
dropped during an emergency rollback.
