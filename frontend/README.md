# Deprecated frontend tree

`frontend/src` was a legacy mirror of the root `src/` React app and has been removed.

## Canonical frontend path

Use the root `src/` directory for all active frontend work:

- App entry: `src/main.jsx`
- App routing: `src/App.jsx`
- Feature UI: `src/components`, `src/pages`, and `src/admin`

## Policy

- Do **not** recreate `frontend/src`.
- Do **not** add parallel implementations of pages/components in nested frontend trees.
- If migration or archival is needed in the future, document it first in `README.md`.
