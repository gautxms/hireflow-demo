# Backend Auth Service

## Run locally

1. Create PostgreSQL database and enable `pgcrypto`.
2. Run SQL schema:
   ```bash
   psql "$DATABASE_URL" -f backend/sql/schema.sql
   ```
3. Copy env file:
   ```bash
   cp backend/.env.example backend/.env
   ```
4. Start service:
   ```bash
   node backend/src/index.js
   ```

## Deployment (Render / Railway)

Set the following environment variables:
- `DATABASE_URL`
- `JWT_SECRET`
- `FRONTEND_ORIGIN`
- `CORS_ALLOWED_ORIGINS` (optional comma-separated trusted browser origins for preview deployments)
- `PADDLE_WEBHOOK_SECRET`
- `PADDLE_API_KEY`
- `PADDLE_MONTHLY_PRICE_ID`
- `PADDLE_ANNUAL_PRICE_ID`
- `APP_ORIGIN` (optional, defaults to `FRONTEND_ORIGIN`)
- `ADMIN_IP_WHITELIST` (set `0.0.0.0/0` to allow all admin login IPs)
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `ANTHROPIC_API_KEY`

Use start command:
```bash
node backend/src/index.js
```

Render/Railway provide HTTPS at the edge; cookies are marked `secure` in production.


### S3 setup for Railway production

Chunked resume uploads require S3 credentials in Railway.

1. Create an S3 bucket (for example `hireflow-resume-uploads`) in `us-east-1` with public access blocked.
2. Create an IAM user (for example `hireflow-app`) with access to that bucket and generate an access key pair.
3. In Railway → project → **Variables**, set:
   - `AWS_REGION=us-east-1`
   - `AWS_S3_BUCKET=hireflow-resume-uploads`
   - `AWS_ACCESS_KEY_ID=<your key id>`
   - `AWS_SECRET_ACCESS_KEY=<your secret>`

Railway redeploys automatically after variable updates.



## Paddle webhook

- Endpoint: `POST /api/paddle/webhook`
- Signature header: `Paddle-Signature` (`ts` + `h1` HMAC SHA256)
- Processed events: `subscription_created`, `subscription_payment_succeeded`, `subscription_cancelled`
- Every webhook payload is written to `paddle_webhook_audit`.


## Paddle hosted checkout

- Endpoint: `POST /api/paddle/checkout-url` (requires auth)
- Body: `{ "plan": "monthly" | "annual" }`
- Returns a Paddle-hosted checkout URL generated via the Paddle Transactions API.
- Includes `userId` and `email` in `custom_data`, and redirects to:
  - success: `/billing/success`
  - cancel: `/billing/cancel`

## Legacy parse data backfill jobs

Use these scripts to derive `analyses`/`analysis_items` and `candidate_profiles` from historical `parse_jobs` and `resumes`.

- Dry-run (default behavior in npm scripts):
  ```bash
  npm --prefix backend run backfill:legacy-parse
  ```
- Execute writes:
  ```bash
  npm --prefix backend run backfill:legacy-parse:execute
  ```

Optional flags for both direct job scripts and the combined runner:
- `--user-id <id>`: limit reconciliation/backfill to one user.
- `--limit <n>`: cap processed rows for staged rollouts.

Reconciliation output includes:
- counts by user,
- missing links (for example mismatched or missing parse/resume relationships),
- failed rows (row-level insert/upsert failures).

These backfills do **not** delete or mutate legacy parse data in `parse_jobs` or `resumes`; they only insert/upsert into `analyses`, `analysis_items`, and `candidate_profiles`.


## Candidate Directory profile snapshot recovery

`GET /candidates/directory` is a read path by default. Leave
`CANDIDATE_DIRECTORY_SYNC_ON_READ=false` (or unset) for normal operation so the
route reads existing `candidate_profiles` rows only and does not perform the
legacy user-wide sync/write work on page load.

Async parse completion still treats the candidate profile snapshot upsert as
non-blocking. If that best-effort upsert fails, the analysis can complete while
the directory snapshot is missing. Recover missing or legacy snapshots with the
existing candidate profile backfill instead of relying on expensive sync-on-read
as normal behavior.

Recommended recovery flow:

1. Estimate missing completed-resume snapshots without writing data:
   ```sql
   SELECT r.user_id, COUNT(*) AS completed_resumes_missing_candidate_profiles
   FROM resumes r
   LEFT JOIN candidate_profiles cp
     ON cp.user_id = r.user_id
    AND cp.resume_id = r.id
   WHERE COALESCE(r.parse_status, 'complete') = 'complete'
     AND cp.resume_id IS NULL
   GROUP BY r.user_id
   ORDER BY completed_resumes_missing_candidate_profiles DESC;
   ```
2. Dry-run the candidate profile backfill:
   ```bash
   npm --prefix backend run backfill:candidate-profiles
   ```
3. Execute the candidate profile backfill:
   ```bash
   npm --prefix backend run backfill:candidate-profiles:execute
   ```

Optional user-scoped recovery:

```bash
npm --prefix backend run backfill:candidate-profiles -- --user-id <USER_ID>
npm --prefix backend run backfill:candidate-profiles:execute -- --user-id <USER_ID>
```

Emergency rollback only:

```bash
CANDIDATE_DIRECTORY_SYNC_ON_READ=true
```

Use the rollback flag only temporarily if candidate visibility regresses during
incident response. After visibility is restored, run/verify the backfill and turn
`CANDIDATE_DIRECTORY_SYNC_ON_READ` back off so directory reads remain cheap.
