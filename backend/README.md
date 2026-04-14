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
