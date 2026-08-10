# Paddle durable webhook retry worker

The Railway backend runs a bounded in-process recovery pass every minute. It is
mandatory whenever Paddle billing is configured and complements live durable
webhook ingestion.

## Configuration

- `PADDLE_WEBHOOK_RETRY_WORKER_ENABLED=true` is required for Paddle-enabled
  runtimes.
- `PADDLE_WEBHOOK_RETRY_BATCH_SIZE` optionally sets the sequential batch size;
  the default is 20 and values are capped at 100.
- Keep `PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=true`. Startup fails if either
  mandatory capability is disabled while Paddle billing is configured.

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

1. Apply migrations 050 through 052 through the existing migration runner.
2. Set both mandatory durable webhook flags to `true` on the Railway backend.
3. Restart and confirm the initial worker inbox probe succeeds before the
   listener opens.
4. Confirm `/health` reports `billing.ready: true` and observe sanitized
   `[Paddle webhook retry]` run summaries.

Do not roll back by disabling the worker while Paddle remains configured; the
backend will refuse to report billing-ready status. Restore the last known-good
durable-capable release and keep due rows intact. Migrations 050 through 052 are
additive and remain deployed. Provider reconciliation for events absent from
the inbox remains outside this worker and belongs to the later reconciliation
PR.
