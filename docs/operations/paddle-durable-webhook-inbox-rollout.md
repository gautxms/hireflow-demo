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
5. Verify normal Paddle events still complete and new rows are written only
   with `status = 'completed'`.
6. Verify there are no unexpected `processing` or `retryable_failed` rows.

While the gate is off, new events retain the prior completion-time deduplication
behavior. The compatibility reader still returns a retryable 503 for unfinished
durable rows, so a rollback or mixed configuration cannot falsely acknowledge
those rows as complete.

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

## Rollback

If durable processing is unhealthy:

1. Stop new webhook traffic or route it to the compatible release.
2. Inspect all `processing` and `retryable_failed` rows.
3. Do not delete or mark unfinished rows completed.
4. Keep a durable-capable instance available to reclaim unfinished work.
5. Disable the flag only after unfinished rows are completed or explicitly
   reconciled.

With the flag disabled, completed duplicates remain suppressed and unfinished
durable rows receive a retryable response instead of a false success.
