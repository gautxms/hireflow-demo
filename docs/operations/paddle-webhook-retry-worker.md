# Paddle durable webhook retry worker

The Railway backend runs a bounded in-process recovery pass every minute. It is
disabled by default and is independent of the live durable webhook feature.

## Configuration

- `PADDLE_WEBHOOK_RETRY_WORKER_ENABLED=true` enables scheduled recovery.
- `PADDLE_WEBHOOK_RETRY_BATCH_SIZE` optionally sets the sequential batch size;
  the default is 20 and values are capped at 100.
- Keep `PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=true`. That flag continues to
  control live ingestion and must not be used as the retry-worker kill switch.

No Vercel cron or public HTTP endpoint is used. Railway starts one timer in each
backend replica. Concurrent replicas are safe because candidate discovery does
not confer ownership: the PR #1208 compare-and-set claim remains authoritative.

## State and retry policy

| Current state | Eligibility | Acquired transition | Result |
| --- | --- | --- | --- |
| `retryable_failed` | `next_retry_at` is null/due, verified payload, fewer than 6 scheduled attempts | `processing`, fresh token, increment both counters | `completed`, `retryable_failed`, or `terminal_failed` |
| `processing` | heartbeat/lease is at least 120 seconds old and fewer than 6 scheduled attempts | same reclaim contract | same outcomes |
| `completed` | never | none | unchanged |
| `terminal_failed` | never | none | unchanged |

Scheduled failures use deterministic delays of 1 minute, 5 minutes, 15 minutes,
and then 1 hour capped. The sixth acquired scheduled attempt is the last; if it
fails, the row becomes `terminal_failed`. A Paddle redelivery may acquire a due
non-terminal row before the scheduler, but uses the same token/attempt fencing.
It cannot reopen a terminal row. Error fields are length-limited and must contain
only sanitized categories/messages.

If the worker crashes during the sixth scheduled attempt, the expired lease is
atomically transitioned to `terminal_failed`; it is never acquired as a seventh
scheduled attempt. The transition's lease predicate prevents it from overwriting
a newer owner that renewed or reclaimed the event concurrently.

The worker processes stored payloads only when `verified_at` proves they crossed
the public signature boundary. New public requests still require a valid Paddle
signature. Scheduled processing uses the same post-verification handler,
heartbeat, business mutations, event-order checks, durable delivery records, and
completion fence as live delivery.

## Rollout and rollback

1. Deploy migration 051 and the application with the worker flag absent/false.
2. Confirm live webhook processing remains healthy.
3. Set `PADDLE_WEBHOOK_RETRY_WORKER_ENABLED=true` on the Railway backend and
   restart it. Optionally set a conservative batch size.
4. Observe sanitized `[Paddle webhook retry]` run summaries.

To roll back, set only `PADDLE_WEBHOOK_RETRY_WORKER_ENABLED=false` and restart.
Do not disable the durable inbox and do not revert PR #1208. Due rows remain
stored and live Paddle deliveries continue normally. Migration 051 is additive
and can remain deployed; when the worker is re-enabled, due rows resume from
their persisted scheduling and attempt metadata. PR 3C provider reconciliation
for events absent from the inbox is intentionally not part of this worker.
