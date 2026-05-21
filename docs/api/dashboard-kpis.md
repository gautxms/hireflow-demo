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

## Chart bucket semantics (null vs `0`)

- Chart entries with `value: null` represent **missing/unavailable data** for that period (not a measured zero).
- Chart entries with `value: 0` represent a **true measured zero**.
- Frontend rendering must visually differentiate these states:
  - true zero renders on the chart baseline as a normal value point/bar;
  - missing data renders as a non-value cue (e.g., dashed/hatched marker) and must not connect line segments across missing periods.

## QA sparse-range examples

- Example A (missing middle period):
  - Input buckets: `[4, null, 6]`
  - Expected: two disjoint trend segments (`4` and `6`) with a “no data” cue for the middle bucket.
- Example B (true zero in middle period):
  - Input buckets: `[4, 0, 6]`
  - Expected: a continuous trend with middle point on the zero baseline.
- Example C (all missing):
  - Input buckets: `[null, null, null]`
  - Expected: chart communicates “no data” state; no misleading trend line should be drawn.
