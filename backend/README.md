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
