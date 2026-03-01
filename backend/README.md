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

Use start command:
```bash
node backend/src/index.js
```

Render/Railway provide HTTPS at the edge; cookies are marked `secure` in production.


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
