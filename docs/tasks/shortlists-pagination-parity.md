# Task: Shortlists review pagination parity contract

Shortlists review list/table views follow the same pagination constitution as Jobs/Analyses/Candidates when dense mode is used.

## UX contract

1. Default page size is **15** candidates.
2. Pagination controls are shown only when filtered candidate count is greater than 15.
3. Previous button is disabled on page 1.
4. Next button is disabled on final page.
5. The page indicator is rendered as **Page X of Y** with `aria-live="polite"`.
6. Filter/search/clear interactions reset pagination to page 1.

## Test coverage

- `src/components/shortlistState.test.js`
  - export filename timestamp + shortlist normalization behavior.
- `src/components/ShortlistManager.jsx`
  - runtime pagination gating + aria-live page indicator + clear-filter reset logic.
