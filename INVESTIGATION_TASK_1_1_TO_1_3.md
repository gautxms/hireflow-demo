# Dashboard KPI failure reproduction attempt (Tasks 1.1–1.3)

Timestamp (UTC): 2026-05-21T08:19:00Z
Environment: local/dev (repo checkout `/workspace/hireflow-demo`)
User ID: unavailable (authentication flow could not be reached)

## Task 1.1 — Reproduce `/dashboard` flow

Attempted to start backend in the same execution environment, but startup failed before the app could serve `/dashboard`.

Command:

```bash
node backend/src/index.js
```

Observed fatal startup error:

- `AggregateError [ECONNREFUSED]`
- DB connections refused on `::1:5432` and `127.0.0.1:5432`

Because backend never became healthy, `/dashboard` UI flow (30-day range + Apply filters) could not be executed in this environment.

## Task 1.2 — Capture GET `/api/profile/dashboard/kpis?...`

Network capture is blocked by backend startup failure. No HTTP exchange occurred for this endpoint in this run.

Requested capture fields:

- HTTP status: unavailable (no server response)
- Response body (`error`, `code`, `message`): unavailable (no server response)
- Request headers (Authorization presence): unavailable from runtime capture

Static code reference for expected auth-path behavior:

- `backend/src/middleware/auth.js` returns HTTP 401 with `{ "error": "Unauthorized" }` when no bearer token/cookie token is present.

## Task 1.3 — Correlation metadata

- Timestamp: `2026-05-21T08:19:00Z`
- User ID: not available (request path not reachable)
- Environment: `dev` (local execution environment)

## Why backend details are still required

Confirmed: frontend dashboard KPI error handling depends on API outcome. Without a running DB-backed backend and API response payload/log lines, frontend-only fixes would be speculative.

## Next required step to complete exact signature capture

Provision/attach PostgreSQL for this environment (port 5432) and re-run:

1. Open `/dashboard`
2. Keep 30-day range
3. Click **Apply filters**
4. Capture the exact `/api/profile/dashboard/kpis?...` request/response + backend logs using timestamp/user ID
