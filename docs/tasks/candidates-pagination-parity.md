# Task: Candidates page pagination parity with Jobs/Analyses

## Context
Jobs and Analyses table pages follow a 15-record baseline with pagination controls when records exceed 15. Candidates must match this behavior to maintain consistent table UX.

## Objective
Implement pagination parity on `/candidates` with default page size 15 and standard Previous/Next controls.

## Scope
- Frontend candidates table/list pagination behavior.
- Backend directory query usage (`page`, `pageSize`, `totalPages`, `totalCount`) where available.
- Styling and accessibility parity with existing table pagination pattern.

## Requirements
1. Set default page size on Candidates page to 15.
2. Render pagination controls only when total filtered records > 15.
3. Use real button controls for Previous/Next with correct disabled states.
4. Show `Page X of Y` status with `aria-live="polite"`.
5. Preserve existing filters/sort/search behavior when changing pages.
6. Keep one source of truth for pagination (prefer backend metadata if present).
7. Maintain responsive behavior and dark-theme styling consistency.

## Implementation Tasks
- [ ] Audit current candidates pagination behavior in `src/pages/CandidatesPage.jsx` (currently effectively fixed to first page / oversized page size).
- [ ] Align default query pagination params to `page=1` and `pageSize=15`.
- [ ] Add local page state and page transitions wired to query params.
- [ ] Consume and display backend pagination metadata from `/api/candidates/directory`.
- [ ] Implement/align pagination control styles in `src/styles/candidates-directory.css` using existing app pagination tokens/patterns.
- [ ] Ensure pagination resets to page 1 when filters/sort/search inputs change.
- [ ] Validate no regressions in shortlist selection and bulk actions across pages.

## QA Checklist
- [ ] 0 candidates: no table pagination shown.
- [ ] 1–15 candidates: no pagination shown.
- [ ] 16+ candidates: pagination appears and works.
- [ ] Previous disabled on first page.
- [ ] Next disabled on last page.
- [ ] Filter then paginate then clear filters behaves correctly.
- [ ] Sort then paginate maintains stable ordering.
- [ ] Bulk select/add to shortlist works on current page without errors.

## Out of Scope
- Any changes to AI analysis/scoring/parsing pipelines.
- Candidate ranking algorithm changes.
