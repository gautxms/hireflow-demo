# Password Reset + CTA Hotfix Release Checklist

Use this checklist to ship and verify the password-reset hashing + email CTA fix safely.

## 1) Configuration update

- [ ] Update runtime environment variable `SUPPORT_EMAIL` to `hello@gfactai.com` in each target environment (staging + production).
- [ ] Confirm backend processes have reloaded environment variables after deploy.

## 2) Deployment

- [ ] Deploy backend version containing:
  - password hashing fix
  - password reset confirmation email CTA fix
- [ ] Record deployed commit SHA and deployment timestamp.

## 3) Production/Staging validation

- [ ] Password reset flow: complete reset and open confirmation email.
- [ ] Verify confirmation email CTA opens `/login`.
- [ ] Verify support contact displays `hello@gfactai.com`.
- [ ] Verify login succeeds with the newly reset password.
- [ ] Capture evidence (screenshots/log snippets) for each validation in both staging and production.

## 4) Affected-user remediation

- [ ] Identify users who reset passwords during the affected timeframe.
- [ ] Determine if any users require a second reset due to the issue.
- [ ] Trigger targeted “reset again” communication for impacted users.
- [ ] Track message delivery and completion rate.

## 5) Post-release monitoring (24–48 hours)

- [ ] Monitor authentication `401` rate.
- [ ] Monitor password-reset success metrics.
- [ ] Compare against pre-release baseline to detect regressions.
- [ ] Escalate and rollback/patch if anomaly thresholds are crossed.

## 6) Sign-off

- [ ] Engineering sign-off
- [ ] Support/Operations sign-off
- [ ] Incident or change log updated with final outcome
