# SendGrid Email Configuration for HireFlow

This guide helps you set up SendGrid email sending in Railway using the **HTTP API** (recommended for cloud platforms).

## Why API Over SMTP?

- **More reliable on Railway**: No firewall/port blocking issues
- **Faster**: HTTP-based, no timeout waiting for SMTP handshake
- **Simpler setup**: Only one environment variable needed
- **Better logs**: SendGrid tracks all events via API

## Prerequisites

- SendGrid account (free tier at https://sendgrid.com)
- Railway project with backend deployed

## Quick Setup (5 minutes)

### 1. Create SendGrid Account & Get API Key

1. Go to https://sendgrid.com and sign up (or log in)
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Name it: `hireflow-railway`
5. Select **Restricted Access**
6. Enable only **Mail Send** → ✓
7. Click **Create & View**
8. **Copy the full API key** (starts with `SG.`)

### 2. Verify Sender Email (5 sec)

1. Go to **Settings → Sender Authentication**
2. Click **Verify a Single Sender**
3. Enter your sender email: `noreply@hireflow.dev`
4. SendGrid sends verification email
5. Click the link in the email

### 3. Add to Railway

1. Go to your Railway project
2. Click **Variables**
3. Add this **single** variable:

```
SENDGRID_API_KEY=SG.your_full_api_key_here
SMTP_FROM=noreply@hireflow.dev
```

4. Click **Deploy**

### 4. Verify It Works

Check logs for:

```
[EMAIL] Configuration status:
  ✓ SendGrid API: noreply@hireflow.dev
  ✓ Sent via SendGrid API: Verify your HireFlow email → user@example.com
```

If you see this, **you're done!** 🎉

## Testing

1. Sign up with a test email on `https://yourdomain.com/signup`
2. Check your inbox for verification email
3. Click the link to verify
4. Log in successfully
5. Check Railway logs for: `[EMAIL] ✓ Sent via SendGrid API`

## Troubleshooting

### Emails Not Arriving?

**Check Railway logs first:**

```
[EMAIL] Configuration status:
  ✓ SendGrid API: noreply@hireflow.dev
```

If you see `✗` next to SendGrid API, the API key is missing or wrong.

**Common issues:**

| Problem | Solution |
|---------|----------|
| `✗ SendGrid API key missing` | Add `SENDGRID_API_KEY=SG.xxx` to Railway variables |
| Email in spam | Add `noreply@hireflow.dev` to contacts in your email client |
| Sending fails silently | Check Railway logs for `[EMAIL] SendGrid API error` messages |

### How to Debug in SendGrid

1. Go to https://app.sendgrid.com/
2. Click **Mail Activity** (left sidebar)
3. Look for your test email
4. Click it to see:
   - Delivery status (Delivered, Bounced, etc.)
   - Any error messages
   - Recipient details

### Still not working?

1. Double-check API key is pasted correctly (no spaces, starts with `SG.`)
2. Verify sender email in SendGrid: **Settings → Sender Authentication**
3. Check that `SMTP_FROM=noreply@hireflow.dev` is set in Railway
4. Redeploy backend after any variable changes

## Free Tier Limits

SendGrid free tier:
- **100 emails/day** (enough for testing)
- Upgrade anytime for higher limits
- No credit card required for free tier

## Production Setup

For production with custom domain:

1. **Verify your domain** (not just email):
   - SendGrid → **Settings → Sender Authentication**
   - Click **Verify a Domain**
   - Add DNS records (CNAME)
   - Wait ~24h for DNS propagation

2. **Update SMTP_FROM** to your domain:
   ```
   SMTP_FROM=noreply@yourdomain.com
   ```

3. **Implement unsubscribe links** (SendGrid requires this for bulk email):
   - Already implemented in email templates
   - See `backend/src/templates/emails/` for examples

## Support & Docs

- SendGrid API Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
- Mail Activity Guide: https://docs.sendgrid.com/ui/analytics-and-reporting/
- Rate Limits: https://docs.sendgrid.com/glossary/rate-limit
