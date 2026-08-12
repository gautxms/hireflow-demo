# Paddle payment operational readiness

Use this runbook when Paddle and HireFlow disagree about a customer's subscription, payment, cancellation, or entitlement state. It uses the existing protected reconciliation paths; it does not authorize charges, refunds, ownership reassignment, or direct financial-state edits.

## Evidence sources

| Question | Safe evidence |
| --- | --- |
| Which account is affected? | HireFlow user ID, Paddle environment, customer ID, and subscription ID in Admin Subscriptions or the `users` row |
| Which webhook was involved? | `[Paddle webhook]` logs and `paddle_webhook_events.event_id` / `event_type` |
| Did webhook persistence or processing fail? | Inbox `status`, `attempt_count`, `scheduler_attempt_count`, `last_error_code`, and `next_retry_at` |
| What did Paddle report? | The linked subscription in the matching Paddle environment; compare status, items/plan, billing period, next billing date, scheduled change, customer ID, and `updated_at` |
| What did HireFlow apply? | Structured lifecycle, payment, and reconciliation logs plus `users` and `subscriptions` projections |
| Was a payment failure or recovery recorded? | Paddle transaction ID and the matching `payment_attempts` row |
| Did reconciliation repair the mismatch? | `[Paddle subscription reconciliation]` result, then the operational and projection checks below |

Application logs use provider IDs rather than email, card, or customer-name data. Do not paste API keys, webhook secrets, authorization headers, checkout URLs, card data, or raw Paddle payloads into logs or support notes.

## Triage

1. Identify the HireFlow user ID through the existing Admin Subscriptions view.
2. Record the user's configured `paddle_environment`, `paddle_customer_id`, and `paddle_subscription_id`. Production and Sandbox must be investigated separately.
3. Search Railway application logs using the user ID, subscription ID, transaction ID, or event ID. Relevant patterns are listed below.
4. Inspect the authoritative subscription in the matching Paddle environment. Verify that its customer ID and subscription ID match HireFlow before considering reconciliation.
5. Compare Paddle and HireFlow:
   - normalized subscription status and plan;
   - current billing-period end and next billing date;
   - scheduled cancellation and effective date;
   - `users.last_paddle_event_at` versus Paddle `updated_at`;
   - the `subscriptions` projection's status and latest event type;
   - the relevant inbox or payment-attempt record.
6. If IDs or environments conflict, stop. Treat this as an ownership investigation, not a state-repair request.

Read-only database inspection may use the following shapes with explicit, validated identifiers:

```sql
SELECT id, subscription_status, subscription_plan, current_period_end,
       next_billing_date, cancellation_effective_at, paddle_environment,
       paddle_customer_id, paddle_subscription_id, last_paddle_event_at,
       last_paddle_reconciliation_attempt_at, last_paddle_reconciled_at
FROM users
WHERE id = $1;

SELECT user_id, status, latest_event_type, paddle_environment, updated_at
FROM subscriptions
WHERE paddle_environment = $1 AND paddle_subscription_id = $2;

SELECT event_id, event_type, paddle_environment, status, attempt_count,
       scheduler_attempt_count, last_error_code, next_retry_at, processed_at
FROM paddle_webhook_events
WHERE event_id = $1;

SELECT transaction_id, user_id, paddle_environment, status, retry_count,
       last_error, updated_at
FROM payment_attempts
WHERE transaction_id = $1;
```

Do not include payload columns in routine support exports.

## Safe reconciliation procedure

1. Confirm the account, environment, customer ID, and subscription ID as described above.
2. Fetch or inspect that exact Paddle subscription in the same environment. Do not substitute another ID to make the records match.
3. Confirm Paddle ownership, status, plan, billing dates, scheduled cancellation, and `updated_at` are internally consistent.
4. Use an existing protected path:
   - Preferred normal path: the automatic reconciliation worker runs every 15 minutes, processes a bounded batch, and retries a failed provider read after 15 minutes. Observe the next candidate result in Railway logs.
   - Safe on-demand path: have the affected signed-in user open or refresh HireFlow Billing. `GET /api/subscriptions/current` fetches the linked provider subscription and invokes the same ownership-, environment-, plan-, freshness-, and compare-and-set-protected reconciliation service.
5. Confirm a reconciliation result of `updated` or `already_current`. A rejection such as `customer_ownership_mismatch`, `subscription_ownership_mismatch`, `environment_mismatch`, `plan_mismatch`, `stale_provider_snapshot`, or `concurrent_state_change` must be investigated; do not bypass it.
6. Re-read the `users` operational entitlement and the `subscriptions` projection. Confirm status, plan, dates, cancellation, environment, and provider IDs agree with Paddle.
7. Confirm the authenticated subscription/entitlement API reports the expected write access or read-only state.
8. Confirm jobs, analyses, shortlists, candidates, and completed or in-progress analysis history remain present. Reconciliation must not delete or recreate historical product data.
9. Record the event/subscription/transaction IDs, reconciliation result, and verified final state in the existing operational notes. Do not record secrets or raw payloads.

## Recovery safety rules

- Never reassign Paddle customer or subscription ownership automatically.
- Never repair financial state by changing frontend-only fields.
- Never change Production billing IDs merely to make local state match.
- Never directly edit subscription status, plan, billing dates, or trial fields as the normal repair method.
- Never process a local charge or retry; Paddle controls collection and recovery.
- Never grant a new trial during reconciliation.
- Never create a second subscription to repair stale state.
- Never initiate a refund through HireFlow.

## Log patterns and MVP alerting

Use Railway's existing application-log search; PR 11 adds no monitoring platform.

| Pattern | Meaning / action |
| --- | --- |
| `[Paddle webhook] failed to durably persist verified event` | Paddle should retry delivery; correlate event/environment/provider IDs and confirm a later inbox row exists |
| `[Paddle webhook] processing failed` | Inspect event ID, attempt number, sanitized error code, and `retryable_failed` or `terminal_failed` result |
| `[Paddle webhook retry] event reached terminal failure` | Manual investigation required; do not reopen or mutate the row until ownership and provider state are verified |
| `[Paddle webhook] provider ownership conflict rejected` | Mutation was refused; investigate both internal owner IDs and provider IDs |
| `[Paddle payment] failed transaction processed` | Confirm whether entitlement became restricted or a paid plan was safely preserved |
| `[Paddle payment] completed transaction processed` | Confirm the same transaction/subscription restored or activated entitlement |
| `[Paddle subscription reconciliation] Provider state was not applied` | Review the explicit rejection result and local/provider identities |
| `[Paddle subscription reconciliation] automatic candidate failed` | Provider read/configuration failure; repeated failures remain eligible after the 15-minute cooldown |
| `[Paddle subscription reconciliation] Applied verified provider state` | State changed; verify operational, projection, and API state |
| `[Paddle subscription reconciliation] automatic run completed` | Review aggregate selected/updated/already-current/failed/skipped counts |

For MVP, repeated worker failures, terminal webhook failures, ownership conflicts, and repeated reconciliation failures are visible in the existing Railway application logs. These console-only worker and reconciliation failures are not persisted to the Admin Errors view. Configure saved Railway searches if desired; do not add an external alerting service solely for billing.

## Post-repair confirmation

The incident is closed only when:

- Paddle and HireFlow IDs/environment match;
- `users` and `subscriptions` agree with Paddle;
- the entitlement API reports the intended access;
- a failed payment remains restricted or a provider-confirmed recovery is active as appropriate;
- historical hiring data is intact;
- no ownership, environment, freshness, or concurrency guard was bypassed.
