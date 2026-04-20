# PH9-T1 Microcopy Audit Report

Date: 2026-04-20  
Scope: Public + admin UI string usage

## Audit method

- Reviewed high-frequency strings in authentication, submission, save, and empty-state flows.
- Compared current strings against canonical patterns in `docs/MICROCOPY_STYLE_GUIDE.md`.
- Normalized duplicate/variant phrasings for the same user actions.

## High-frequency normalization decisions

| Area | Variant(s) Found | Canonical Copy |
|---|---|---|
| Authentication CTA | `Login`, `Back to Login` | `Log in`, `Back to log in` |
| Auth loading state | `Logging in...`, `Sending...`, `Creating account...`, `Saving...` | `Logging in…`, `Sending…`, `Creating account…`, `Saving…` |
| Connection errors | `Unable to connect to auth server. Check backend URL / CORS settings.` | `Unable to connect to the auth server. Check the backend URL and CORS settings.` |
| Sign-up failure copy | `Signup failed (...)` | `Unable to sign up (...)` |
| Abbreviation in CTA | `Create JD` | `Create job description` |
| Save CTA casing | `Save Changes` + `Save changes` | `Save changes` |

## Files updated in this task

- `src/components/LoginPage.jsx`
- `src/components/SignupPage.jsx`
- `src/components/VerifyEmailInfoPage.jsx`
- `src/components/JobDescriptionForm.jsx`
- `src/components/SettingsPage.jsx`

## Follow-up guidance

- Continue normalizing legacy strings during feature-touch updates.
- Keep canonical action labels and error patterns aligned with `docs/MICROCOPY_STYLE_GUIDE.md`.
- Enforce microcopy checks through PR checklist updates.
