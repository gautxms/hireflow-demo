# Microcopy Style Guide (Public + Admin)

Date: 2026-04-20  
Owner: Product + Frontend

This guide standardizes UI microcopy across the public app and admin console.

## 1) Voice and tone

- **Voice:** clear, direct, and helpful.
- **Tone:** confident and calm; avoid hype or blame.
- **Person:** second person (`you`) when giving instructions.
- **Accessibility:** use plain language; avoid jargon and abbreviations unless they are product terms (for example, `2FA`).

## 2) Tense and grammar

- Use **present tense** for states and labels: `No users found`, `Session expired`.
- Use **imperative verbs** for CTAs: `Log in`, `Save changes`, `Open 2FA setup wizard`.
- Prefer contractions only when natural and short (`don't` is acceptable), but avoid inconsistent mixing in related flows.

## 3) Capitalization and punctuation

- Use **sentence case** for buttons, labels, helper text, alerts, and empty states.
- End **full-sentence helper/error/success messages** with punctuation.
- Do **not** add punctuation to short labels/buttons unless needed for clarity.
- Use the ellipsis character (`…`) for in-progress states (`Saving…`, `Logging in…`).

## 4) CTA verb patterns (canonical)

- Authentication:
  - `Log in` (not `Login` as a verb)
  - `Sign up`
  - `Back to log in`
- Save/create:
  - `Save changes`
  - `Create job description`
- Retry/resend:
  - `Retry`
  - `Resend verification email`
- Submission:
  - `Submit demo request`

## 5) Validation, error, and success patterns

### Validation errors

Pattern: **what failed + how to fix**.

- ✅ `Enter a valid email address.`
- ✅ `Password must be at least 8 characters long.`

### System/action errors

Pattern: **Unable to + action + optional status/context**.

- ✅ `Unable to log in (401)`
- ✅ `Unable to connect to the auth server. Check the backend URL and CORS settings.`

### Success messages

Pattern: **action complete + next step (optional)**.

- ✅ `Verification email sent. Check your inbox.`
- ✅ `Thanks! Your feedback was saved.`

### Empty states

Pattern: **No + noun + qualifier (`yet` optional) + next action guidance**.

- ✅ `No users found. Try a different search or status filter.`
- ✅ `No webhook activity yet. Events appear here after integrations send webhooks.`

## 6) Terminology glossary (canonical)

- `Log in` (verb), `login` (noun/adjective only).
- `Sign up` (verb), avoid `signup` in user-facing copy unless part of a code/API payload.
- `Email address` for form guidance; `email` acceptable for field labels.
- `2FA` for admin security flows.
- `Job description` instead of `JD` in user-facing CTA text.

## 7) PR + lint workflow for new strings

1. Check this guide before adding or changing UI strings.
2. Reuse existing wording for identical actions/states.
3. For each new string in `src/components`, `src/pages`, or `src/admin`, self-check:
   - sentence case
   - canonical verbs from Section 4
   - consistent punctuation
   - `Unable to + action` error pattern when relevant
4. If introducing a new copy pattern, document it in this guide in the same PR.
5. Include a **Microcopy QA** note in PR description summarizing audited routes/components.

Reference checklist: `docs/qa/pr-review-checklist.md`.
