# Email Provider Setup

HireFlow supports explicit transactional email providers via `EMAIL_PROVIDER`.

## Provider selection

Set one of:
- `EMAIL_PROVIDER=ses`
- `EMAIL_PROVIDER=sendgrid`
- `EMAIL_PROVIDER=smtp`
- `EMAIL_PROVIDER=console` (development-only no-send mode)

There is no automatic SendGrid-first fallback anymore.

## Amazon SES setup

Required for SES mode:
- `EMAIL_PROVIDER=ses`
- `AWS_SES_REGION` (example `ap-south-1`)
- `EMAIL_FROM` (example `HireFlow <gautam@hireflow.dev>`)
- `AWS_SES_ACCESS_KEY_ID` (preferred)
- `AWS_SES_SECRET_ACCESS_KEY` (preferred)

Credential fallback behavior:
- If SES-specific keys are missing, service falls back to:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- SES-specific keys always take precedence when present.

Optional:
- `REPLY_TO_EMAIL=gautam@hireflow.dev`

### SES domain verification and production access
1. Verify your sender identity (domain or email) in AWS SES.
2. Configure required DNS records for domain verification and DKIM.
3. Request SES production access to send to non-verified recipients.
4. Ensure the verified identity matches `EMAIL_FROM`.

## SendGrid setup

Required for SendGrid mode:
- `EMAIL_PROVIDER=sendgrid`
- `SENDGRID_API_KEY`
- `EMAIL_FROM` (or `SMTP_FROM`)

## SMTP setup

Required for SMTP mode:
- `EMAIL_PROVIDER=smtp`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM` (or `EMAIL_FROM`)

## Console setup

Use only for development:
- `EMAIL_PROVIDER=console`
- `NODE_ENV=development`

In production, console provider is blocked and returns controlled failure.

## Railway environment variable checklist

Minimum for SES on Railway:
- `EMAIL_PROVIDER=ses`
- `AWS_SES_REGION=ap-south-1`
- `AWS_SES_ACCESS_KEY_ID=...`
- `AWS_SES_SECRET_ACCESS_KEY=...`
- `EMAIL_FROM=HireFlow <gautam@hireflow.dev>`
- `REPLY_TO_EMAIL=gautam@hireflow.dev` (optional)
- `SUPPORT_EMAIL=support@hireflow.dev` (recommended)
- `DEMO_REQUEST_TO_EMAIL=support@hireflow.dev` (recommended)

## Testing steps

1. Set `EMAIL_PROVIDER=console` in local dev and confirm logs show provider/template/domain only.
2. Set `EMAIL_PROVIDER=ses` with valid SES credentials and send:
   - signup verification email
   - password reset email
3. Confirm SES `MessageId` appears in logs and no secrets appear.
4. Set `EMAIL_PROVIDER=sendgrid` and validate SendGrid path only.
5. Set `EMAIL_PROVIDER=smtp` and validate SMTP path only.
