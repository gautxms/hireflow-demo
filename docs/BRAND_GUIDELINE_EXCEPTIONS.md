# Brand Guideline Exceptions Register

Last updated: 2026-04-20

Use this register for temporary, approved deviations from `docs/DESIGN_BRAND_GUIDELINES.md`.

| Exception ID | Route / Area | Approved deviation | Reason | Owner | Approved on | Expiry / review date | Status |
|---|---|---|---|---|---|---|---|
| BGX-001 | `/checkout` (`src/pages/Checkout.jsx`) | Keep dynamic inline width/position values tied to Paddle embedded checkout container | Runtime widget sizing still computed dynamically; full tokenization blocked until checkout wrapper refactor | Frontend | 2026-04-19 | **2026-05-31** | Resolved 2026-04-20 (inline route styles migrated to tokenized classes) |
| BGX-002 | `/admin/logs` (`src/admin/pages/AdminLogsPage.jsx`) | Keep inline width for error-rate bars (`style={{ width: ... }}`) | Data-driven chart bars require runtime width values; visual tokenization applies to static properties only | Admin UI | 2026-04-19 | **2026-06-15** | Active |
| BGX-003 | `/admin/billing` refund history list (`src/admin/pages/AdminPaymentsPage.jsx`) | Temporary use of slate utility classes (`text-slate-900`, `border-slate-100`) | Pending migration of refund history section to admin primitives + dark token utilities | Admin UI | 2026-04-19 | **2026-05-15** | Active |

## Review policy
- Expired exceptions must be either:
  1) removed by completing remediation, or
  2) re-approved with a new reason and new expiry date.
- Review cadence: weekly design-system sync.


## Route migration note (2026-04-20)
- Migrated `/checkout`, `/account`, `/billing`, `/billing/success`, `/billing/cancel`, and `/account/payment-method` to class-based styles.
- No runtime inline sizing/width styles remain in these routes after migration.
