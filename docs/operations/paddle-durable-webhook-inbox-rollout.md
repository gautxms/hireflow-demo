# Paddle durable webhook inbox rollout

The durable Paddle webhook inbox uses a disabled-by-default backend gate:

```text
PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=false
```

This gate is required because the backend deploys with overlapping instances. A
pre-inbox instance treats any existing `paddle_webhook_events.event_id` as
completed. It must therefore be drained before any new instance writes
`processing` or `retryable_failed`.

## Phase 1: compatibility deployment

1. Merge and deploy with `PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=false` or unset.
2. Confirm the migration completed.
3. Confirm the deployed commit is the merged PR commit.
4. Wait until every backend instance running a commit older than this PR has
   drained.
5. Confirm flag-disabled instances return retryable HTTP 503 for new or
   unfinished events and do not run billing mutations.
6. Confirm completed duplicates still return HTTP 200 without replaying work.
7. Verify there are no new `processing` or `retryable_failed` rows from
   flag-disabled instances.

While the gate is off, the compatibility reader is intentionally passive. It
acknowledges only rows already marked `completed`; new and unfinished events
receive retryable HTTP 503 and no billing or notification side effects run.
This fail-safe pause prevents a flag-disabled instance from racing a
durable-enabled instance from a no-row decision. Paddle redelivery carries the
event across the short interval between draining the old release and activating
durable mode.

Do not enable the durable mode during this first rolling deployment.

## Phase 2: durable activation

1. Schedule a controlled backend restart that does not overlap with a
   pre-compatibility release.
2. Set `PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=true`.
3. Start only the merged PR release.
4. Deliver one signed sandbox event and verify the row transitions from
   `processing` to `completed`.
5. Redeliver the same event and verify it returns 200 with `duplicate: true`
   without replaying billing mutations.
6. Verify an active duplicate returns 503 with `Retry-After: 120`.
7. Monitor webhook failures, retries, lease renewals, and inbox status counts
   before enabling normal production traffic.

Do not activate the flag through an ordinary rolling deployment if a backend
without the compatibility reader may still be serving requests.

Keep the phase transition short and monitor Paddle delivery attempts. Leaving
the flag disabled after all pre-inbox instances drain intentionally pauses new
webhook processing with retryable responses until phase 2 is activated.

## Rollback

If durable processing is unhealthy:

1. Stop new webhook traffic or route it to the compatible release.
2. Inspect all `processing` and `retryable_failed` rows.
3. Do not delete or mark unfinished rows completed.
4. Keep a durable-capable instance available to reclaim unfinished work.
5. Disable the flag only after unfinished rows are completed or explicitly
   reconciled.

With the flag disabled, completed duplicates remain suppressed. Eligible
unfinished rows and new events receive a retryable response and are not
reclaimed. Re-enable durable mode on the known-good durable-capable release to
resume fenced processing after the rollback condition is resolved.
