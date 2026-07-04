# HireFlow

HireFlow is an AI-powered recruiting workflow for resume screening, candidate ranking, and shortlist management at [hireflow.dev](https://hireflow.dev). It helps recruiters and hiring teams create job descriptions, upload resumes, extract candidate information from common document formats, run AI-assisted analysis, compare strengths and gaps, and manage downstream hiring workflows.

HireFlow is launch-ready for a controlled beta/early customer rollout. The documentation below is intentionally conservative: AI output is decision support for recruiters, not a guarantee of hiring outcomes.

## Product overview

HireFlow supports a structured first-pass screening workflow:

1. Create or select a job description.
2. Upload candidate resumes in supported formats.
3. Queue document extraction and AI-assisted resume analysis.
4. Review ranked candidates with reasoning, strengths, gaps, and role-fit signals.
5. Save candidates, build shortlists, export reports, and manage subscription access.

## Key features

- **Resume intake:** Upload PDF, DOC, DOCX, and TXT resumes with file validation and size limits.
- **Job description workflow:** Create job descriptions and connect them to resume analyses.
- **Document extraction:** Normalize supported resume documents for downstream analysis while preserving source metadata.
- **AI-assisted candidate analysis:** Generate structured candidate summaries, role-fit reasoning, strengths, gaps, and scoring signals.
- **Candidate ranking and review:** Compare candidates in ranked results and detailed candidate views.
- **Candidate management:** Search, filter, tag, and manage candidate records.
- **Shortlists and reports:** Organize candidates into shortlists and export/report on hiring workflows.
- **Billing and subscriptions:** Paddle-backed checkout, subscription management, payment method updates, invoice access, and webhook handling.
- **Authentication and sessions:** Email/password auth, verification/password-reset flows, HTTP-only auth cookies, and admin session controls.
- **Operational safeguards:** Rate limiting, upload limits, optional file scanning, CI lint/build checks, and production-safe logging defaults.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS/PostCSS, client-side routing with prerendered public pages.
- **Backend:** Express API served from `backend/src`.
- **Database:** PostgreSQL via `pg`.
- **Async processing:** Bull queue with Redis for resume parse/analysis jobs.
- **Storage/infrastructure:** S3-compatible assembled upload storage for large/chunked uploads.
- **Document handling:** Multer upload intake plus PDF, DOCX, DOC, and TXT handling utilities.
- **AI providers:** Configurable AI resume analysis providers with model settings managed in backend/admin code.
- **Billing:** Paddle API, embedded checkout, subscription routes, payment/admin routes, and webhook processing.
- **Email:** SES, SendGrid, or SMTP-backed transactional email configuration.

## Resume/JD extraction and AI analysis overview

### Supported resume file types

The upload path accepts resumes with these extensions/effective MIME types:

| Format | Extension | Effective MIME type |
| --- | --- | --- |
| PDF | `.pdf` | `application/pdf` |
| Microsoft Word | `.doc` | `application/msword` |
| Microsoft Word Open XML | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Plain text | `.txt` | `text/plain` |

Uploads are limited to 25MB per file and batches are limited to 20 files in the standard upload route. Large/chunked upload paths use S3-backed assembly before processing.

### Analysis flow

- The React app submits authenticated upload requests to the Express API.
- The backend validates file type, normalizes metadata, stores resume records, and enqueues parse jobs.
- Bull/Redis workers process queued resumes asynchronously and persist parse/analysis status in PostgreSQL.
- Resume extraction prepares supported content for AI-assisted analysis.
- Analysis results are persisted and displayed as structured candidate rankings, reasoning, strengths, gaps, and review metadata.

AI-generated results should be reviewed by a human recruiter or hiring manager before decisions are made.

## Billing/subscription overview

HireFlow includes Paddle-backed billing flows rather than a placeholder payment plan:

- Embedded checkout configuration for monthly/annual plans.
- Subscription status and plan management routes.
- Payment method update and invoice retrieval flows.
- Paddle webhook handling for subscription/payment events.
- Admin billing/payment visibility and operational actions.

Production billing requires valid Paddle environment variables and webhook configuration.

## Local development setup

```bash
# Install dependencies
npm install

# Start the frontend development server
npm run dev

# Start the Express backend in watch mode
npm run backend:dev

# Build the production frontend and prerender public routes
npm run build

# Preview the built frontend locally
npm run preview
```

The frontend defaults to the configured `VITE_API_BASE_URL`; local development commonly uses the Vite frontend on `http://localhost:5173` and the API on `http://localhost:4000`.

## Environment variables overview

Use `.env.example` as the non-secret template. Do not commit real secrets.

Common configuration groups:

- **Core backend:** `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`, `BACKEND_PUBLIC_URL`, `CORS_ALLOWED_ORIGINS`.
- **Frontend:** `VITE_API_BASE_URL`, `VITE_SITE_URL`, Paddle client token values, and feature flags.
- **Redis/queue:** `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`.
- **Uploads/storage:** `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- **AI providers:** Anthropic/OpenAI model/provider settings and API keys as configured by backend/admin code.
- **Billing:** `PADDLE_ENVIRONMENT`, Paddle API/client/webhook secrets, monthly/annual price IDs, and sandbox/production variants.
- **Email:** `EMAIL_PROVIDER`, SES/SendGrid/SMTP credentials, sender addresses, and verification/reset URLs.
- **Security operations:** Optional file scanning and admin controls such as VirusTotal and admin session/IP settings.

## Testing and CI commands

```bash
# Lint JavaScript/CSS composition checks
npm run lint

# Production build + public route prerender
npm run build

# Check whitespace and patch formatting before commit
git diff --check
```

CI is expected to run blocking lint and build checks before launch changes are merged.

## Deployment notes

- Public marketing/legal routes are prerendered during `npm run build` for SEO.
- Vercel rewrites route authenticated SPA paths to `index.html`; public prerendered routes remain crawlable.
- The Express backend requires PostgreSQL, Redis, secrets, AI provider configuration, email configuration, and billing configuration for production use.
- Configure Paddle webhooks and verify CORS/origin settings before accepting paid users.
- See `README_DEPLOYMENT.md` for deployment-specific notes.

## Security/privacy notes

- HireFlow processes resumes and job descriptions that may contain personal data; use production credentials, HTTPS, least-privilege access, and appropriate retention policies.
- Production auth/session logging is designed to avoid sensitive token/session leakage by default.
- Optional upload scanning can be configured when supported by the environment.
- AI output is assistive and should not be the sole basis for employment decisions.
- This repository does not claim SOC 2 certification, GDPR certification, completed third-party security audits, or guaranteed model accuracy.

## Known limitations / launch notes

- Current launch positioning is controlled beta/early customer rollout, not broad enterprise compliance readiness.
- Recruiters should review and calibrate AI-assisted rankings before acting on results.
- Legacy `.doc` extraction can be less reliable than modern `.docx` or text-based formats; unsupported, encrypted, corrupt, or malformed files may fail validation/extraction.
- Production readiness depends on correctly configured environment variables, database migrations/state, Redis availability, AI provider credentials, Paddle products/webhooks, and email delivery.

## Frontend source of truth

The canonical frontend code lives in the repository-root `src/` tree.

- Use `src/` for pages, components, admin UI, and styles.
- Do not create or reintroduce `frontend/src` mirrors.
- Treat `frontend/README.md`, if present, as a deprecation guardrail for the historical path.

## License

MIT © 2026 HireFlow
