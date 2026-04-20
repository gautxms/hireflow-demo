# Brand Guideline Exceptions Register

Last updated: 2026-04-20

Use this register for temporary, approved deviations from `docs/DESIGN_BRAND_GUIDELINES.md`.

| Exception ID | Route / Area | Approved deviation | Reason | Owner | Approved on | Expiry / review date | Renewal rationale | Linked remediation PR/task | Status |
|---|---|---|---|---|---|---|---|---|---|
| BGX-001 | `/checkout` (`src/pages/Checkout.jsx`) | Keep dynamic inline width/position values tied to Paddle embedded checkout container | Runtime widget sizing still computed dynamically; full tokenization blocked until checkout wrapper refactor | Frontend | 2026-04-19 | **2026-05-31** | N/A (resolved before renewal) | `src/pages/Checkout.jsx` refactor (completed 2026-04-20) | Resolved 2026-04-20 (inline route styles migrated to tokenized classes) |
| BGX-002 | `/admin/logs` (`src/admin/pages/AdminLogsPage.jsx`) | Keep inline width for error-rate bars (`style={{ width: ... }}`) | Data-driven chart bars require runtime width values; visual tokenization applies to static properties only | Admin UI | 2026-04-19 | **2026-06-15** | Required at next weekly review if remediation not yet merged | Track remediation in phase PR checklist item: "inline bar width migration or formal renewal" | Active |
| BGX-003 | `/admin/billing` refund history list (`src/admin/pages/AdminPaymentsPage.jsx`) | Temporary use of slate utility classes (`text-slate-900`, `border-slate-100`) | Pending migration of refund history section to admin primitives + dark token utilities | Admin UI | 2026-04-19 | **2026-05-15** | N/A (resolved before renewal) | `src/admin/pages/AdminPaymentsPage.jsx` refund history token migration (completed 2026-04-20) | Resolved 2026-04-20 (refund history styles migrated to admin tokenized border/text values) |

## Review policy
- Review cadence: **weekly exception review** (design systems + owning team).
- Weekly workflow:
  1) **Auto-expire stale entries:** on review day, any entry past `Expiry / review date` moves from `Active` to `Expired` unless renewed in the same review.
  2) **Require renewal rationale:** an expired or soon-to-expire exception can be renewed only with a concrete `Renewal rationale` that explains why remediation is still blocked.
  3) **Require linked remediation PR/task:** every `Active` exception must include a live PR or task link/identifier in `Linked remediation PR/task`.
  4) **Close on remediation:** once remediation merges, update status to `Resolved` in the same phase PR and keep a completion note.
- Expired exceptions must be either:
  1) removed/resolved by completing remediation, or
  2) renewed with updated rationale, owner confirmation, and a new expiry date.

## Completion gate
- Release/phase completion requires:
  - zero unapproved token violations in scope, and
  - zero expired exceptions left in `Active` state.

## Route migration note (2026-04-20)
- Migrated `/checkout`, `/account`, `/billing`, `/billing/success`, `/billing/cancel`, and `/account/payment-method` to class-based styles.
- No runtime inline sizing/width styles remain in these routes after migration.
- Route-state shells for loading/error/success remain aligned to shared `src/styles/app-route-states.css` classes (`route-state`, `route-state-card`, and modifiers).
