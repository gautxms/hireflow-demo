# Primitive-only Composition Policy

Date: 2026-04-20  
Owner: Design Systems

## Scope

This policy applies to new UI work in shared public/admin directories:

- `src/components/**`
- `src/pages/**`
- `src/admin/components/**`
- `src/admin/pages/**`

## Policy requirements

1. **New major UI must compose from approved primitives by default.**
   - Public: `public-*` and `hf-*` primitives/components.
   - Admin: `ui-*`, `admin-*`, and `AdminPrimitives` exports.
2. **Ad-hoc utility-only composition is disallowed** for palette/surface/text utility classes (for example `text-slate-*`, `bg-slate-*`, `border-slate-*`) in the scoped folders above.
3. **PRs must explicitly confirm primitive usage** (see PR template + QA checklist).
4. **Exceptions require design approval** using the escape hatch process below.

## Lint enforcement

- Required check: `npm run lint:primitives`
- Script: `scripts/check-primitive-composition.mjs`
- Baseline file: `docs/qa/baselines/primitive-composition-violations-baseline.json`

The lint check blocks new bypass patterns that are not explicitly baselined under an approved exception ID.

## Escape hatch (approved exceptions)

Use this only when primitive composition cannot be used without blocking delivery.

1. Open/update an exception in `docs/PRIMITIVE_COMPOSITION_EXCEPTIONS.md` with a new `PCX-###` ID.
2. Include all of the following:
   - impacted path/scope
   - rationale for bypass
   - design approver
   - expiration date and cleanup owner
3. Regenerate baseline entries only for approved exceptions:
   - `npm run lint:primitives:baseline -- --exception-id=PCX-###`
4. Reference the `PCX-###` ID in the PR description.

Any exception without explicit design approval should be treated as invalid.
