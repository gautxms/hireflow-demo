# Paddle sandbox testing on the production deployment

HireFlow supports live Paddle customers and explicitly selected sandbox demo users in the same production deployment. The deployment default must remain `production`.

## 1. Configure Railway

Add these variables to the Railway backend service. Keep all existing production values unchanged.

```text
PADDLE_ENVIRONMENT=production

PADDLE_SANDBOX_API_BASE_URL=https://sandbox-api.paddle.com
PADDLE_SANDBOX_API_KEY=<sandbox API key>
PADDLE_SANDBOX_CLIENT_TOKEN=<sandbox client-side token>
PADDLE_SANDBOX_MONTHLY_PRICE_ID=<sandbox monthly price ID>
PADDLE_SANDBOX_ANNUAL_PRICE_ID=<sandbox annual price ID>
```

Do not put Paddle API keys or webhook secrets in Vercel, frontend variables, source control, logs, screenshots, or support messages. Checkout returns only the client-side token to the browser.

## 2. Deploy before creating the sandbox notification destination

Deploy the backend with the environment-specific routing. The webhook endpoints are:

```text
POST /api/paddle/webhook             # legacy endpoint; uses PADDLE_ENVIRONMENT
POST /api/paddle/webhook/production  # explicit production endpoint
POST /api/paddle/webhook/sandbox     # explicit sandbox endpoint
```

The existing live Paddle notification destination may continue using `/api/paddle/webhook`. New configurations should use the explicit environment endpoint.

## 3. Create the Paddle sandbox notification destination

In Paddle Sandbox, create a notification destination using the direct Railway backend URL:

```text
https://hireflow-backend-production.up.railway.app/api/paddle/webhook/sandbox
```

Subscribe to the transaction and subscription events used by HireFlow. Copy the destination secret into Railway:

```text
PADDLE_SANDBOX_WEBHOOK_SECRET=<sandbox endpoint secret>
```

Redeploy the backend after saving the secret. A sandbox signature is accepted only on the sandbox endpoint; production signatures and users are isolated.

## 4. Select a dedicated demo user

Use a user that is not linked to a real live Paddle customer or subscription.

```sql
UPDATE users
SET paddle_environment = 'sandbox'
WHERE id = '<DEMO_USER_ID>';
```

Confirm the assignment before testing:

```sql
SELECT id, email, paddle_environment, paddle_customer_id, paddle_subscription_id
FROM users
WHERE id = '<DEMO_USER_ID>';
```

Do not copy live `paddle_customer_id` or `paddle_subscription_id` values into a sandbox user. If the selected demo user already has live Paddle identifiers, use a new demo account or have an operator archive and clear that linkage deliberately before changing environments.

## 5. Run the first checkout

1. Sign in to `https://hireflow.dev` as the sandbox demo user.
2. Start monthly or annual checkout.
3. In the checkout API response, confirm `paddleEnvironment` is `sandbox`.
4. Complete checkout with a Paddle sandbox test card.
5. Confirm the transaction and subscription appear in Paddle Sandbox only.
6. Confirm Railway logs show the sandbox environment and the sandbox webhook returns HTTP 200.

Verify the database:

```sql
SELECT id, email, subscription_status, subscription_plan, paddle_environment,
       paddle_customer_id, paddle_subscription_id, current_period_end
FROM users
WHERE id = '<DEMO_USER_ID>';
```

Expected after a successful webhook:

- `subscription_status = 'active'`
- `paddle_environment = 'sandbox'`
- sandbox customer and subscription IDs are populated
- the live Paddle dashboard has no matching transaction

## 6. Exercise subscription states

Use the sandbox subscription and Paddle's sandbox testing tools to verify activation, scheduled cancellation, completed cancellation, failed payment, and past-due behavior. After each event, confirm:

- Paddle reports delivery to `/api/paddle/webhook/sandbox` with HTTP 200.
- The corresponding user row keeps `paddle_environment = 'sandbox'`.
- The UI reflects the webhook-derived state.
- No live Paddle resource changes.

## Rollback

To stop sandbox checkouts immediately, remove the demo user's sandbox assignment or set it back to production only after confirming it has no sandbox Paddle linkage that the application still needs:

```sql
UPDATE users
SET paddle_environment = 'production'
WHERE id = '<DEMO_USER_ID>';
```

Do not delete or replace the production Paddle variables, and do not set the Railway-wide `PADDLE_ENVIRONMENT` to `sandbox`.
