## Summary

<!-- Describe what changed and why. -->

## Primitive composition confirmation (required)

- [ ] I confirm new major UI in `src/components`, `src/pages`, `src/admin/components`, and `src/admin/pages` is composed from approved primitives by default.
- [ ] I confirm this PR does not introduce ad-hoc palette/surface utility bypass patterns (for example `text-slate-*`, `bg-slate-*`, `border-slate-*`) in policy-scoped folders.
- [ ] If an exception is needed, I added a `PCX-###` record in `docs/PRIMITIVE_COMPOSITION_EXCEPTIONS.md`, included design approval, and referenced it here: `PCX-____`.

## QA + checks

- [ ] `npm run lint`
- [ ] `npm run lint:style-tokens`
- [ ] `npm run lint:primitives`
