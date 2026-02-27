# Stripe Setup Guide (1-hour completion path)

This document explains exactly what is already wired in this repo, what is intentionally disabled right now, and the shortest path to enable live Stripe safely.

---

## 1) What is already implemented

### Database (subscription storage)
The `users` table already has nullable Stripe/subscription columns:
- `stripe_customer_id` (`TEXT`)
- `stripe_subscription_id` (`TEXT`)
- `stripe_status` (`TEXT`)
- `trial_end` (`TIMESTAMP`)

A migration exists at:
- `backend/sql/migrations/20260226_add_subscription_columns_to_users.sql`

### Backend Stripe scaffolding
Implemented backend pieces:
- `backend/src/services/stripe.js`
  - Safe Stripe client initialization
  - Disabled when `STRIPE_SECRET_KEY` is missing/placeholder
- `backend/src/middleware/paymentsEnabled.js`
  - Feature flag gate via `PAYMENTS_ENABLED`
  - Returns `503` when disabled
- `backend/src/routes/stripe.js`
  - `POST /api/stripe/create-subscription` exists as scaffold
  - Auth + payments flag checks are in place
- `backend/src/routes/user.js`
  - `GET /api/user/subscription` reads subscription fields from DB
- `backend/src/middleware/subscriptionGate.js`
  - Premium feature gating based on persisted subscription status

### Frontend scaffolding
Implemented frontend pieces:
- `src/components/PricingPage.jsx`
  - Plan UI with CTA to `/checkout`
- `src/components/CheckoutPage.jsx`
  - Checkout scaffold
  - Reads `VITE_STRIPE_ENABLED`
  - Stripe Elements loading path is prepared for later
- `src/App.jsx`
  - Routes for `/pricing` and `/checkout`
  - Fetches `/api/user/subscription` and shows status-based UI

---

## 2) What is intentionally disabled until Stripe approval

The following are intentionally **not live** yet:

1. **Real subscription creation logic**
   - `POST /api/stripe/create-subscription` is scaffolded and returns non-live behavior.
2. **Live Stripe charging flow in frontend**
   - Checkout page is scaffold-only (no completed payment intent/subscription confirm flow yet).
3. **Payments feature flag default behavior**
   - Payments remain disabled unless `PAYMENTS_ENABLED=true`.
4. **Live key activation**
   - Stripe service stays disabled if keys are missing/placeholder.

This is by design to avoid accidental billing before product/business approval.

---

## 3) Environment variables to set later

## Backend
Set in backend runtime environment:
- `DATABASE_URL` (already required)
- `JWT_SECRET` (already required)
- `FRONTEND_ORIGIN` (already required)
- `PAYMENTS_ENABLED=true` (to open payment routes)
- `STRIPE_SECRET_KEY=sk_live_...` (live secret key)

## Frontend
Set in frontend runtime/build environment:
- `VITE_STRIPE_ENABLED=true`
- `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...`

> Keep `VITE_STRIPE_ENABLED=false` in non-billing environments unless actively testing payments.

---

## 4) Exact steps to enable live Stripe

Use this checklist in order.

### Step 0 — Preconditions (5 min)
- Confirm Stripe account is approved for live charges.
- Confirm legal pages exist and are published (Terms, Privacy, refund/cancellation language).
- Confirm pricing model (currently UI shows `$99/month`, `7-day free trial`).

### Step 1 — Verify DB schema in target env (5 min)
Run migration in production DB:
```bash
psql "$DATABASE_URL" -f backend/sql/migrations/20260226_add_subscription_columns_to_users.sql
```
Confirm columns exist on `users`.

### Step 2 — Configure backend live env vars (5 min)
Set:
- `PAYMENTS_ENABLED=true`
- `STRIPE_SECRET_KEY=sk_live_...`

Restart backend service.

### Step 3 — Configure frontend live env vars (5 min)
Set:
- `VITE_STRIPE_ENABLED=true`
- `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...`

Redeploy frontend.

### Step 4 — Implement real backend subscription creation (15–20 min)
In `backend/src/routes/stripe.js` (or service layer), replace placeholder flow with:
1. Validate request body (`paymentMethodId`).
2. Find authenticated user.
3. Create/reuse Stripe Customer.
4. Create Stripe Subscription (trial config per product rules).
5. Persist to `users`:
   - `stripe_customer_id`
   - `stripe_subscription_id`
   - `stripe_status`
   - `trial_end`
6. Return contract response:
```json
{
  "status": "trialing",
  "trial_end": "<iso-timestamp>"
}
```

### Step 5 — Implement checkout confirmation flow in frontend (10–15 min)
In `src/components/CheckoutPage.jsx`:
1. Collect payment details via Stripe Elements.
2. Submit `paymentMethodId` to `POST /api/stripe/create-subscription` with Bearer JWT.
3. Handle response and update UX to success state.
4. Handle errors (503 when disabled, validation errors, etc.).

### Step 6 — Validate access-control behavior end-to-end (10 min)
Verify status-driven behavior:
- `trialing` → full access
- `active` → full access
- `past_due` → warning shown, access allowed
- `canceled` → premium features blocked

Also verify backend-protected endpoints enforce the same rules.

### Step 7 — Go-live safety checks (5 min)
- Confirm no test keys remain.
- Confirm logs show Stripe enabled in backend startup.
- Confirm cancellation path updates `stripe_status`.
- Confirm at least one successful live subscription and one canceled account flow.

---

## 5) Fast troubleshooting

- **`503 Payments are currently disabled`**
  - Set `PAYMENTS_ENABLED=true` and restart backend.
- **Stripe client remains null**
  - Check `STRIPE_SECRET_KEY` format and deployment secret injection.
- **Frontend checkout still shows "Payments coming soon"**
  - Set `VITE_STRIPE_ENABLED=true` and redeploy frontend.
- **Auth errors on subscription calls**
  - Ensure Bearer JWT is included and `JWT_SECRET` matches token issuer.

---

## 6) Recommended next improvements (after go-live)

- Move Stripe calls from route handlers to dedicated `backend/src/services/*` methods.
- Add webhook endpoint for authoritative status sync (`invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`).
- Add integration tests for subscription state transitions and gated routes.
