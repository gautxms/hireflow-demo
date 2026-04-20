# PH7-T1 Cross-browser Issue Log

- **Run date:** 2026-04-20
- **Run ID:** `PH7-T1-2026-04-20`
- **Matrix:** Chrome/Safari/Firefox × desktop/mobile × core public/admin routes

## Issue register

| ID | Severity | Route | Viewport | Browser | Observation | Disposition |
|---|---|---|---|---|---|---|
| MINOR-001 | minor | `/` | desktop | Firefox | Hero gradient appears slightly darker due to interpolation differences. | Accepted delta; no action required. |
| MINOR-002 | minor | `/pricing` | desktop | Safari | Card shadow softness differs compared to Chrome baseline. | Accepted delta; no action required. |
| MINOR-003 | minor | `/admin/overview` | desktop | Firefox | Chart labels render with slightly heavier anti-aliasing. | Accepted delta; no action required. |
| MINOR-004 | minor | `/admin/users` | mobile | Safari | Table border edges appear lighter by subpixel rendering behavior. | Accepted delta; no action required. |
| MINOR-005 | minor | `/admin/security` | mobile | Firefox | Focus ring alpha appears stronger than Chromium. | Accepted delta; no action required. |

## Fixed during run

No critical or moderate issues were detected; therefore no blocking visual remediations were required for PH7-T1.

## Exit criteria decision

- Critical count = **0** ✅
- Moderate count = **0** ✅
- Minor count documented and accepted = **5** ✅

**Final status:** PASS
