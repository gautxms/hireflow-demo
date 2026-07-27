# Past Due recovery billing-date policy

## Confirmed RCA and policy

Paddle recovery normally restores the existing subscription while retaining its
old renewal date. HireFlow already makes Past Due workspaces read-only and PR
#1203 restores the same lifecycle to Active from verified checkout, webhook, and
`/subscriptions/current` reconciliation paths. Those paths copy Paddle's
`current_billing_period.ends_at` and `next_billed_at`, resolve the matching
`payment_attempts` record, and preserve `quota_anchor_at`.

Changing only HireFlow's projected dates would be incorrect because Paddle
would still bill on its old date. Changing Paddle without the quota anchor would
also make paid access and the monthly 800-resume period disagree. The policy is
therefore: for the exact locally recorded failed recurring-renewal transaction,
after Paddle reports that transaction completed with a captured payment and the
same subscription Active, extend that subscription without billing and only
then atomically persist the provider-confirmed date and capture-time quota
anchor. PR #1203's Active restoration remains independent and continues when
this feature is disabled or retrying.

| State | Access | Adjustment |
|---|---|---|
| Past Due / payment failed | Paid mutations read-only | None |
| Payment captured, subscription not Active | Remains governed by lifecycle reconciliation | Fail closed / retry |
| Payment captured, same subscription Active | Active | Durable adjustment pending |
| Paddle date verified | Active | Local dates and quota anchor committed |
| Near-renewal lockout | Active | Manual support required; customer must not pay again |
| New cancellation, failure, plan, or lifecycle | Authoritative newer state wins | Superseded |

## Eligibility and timestamp

The candidate is never discovered by a broad provider search. It must be the
exact transaction ID in a local succeeded payment-attempt record that previously
recorded the failed recovery. Paddle is queried directly for that ID. It must be
`origin=subscription_recurring`, `status=completed`, non-zero, and match the
user's environment, customer, subscription, active lifecycle, and configured
plan. Initial checkout, resubscription, trial, plan-change, one-time, zero-value,
scheduled-change, mismatched, cancelled, and still-Past-Due records fail closed.

The authoritative timestamp is the latest valid captured attempt in
`payments[]`, ordered by `captured_at` descending and then payment ID descending
for a deterministic tie. Browser/server/billing-period/billed/created times are
not substitutes.

## Date update and idempotency

UTC calendar arithmetic adds one month for Monthly or one year for Annual,
clamping month ends and leap days. An equal or later Paddle date is verified as
already satisfied and never shortened. Otherwise HireFlow sends only:

```json
{"next_billed_at":"<target>","proration_billing_mode":"do_not_bill"}
```

No items are sent. A SHA-256 idempotency key derived from the durable adjustment
ID is stable across retries. The worker GETs before PATCH, GETs afterward, and
does not confirm from the PATCH response. It creates no transaction, invoice,
charge, credit, trial, subscription, or payment retry. A 30-minute billing-date
rejection becomes `manual_required`; support must inspect the imminent/created
renewal and correct any duplicate accounting before changing a date. Other
unknown outcomes retry after a provider GET.

## Durability, migration, rollout, and rollback

Migration 049 additively creates `recovery_billing_adjustments`, with
timezone-aware timestamps, safe status/error fields, a due-work index, and a
unique `(paddle_environment, recovery_transaction_id)` identity. The existing
recovery webhook and GET reconciliation paths immediately process the exact
locally recorded recovery transaction. The existing 15-minute payment scheduler
remains the durable retry/resume path after provider failures or restarts.
Concurrent discovery is harmless through the unique key; local confirmation
uses provider-event and billing-projection compare-and-set guards.

`PADDLE_PAST_DUE_RECOVERY_BILLING_ADJUSTMENT_ENVIRONMENTS` is empty by default.
Deploy disabled, set it to `sandbox`, verify the previously recovered account
and a fresh recovery, confirm exactly one payment and Paddle's adjusted date,
then confirm the monthly quota boundary matches capture time. Only then set
`sandbox,production`. Disabling the flag stops discovery/PATCH while retaining
PR #1203 recovery and all audit rows. Rollback never reverses confirmed Paddle
dates and never modifies payments, invoices, or transactions.

Sandbox verification must confirm 23 July failure / 27 July capture becomes 27
August in Paddle and HireFlow, with the same customer, subscription, plan, and
one recovered payment. Refresh twice to prove idempotency. Remaining operational
risk is Paddle's near-renewal restriction or an already-created following
renewal; these require accounting review rather than automatic mutation.
