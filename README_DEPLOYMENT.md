# HireFlow deployment guide

HireFlow is an AI-powered recruiting workflow for resume screening, candidate ranking, shortlists, reports, auth, and Paddle-backed subscriptions.

This guide focuses on deployment readiness. It avoids demo-era claims that the app is client-only or mock-only because the current codebase includes a React frontend, Express backend, PostgreSQL persistence, Redis/Bull async processing, document extraction, AI-assisted analysis, authentication/session handling, transactional email, and Paddle billing routes.

## Public SEO rendering strategy

Public marketing and legal routes are statically prerendered at build time while authenticated product routes continue to run as a client-side SPA.

- Build command: `npm run build` (`vite build` + `scripts/prerender-public-routes.mjs`)
- Prerendered public routes include `/`, `/pricing`, `/about`, `/contact`, `/help`, `/terms`, `/privacy`, and `/refund-policy`.
- Authenticated and app routes (`/login`, `/signup`, `/billing`, `/account`, `/admin/*`, etc.) rewrite to `/index.html` in `vercel.json`.

## Local deployment smoke commands

```bash
npm install
npm run lint
npm run build
npm run preview
```

Use `npm run backend:dev` for the local Express API while developing against `http://localhost:4000`.

## Vercel frontend deployment

1. Import the GitHub repository into Vercel.
2. Use the React/Vite preset.
3. Set build command to `npm run build` and output directory to `dist`.
4. Configure `VITE_API_BASE_URL`, `VITE_SITE_URL`, and any frontend Paddle client-token values needed by the deployed environment.
5. Confirm `https://hireflow.dev/sitemap.xml` is served after deploy.
6. Submit the sitemap in Google Search Console after production DNS is live.

## Backend/runtime dependencies

A production backend deployment requires these service categories to be configured with real secrets outside git:

- PostgreSQL (`DATABASE_URL`).
- JWT/auth settings (`JWT_SECRET`, frontend/backend origins, cookie/domain settings as needed).
- Redis for Bull parse jobs (`REDIS_URL` or host/port/password/db variables).
- S3-compatible assembled upload storage for large/chunked uploads (`AWS_REGION`, `AWS_S3_BUCKET`, access credentials).
- AI provider/model configuration for resume analysis.
- Paddle production or sandbox API/client/webhook secrets and plan price IDs.
- Email provider settings for verification, password reset, invoices, and customer notifications.
- Optional file scanning provider configuration.

## Supported upload formats

Resume uploads support PDF, DOC, DOCX, and TXT files. Standard uploads are limited to 25MB per file and 20 files per request. Unsupported, corrupt, encrypted, or malformed files may fail validation or extraction.

## Deployment checklist

- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` before commit.
- [ ] Verify frontend rewrites keep authenticated SPA routes working.
- [ ] Verify public prerendered pages load directly by URL.
- [ ] Verify backend health checks, database connectivity, Redis connectivity, and queue worker startup.
- [ ] Verify AI provider credentials/model settings in the target environment.
- [ ] Verify Paddle checkout, webhook receipt, subscription updates, payment method updates, and invoice access in the target Paddle environment.
- [ ] For production sandbox testing, follow `docs/PADDLE_SANDBOX_PRODUCTION_TESTING.md`; never change the production deployment default to sandbox.
- [ ] Verify email delivery for signup verification and password reset.
- [ ] Confirm production logging does not emit auth/session secrets or raw resume content.

## Launch notes

HireFlow is suitable for a controlled beta/early customer rollout when production dependencies are configured and smoke-tested. Do not describe the deployment as enterprise-compliance-ready unless the relevant compliance program, audit, and contractual controls are completed outside this repository.

## Support references

- Vite docs: https://vite.dev
- React docs: https://react.dev
- Vercel docs: https://vercel.com/docs
- Paddle docs: https://developer.paddle.com/

Last updated: 2026-07-03
