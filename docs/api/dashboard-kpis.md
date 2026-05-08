# Dashboard KPI Contract (`GET /api/profile/dashboard/kpis`)

Schema version: `2026-04-26.v1`

## KPI formulas

- `analysesRunCount`: count of distinct analyses in the selected window.
- `analysesFailedCount`: count of distinct analyses with `status IN ('failed', 'partial')`.
- `completionRate`: `round2( min(analysesCompletedCount, analysesRunCount) / analysesRunCount * 100 )`.
- `shortlistedRate`: `round2( min(shortlistedCount, resumesCount) / resumesCount * 100 )`.
- `avgScore`: average `profile_score` from scoped resumes where score is non-null.

## Status semantics

- `complete` contributes to `analysesCompletedCount`.
- `failed` contributes to `analysesFailedCount`.
- `partial` is treated as a failed terminal status and contributes to `analysesFailedCount`.
- All other statuses contribute only to run volume (`analysesRunCount`) and not completed/failed counters.

## Denominator and nullable-safe rules

For rate metrics (`completionRate`, `shortlistedRate`):

- If denominator is `0`, `null`, `undefined`, or non-finite: return `0`.
- If numerator is `null`, `undefined`, or non-finite: treat as `0`.
- Negative or zero numerators return `0`.
- Numerator is capped to denominator to prevent values above `100`.

These rules apply consistently to top-level KPIs and chart buckets.
