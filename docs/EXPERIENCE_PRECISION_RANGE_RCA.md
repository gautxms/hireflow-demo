# Experience precision and inclusive range RCA

## Authoritative data flow

For new analyses, the model produces `candidates[].years_experience` under the runtime system prompt. `normalizeCompactCandidate` converts a safely numeric response with `Number`, and `buildNormalizedCandidates` applies `normalizeNullableNumber` without integer rounding. The parse job persists the same candidate value both in canonical `parse_result` JSON and `resumes.years_experience`; migration 031 defines that column as `NUMERIC(5,2)`. Results serialization also uses `Number`, so historical integers remain numbers and are not rewritten.

The selected Job is loaded by the parse job from `job_descriptions.experience_min` and `experience_max` (falling back to the legacy single `experience_years` value), then exposed as `jobDescriptionContext.experienceMin` and `experienceMax`. Those columns remain integer-backed; no migration is needed to compare decimal candidate experience with integer Job boundaries.

## Root causes

1. The extraction prompt explicitly instructed the model to round calculated employment duration down to a whole integer. That directly lost `3.5`/`4.5`-style precision. A separate OCR fallback already calculates to one decimal, and the primary candidate normalization, JSON result, decimal resume column, results API, directory SQL numeric cast, sorting, and current UI interpolation do not truncate decimals.
2. Range comparisons in the results API filters are already inclusive (`years < min` and `years > max` are excluded), but no shared domain classification existed. Deterministic scoring implemented only a below-minimum branch and otherwise treated experience as satisfied; it did not expose below/within/above/unknown for diagnostics.
3. Experience-specific missing requirements, gaps, recommendations, and rationale originate in the AI response and passed through normalization/post-processing unchanged. Thus the model could emit “exceeds,” “below,” or “overqualified” text even when its own numeric `years_experience` was within the selected Job range. This was not caused by result rendering.
4. Job create/edit serialization and storage round Job boundaries to integers. That is existing Job-contract behavior, not the candidate-precision loss addressed here, and changing it would require broader schema/API work outside this PR.

## Focused correction

`experienceRange` now strictly normalizes finite non-negative numbers or plain numeric strings and returns `below_range`, `within_range`, `above_range`, or `unknown` using inclusive boundaries. It intentionally does not infer a number from ambiguous prose. The parse production path stores this classification, exposes it in deterministic scoring diagnostics, and—only for a deterministic `within_range` result—removes narrowly identified contradictory experience judgments from new AI output before scoring. It creates new objects/arrays and never mutates historical stored payloads.

No weights, score bands, confidence thresholds, score-source selection, extraction implementation, or non-experience requirement semantics changed. A score can change only when removal of an objectively false experience gap prevents an invalid existing penalty. Rollback is a single revert; no migration or backfill is required.
