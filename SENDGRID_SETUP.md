# SendGrid SMTP Configuration for HireFlow

This guide helps you set up SendGrid email sending in Railway.

## Prerequisites

- SendGrid account (free tier available at https://sendgrid.com)
- Railway project with backend deployed

## SendGrid Setup Steps

### 1. Create SendGrid Account & API Key

1. Go to https://sendgrid.com and sign up (or log in)
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Name it: `hireflow-railway` (or similar)
5. Select **Restricted Access**
6. Under **Mail Send**, enable:
   - ✓ Mail Send
7. Click **Create & View**
8. Copy the API key (you'll need this)

### 2. Verify Sender Email

1. In SendGrid dashboard, go to **Settings → Sender Authentication**
2. Click **Verify a Single Sender**
3. Enter your email (e.g., `noreply@hireflow.dev`)
4. SendGrid will send verification email
5. Click the link in the email to verify

**Note**: For production, use a branded domain verification instead (requires DNS setup)

### 3. Configure Railway Environment Variables

1. Go to your Railway project
2. Click **Variables** in the environment
3. Add these variables:

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.xxxxxxxxxxxxxxxxxxxx
SMTP_FROM=noreply@hireflow.dev
```

**Values:**
- `SMTP_HOST`: `smtp.sendgrid.net` (always this)
- `SMTP_PORT`: `587` (always this)
- `SMTP_USER`: `apikey` (literally the string "apikey")
- `SMTP_PASS`: Your SendGrid API key (from step 1)
- `SMTP_FROM`: Your verified sender email

4. Click **Deploy** or wait for auto-redeploy

### 4. Verify Configuration

Check Railway logs for startup message:

```
[EMAIL] ✓ SMTP configured: { host: 'smtp.sendgrid.net', port: 587, user: 'apikey', from: 'noreply@hireflow.dev' }
```

If you see missing variables listed, add them to Railway and redeploy.

## Testing

1. Sign up with a test email on your live app
2. Check inbox for verification email from SendGrid
3. Verify the email
4. Log in successfully

## Troubleshooting

### "SMTP config missing" Error

**Problem**: Backend logs show `[EMAIL] ⚠️  SMTP not fully configured`

**Solution**: Check Railway logs startup message to see which variables are missing. Common issues:

- **SMTP_PASS is wrong**: Copy API key again, paste carefully
- **SMTP_USER not "apikey"**: Must be exactly the string "apikey"
- **SMTP_PORT not a number**: Must be `587` (not quoted)
- **Variables not saved**: Click Deploy after adding variables

### Email Not Arriving

1. **Check spam folder** - SendGrid emails sometimes land in spam initially
2. **Verify sender email** - In SendGrid, ensure `noreply@hireflow.dev` is verified
3. **Check SendGrid activity log**:
   - SendGrid dashboard → **Mail Activity**
   - Look for your test email
   - Click it to see delivery status/errors

### Sender Address Shows Wrong Email

1. Update `SMTP_FROM` in Railway to match your verified sender
2. Redeploy backend
3. Resend test email

## Free Tier Limits

SendGrid free tier allows:
- **100 emails/day**
- Perfect for dev/testing
- Upgrade anytime for more volume

## Advanced: Domain Verification

For production, verify a domain instead of individual email (looks more professional):

1. SendGrid → **Settings → Sender Authentication**
2. Click **Verify a Domain**
3. Add DNS records to your domain registrar
4. Wait for DNS to propagate (~24h)
5. Click **Verify** in SendGrid

Then use `SMTP_FROM=noreply@yourdomain.com`

## Support

- SendGrid Docs: https://docs.sendgrid.com/
- API Key Help: https://docs.sendgrid.com/ui/account-and-settings/api-keys
- SMTP Connection: https://docs.sendgrid.com/for-developers/sending-email/integrations/
