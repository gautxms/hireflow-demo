# Paddle durable webhook readiness

Durable Paddle webhook processing is a launch prerequisite whenever HireFlow is
configured with Sandbox or Production billing values. It is no longer an
optional rollout mode.

## Required configuration

Set both flags on the Railway backend that receives Paddle webhooks:

```text
PADDLE_DURABLE_WEBHOOK_INBOX_ENABLED=true
PADDLE_WEBHOOK_RETRY_WORKER_ENABLED=true
```

Configure the matching environment-specific webhook secret. Production uses
`PADDLE_PRODUCTION_WEBHOOK_SECRET` (or the legacy production-only
`PADDLE_WEBHOOK_SECRET` alias). Sandbox uses
`PADDLE_SANDBOX_WEBHOOK_SECRET`. One environment's secret never satisfies the
other environment's readiness check.

Local and test runtimes with no Paddle billing values may start without these
flags because they cannot accept or create billing traffic.

## Startup gate

After normal migrations run, backend startup verifies:

1. durable inbox ingestion is enabled;
2. the retry worker is enabled;
3. every configured Paddle environment has its own webhook secret;
4. `paddle_webhook_events` exists with the columns used by live ingestion and
   scheduled recovery;
5. the unique event-ID, retryable-event, and scheduled-retry indexes exist; and
6. the in-process retry worker can complete an initial inbox connectivity probe.

Any failure stops startup before the HTTP listener opens. Errors expose only
sanitized configuration/schema categories and never secret values.

The schema is supplied by migrations:

- `050-add-durable-paddle-webhook-inbox`
- `051-add-paddle-webhook-retry-scheduling`
- `052-backfill-paddle-webhook-verification-gap`

Apply migrations through the existing backend startup flow. Do not create or
alter the inbox manually in Production.

## Readiness check

`GET /health` continues to report liveness with `alive: true` and includes a
separate `billing` object. A Paddle-enabled runtime reports HTTP `200` only when
the durable inbox schema and worker are ready. It reports HTTP `503` with
`status: not_ready` if billing processing becomes unavailable. The response
contains safe error codes, not credentials or database connection details.

Expected configuration matrix:

| Paddle billing | Durable inbox and worker | Expected result |
| --- | --- | --- |
| Not configured | Not configured | Startup allowed; billing marked not required |
| Sandbox configured | Ready | Billing ready |
| Sandbox configured | Missing/unavailable | Startup or readiness fails |
| Production configured | Ready | Billing ready |
| Production configured | Missing/unavailable | Startup or readiness fails |

## Verification after deployment

1. Confirm `GET /health` returns `200` and `billing.ready: true`.
2. Deliver a legitimate signed Sandbox event to `/api/paddle/webhook/sandbox`.
3. Confirm exactly one `paddle_webhook_events` row is created with the Sandbox
   environment and transitions to `completed` (or a documented retry state).
4. Redeliver the same event and confirm no second entitlement mutation occurs.
5. In a controlled non-Production test, verify a wrong or malformed signature
   creates no inbox or entitlement mutation.
6. In a temporary database, omit migrations 050-052 and confirm billing
   readiness fails; apply them and confirm it becomes ready.

Do not claim these deployment checks passed until their event IDs, HTTP results,
inbox states, and sanitized worker outcomes have been captured.

## Rollback

Do not disable either mandatory flag while Paddle billing remains configured;
the backend will correctly refuse to start. If a release regression requires
rollback, restore the last known-good durable-capable application release while
keeping the inbox and worker flags enabled. Preserve all unfinished inbox rows
for replay or later reconciliation.

The older two-phase compatibility rollout is complete. Returning to its
flag-disabled mode would knowingly pause new event persistence and is not an
MVP-safe rollback.
