# Paddle Embedded Checkout Implementation

This document explains the new Paddle Embedded Checkout integration that replaces hosted checkouts.

## Overview

Since Paddle hosted checkouts are not available for your account, we've implemented **Paddle Embedded Checkout**, which:
- Opens a checkout overlay directly on your app (no redirect)
- Uses Paddle's official JavaScript library
- Integrates seamlessly with your existing payment flow
- Supports all Paddle features: subscriptions, tax handling, email capture, etc.

## Setup Requirements

### 1. Environment Variables

Add these to your `.env` (backend):

```bash
# Paddle API Key (Server-side, keep secret)
PADDLE_API_KEY=your_paddle_api_key_here

# Paddle Client Token (Public, safe to expose)
PADDLE_CLIENT_TOKEN=your_paddle_client_token_here

# Paddle Environment (production or sandbox)
PADDLE_ENVIRONMENT=production

# Price IDs from Paddle Dashboard
PADDLE_MONTHLY_PRICE_ID=pri_xxxxx
PADDLE_ANNUAL_PRICE_ID=pri_xxxxx
```

### 2. Get Paddle Client Token

1. Log in to [Paddle Dashboard](https://dashboard.paddle.com)
2. Go to **Settings** → **Developer tools** → **Authentication**
3. Copy your **Public API Key** (this is your client token)
4. Add to environment variables

### 3. Verify Price IDs

In Paddle Dashboard:
1. Go to **Products** → Your product
2. Find your price plans (monthly/annual)
3. Copy the **Price ID** for each
4. Add to environment variables

## How It Works

### 1. User Selects Plan (Frontend)

User clicks "Start Monthly" or "Start Annual" on the Pricing page → redirects to `/checkout?plan=monthly`

### 2. Checkout Page Initializes (Frontend)

1. Loads `Checkout.jsx` component
2. Sends POST request to `/api/paddle/checkout` with plan choice
3. Backend creates a Paddle transaction

### 3. Backend Creates Transaction

```javascript
// src/routes/paddleCheckout.js
POST /api/paddle/checkout
{
  plan: "monthly" | "annual"
}

Response:
{
  transactionId: "txn_xxxxx",
  clientToken: "your_paddle_client_token",
  paddleEnvironment: "production"
}
```

### 4. Frontend Opens Embedded Checkout

1. Loads Paddle.js library from CDN
2. Initializes Paddle with client token
3. Opens checkout overlay with transaction ID

```javascript
Paddle.Initialize({
  token: clientToken,
})

Paddle.Checkout.open({
  transactionId: 'txn_xxxxx',
})
```

### 5. User Completes Payment

- Enters payment details in overlay
- Paddle processes payment
- On success: redirects to `/billing/success`
- On cancel: redirects to `/billing/cancel`

### 6. Webhook Confirms Subscription

- Paddle sends `transaction.completed` webhook
- Backend activates subscription in database
- User can access full features

## File Changes

### Backend

**New/Modified:**
- `src/routes/paddleCheckout.js` - New endpoint for embedded checkout
- `src/routes/paddleWebhook.js` - Handles `transaction.completed` events

**Key Endpoints:**
- `POST /api/paddle/checkout` - Create transaction for embedded checkout
- `POST /api/paddle/webhook` - Receive Paddle events

### Frontend

**Modified:**
- `src/pages/Checkout.jsx` - Updated to use Paddle.js instead of redirecting
- `src/pages/Pricing.jsx` - No changes needed (already routes to `/checkout?plan=...`)

## Testing

### 1. Development Setup

```bash
# Backend
export PADDLE_CLIENT_TOKEN="test_xxxxx"
export PADDLE_MONTHLY_PRICE_ID="pri_xxxxx"
export PADDLE_ANNUAL_PRICE_ID="pri_xxxxx"
export PADDLE_ENVIRONMENT="sandbox"

npm run dev
```

### 2. Test Payment Flow

1. **Sign up** as a new user
2. Go to **/pricing**
3. Click "Start Monthly" or "Start Annual"
4. You'll be redirected to `/checkout?plan=...`
5. Checkout overlay should open
6. Use [Paddle test cards](https://developer.paddle.com/build/references/test-cards):
   - **Card:** `4111 1111 1111 1111`
   - **Expiry:** Any future date
   - **CVC:** Any 3 digits
7. Complete payment
8. You should be redirected to `/billing/success`
9. Check database - `subscription_status` should be `"active"`

### 3. Test Sandbox Mode

Use `PADDLE_ENVIRONMENT=sandbox` and test in Paddle's sandbox:

```bash
export PADDLE_ENVIRONMENT="sandbox"
export PADDLE_CLIENT_TOKEN="test_xxxxx" # sandbox token
```

## Common Issues

### Issue: "Paddle Client Token Missing"

**Error:** `PADDLE_CLIENT_TOKEN is not configured`

**Solution:**
1. Get your public API key from Paddle Dashboard
2. Add to `.env`: `PADDLE_CLIENT_TOKEN=your_key`
3. Restart backend

### Issue: "Paddle Script Failed to Load"

**Error:** `Failed to load Paddle script`

**Solution:**
1. Check if `https://cdn.paddle.com/paddle/v2/paddle.js` is accessible
2. Check browser console for CORS errors
3. Verify your Paddle account is active

### Issue: "Transaction ID Missing"

**Error:** `Paddle transaction ID was missing in response`

**Solution:**
1. Verify `PADDLE_API_KEY` is correct
2. Verify `PADDLE_MONTHLY_PRICE_ID` and `PADDLE_ANNUAL_PRICE_ID` are valid
3. Check backend logs for Paddle API errors

### Issue: Checkout Opens But Payment Doesn't Process

**Possible causes:**
1. Price IDs are incorrect
2. Paddle account is in sandbox but environment is production
3. Payment method not supported in your region

## Webhook Integration

Paddle sends real-time events to `/api/paddle/webhook`:

**Key Events:**
- `transaction.completed` - Payment successful, subscription active
- `transaction.failed` - Payment failed
- `subscription.activated` - Subscription started
- `subscription.paused` - Subscription paused
- `subscription.canceled` - User canceled subscription

All events are logged and processed in `src/routes/paddleWebhook.js`.

## Production Deployment

### 1. Get Production Credentials

1. Switch from sandbox to production in Paddle Dashboard
2. Get production API key
3. Get production client token
4. Get production price IDs

### 2. Update Environment Variables

```bash
PADDLE_ENVIRONMENT=production
PADDLE_API_KEY=live_xxxxx (NOT starting with test_)
PADDLE_CLIENT_TOKEN=live_xxxxx
PADDLE_MONTHLY_PRICE_ID=pri_xxxxx (from production)
PADDLE_ANNUAL_PRICE_ID=pri_xxxxx (from production)
```

### 3. Test in Production

1. Deploy to Vercel/Railway
2. Go to pricing page
3. Try a test card payment
4. Verify webhook logs in Paddle Dashboard
5. Confirm subscription activated in database

### 4. Enable Automated Billing

In Paddle Dashboard:
1. Go to **Subscriptions** → **Settings**
2. Enable "Automated Billing"
3. Set retry policy (recommended: 3 attempts over 7 days)

## Security Notes

- **PADDLE_API_KEY**: Keep secret, use server-side only
- **PADDLE_CLIENT_TOKEN**: Safe to expose, used in frontend
- **Return URLs**: Must match domain in Paddle Dashboard
- **CORS**: Paddle handles CORS headers, no special config needed
- **Webhook Verification**: Implement webhook signature verification in production (TODO)

## Next Steps

1. ✅ Update backend checkout endpoint
2. ✅ Update frontend Checkout component
3. ✅ Get Paddle client token
4. ⏳ Test in sandbox
5. ⏳ Test in production
6. ⏳ (Optional) Implement webhook signature verification
7. ⏳ (Optional) Add analytics tracking for checkout events

## Resources

- [Paddle Docs - Embedded Checkout](https://developer.paddle.com/build/checkout/build-checkout)
- [Paddle Docs - Client Token](https://developer.paddle.com/build/authentication)
- [Paddle Docs - Webhooks](https://developer.paddle.com/webhooks/overview)
- [Paddle Dashboard](https://dashboard.paddle.com)
- [Test Cards](https://developer.paddle.com/build/references/test-cards)
