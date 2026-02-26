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

Use start command:
```bash
node backend/src/index.js
```

Render/Railway provide HTTPS at the edge; cookies are marked `secure` in production.

## Users table schema assumptions

The `users` table includes the following optional subscription fields (all nullable):
- `stripe_customer_id` (`TEXT`)
- `stripe_subscription_id` (`TEXT`)
- `stripe_status` (`TEXT`)
- `trial_end` (`TIMESTAMP`)

These columns are metadata for Stripe billing and are intentionally nullable for backward compatibility with existing users.

## Subscription API contract (frontend ↔ backend)

### Create subscription
- **Endpoint:** `POST /api/stripe/create-subscription`
- **Auth:** `Authorization: Bearer <JWT>`
- **Content-Type:** `application/json`

**Request body (future-ready):**
```json
{
  "paymentMethodId": "string"
}
```

**Response body (future-ready):**
```json
{
  "status": "trialing",
  "trial_end": "2026-03-15T12:00:00.000Z"
}
```

Where:
- `status` is one of: `"trialing" | "active"`
- `trial_end` is an ISO-8601 timestamp string

> Note: current implementation is scaffolded and may return `503` until payments are enabled/configured.
