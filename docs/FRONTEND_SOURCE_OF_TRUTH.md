# Frontend source-of-truth decision

Date: 2026-04-19

## Decision

The repository-root `src/` tree is the single canonical frontend implementation.

## Audit summary (`src/` vs `frontend/src/`)

- 20 files had matching relative paths across both trees.
- All 20 overlapping files had divergent content.
- `frontend/src` also contained legacy-only admin pages not wired into the active Vite entrypoint.
- No active imports, build scripts, or route wiring referenced `frontend/src`.

## Migration actions completed

1. Confirmed active build and entrypoint resolve from root `src/` (`src/main.jsx` -> `src/App.jsx`).
2. Verified no references to `frontend/src` in app code, scripts, or docs routing references.
3. Removed `frontend/src` to prevent parallel implementations.
4. Added `frontend/README.md` as a deprecation guardrail.
5. Updated top-level `README.md` to call out canonical frontend ownership.

## Ongoing guardrails

- New frontend work must be added under root `src/` only.
- If a temporary fork/migration is ever required, document a time-bounded plan in `README.md` before creating any parallel tree.

## Chrome architecture note: public vs authenticated

- **Public chrome (marketing shell):** top-level marketing routes rendered from `src/App.jsx` use `site-header__*` classes only for header structure and interactions.
- **Authenticated chrome (application shell):** signed-in workspace layout is rendered via `src/components/app-shell/UserAppShell.jsx` with `src/components/AppHeader.jsx` and uses `app-header__*` / `user-app-shell__*` namespaces only.
- **Isolation rule:** no authenticated header styles should depend on `site-header__*`, and no public header styles should depend on `app-header__*` or `user-app-shell__*`.
