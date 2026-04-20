# Preview-to-Production Visual Verification Workflow

Use this workflow for every UI-impact PR to prevent preview/production drift and confirm the expected design reaches `hireflow.dev`.

## 1) Verify PR Preview deployment first (required)

- [ ] Open the Vercel **Preview URL** attached to the PR (do **not** start with production).
- [ ] Confirm the preview deployment is tied to the latest PR commit SHA.
- [ ] Hard refresh with cache disabled before visual checks.

## 2) Route visual QA checklist (Preview URL)

Validate each route at both:
- Desktop: `1440x1024`
- Mobile: `390x844`

Required routes:
- [ ] `/` (Hero: heading, CTA, and above-the-fold spacing/visual hierarchy)
- [ ] `/pricing`
- [ ] `/contact`
- [ ] `/about`

For each route + viewport:
- [ ] Capture screenshot artifact.
- [ ] Confirm typography, spacing, color tokens, and CTA styling match expected design.
- [ ] Confirm no stale assets, clipped content, or responsive layout regressions.

## 3) Merge gate

- [ ] PR checklist + required QA automation are green.
- [ ] Visual QA artifacts reviewed and accepted.
- [ ] PR is merged only after preview visual checks pass.

## 4) Production verification after merge (required)

- [ ] Open `https://hireflow.dev` and verify deployment has completed.
- [ ] In Vercel deployment details, confirm production deployment commit SHA equals merged commit SHA.
- [ ] Confirm Vercel production settings still use:
  - Build Command: `npm run build`
  - Output Directory: `dist`
  - Root project build config (no stale subdirectory override)

## 5) Production route validation (post-merge)

Re-run the same route checks on production (`hireflow.dev`):
- [ ] `/` Hero reflects expected merged design.
- [ ] `/pricing`, `/contact`, `/about` render expected latest UI.
- [ ] Desktop + mobile screenshots captured for evidence.

## 6) Acceptance sign-off

A PR satisfies PH6-T2 only when all conditions below are true:
- [ ] UI updates are visibly present on `hireflow.dev` after merge.
- [ ] No mismatch exists between expected design version and deployed production UI.
- [ ] Visual verification artifacts are attached to the PR/release notes.
