# RCA: AI score nondeterminism and current scoring contract

## Scope and guardrails

This RCA documents the current scoring data flow and a safe stabilization plan only. It does not change production scoring, ranking, extraction, async processing, provider fallback routing, database schema, UI, or historical records.

The trigger was the PR 982 diagnostic harness result: identical prepared input, provider, model, prompt version, compact mode, and retry attempt still produced a `matchScore.score` spread of 10 points while `yearsExperience` stayed stable. That isolates the residual score variance to AI model nondeterminism in generated judgment fields rather than changing resume text, extraction format, fallback routing, or retries.

## Current scoring fields end-to-end

### AI analysis output and normalization

The active system prompt asks the model to emit all of these related score fields:

- `profile_score`: a resume-only general quality score, explicitly independent of JD availability.
- `fit_assessment.overall_fit_score`: role-fit score when JD context is available; `null` when JD context is missing.
- `matchScore.score`: primary role-fit ranking signal when JD context is available.
- `matchScore.score_out_of_ten`: display convenience field required by prompt to equal `matchScore.score / 10` rounded to one decimal.

Backend compact normalization preserves these fields separately. It sets the normalized candidate top-level `score` from `candidate.score` when present, otherwise from `candidate.matchScore.score`; it independently normalizes `profile_score`, `fit_assessment`, and `matchScore`. This means the app can carry both a role-fit score and a resume-only profile score in the same candidate payload.

### Persistence

On async parse completion, `parseResumeJob` writes the full normalized analysis payload to `resumes.parse_result`, writes the primary candidate resume-only `profile_score` to `resumes.profile_score`, and upserts the primary candidate JSON into `candidate_profiles.profile`. There is no separate persisted column for role-fit `matchScore.score` or `fit_assessment.overall_fit_score`.

`candidate_profiles` is a JSON profile table keyed by `(user_id, resume_id)`. Its `profile` JSON may include `score`, `matchScore`, `fit_assessment`, and `profile_score`, but the table does not have a dedicated scalar `profile_score` column; directory code reads `profile.profile_score` from JSON and falls back to `resumes.profile_score`.

### Frontend/API normalization

There are multiple score resolution ladders today:

1. Shared analysis-results schema resolves in this order: `candidate.score`, `candidate.matchScore.score`, numeric `candidate.matchScore`, then `candidate.profile_score`.
2. Candidate results contract utility resolves in this order: `matchScore.score`, numeric `matchScore`, `score`, `profile_score`, then legacy overall score aliases.
3. Results API normalization resolves top-level `score` from `matchScore.score` or numeric `matchScore` first, then `candidate.score`, with no `profile_score` fallback for results ranking.
4. Results page client sorting resolves in this order: `matchScore.score`, numeric `matchScore`, `score`, `profile_score`, then legacy overall aliases.
5. Shortlist score display resolves from snapshot/source context analysis scores first, then candidate `score`, then `profile_score`/`profileScore`, normalized to a 10-point display.
6. Candidate directory resolves `profileScore` from `candidate_profiles.profile.profile_score` first, then `resumes.profile_score`.
7. Dashboard KPIs average `resumes.profile_score` for completed scored resume windows.

These ladders are intentionally backward-compatible, but they also create drift risk because the same candidate can expose different numeric fields with different semantics.

## Current source of truth by page/API

| Surface | Current score source of truth | Ranking/filtering behavior |
| --- | --- | --- |
| Analysis Results API (`/api/results`) | Latest completed `parse_jobs.result.candidates`, normalized top-level `score` from `matchScore.score`/numeric `matchScore` before `candidate.score`. | Default sort and score filters use normalized `candidate.score`, so role-fit `matchScore.score` is effectively the ranking source when present. |
| Analysis Results UI | API payload plus client-side fallback order `matchScore.score`, numeric `matchScore`, `score`, `profile_score`, legacy overall aliases. | Default sort is match score descending; client uses `resolveActiveCandidateScore`, so it can fall back to profile score for legacy/malformed payloads. |
| Candidate Directory API/UI | `candidate_profiles.profile.profile_score` JSON first, then `resumes.profile_score`. | Directory list itself is ordered by recency in SQL; directory score display/filter metadata uses the resume-only profile score. It is not currently sorted by score in the queried SQL path. |
| Shortlists | Snapshot/source context analysis score first (`score`, `matchScore.score`, numeric `matchScore`, overall/AI aliases), then candidate `score`, then `profile_score`/`profileScore`; normalized to `/10`. | Shortlist display can show role-fit scores captured at add time, but fallback can mix in resume-only profile score. Shortlist helper sorts by rating or added date elsewhere, not by score by default. |
| Dashboard KPIs | `resumes.profile_score`. | Average score KPI is resume-only profile score, not role-fit match score. |
| CSV/share exports from results | Normalized results candidates. | Uses the same results `score` semantics supplied to export/share. |

## Score drift and mixing risks

1. **Top-level `candidate.score` and `candidate.matchScore.score` can diverge.** Backend compact normalization maps top-level `score` from the AI's `candidate.score` if present, otherwise `matchScore.score`, while some downstream code prefers top-level score and other code prefers match score.
2. **`matchScore.score_out_of_ten` is model-generated convenience data.** Prompt rules say it must mirror `matchScore.score / 10`, but current normalization preserves it independently instead of deriving it app-side. If the model emits an inconsistent value, display or diagnostics can drift.
3. **`fit_assessment.overall_fit_score` duplicates role-fit semantics.** It may match `matchScore.score`, but no app-side contract enforces equality. It can therefore diverge from ranking.
4. **`profile_score` has different semantics from role fit.** It is resume-only and stable relative to JD-specific match score, but results and shortlists use it as a fallback, so legacy/malformed payloads can silently switch from role-fit ranking to profile-quality ranking.
5. **Different normalizers prefer different field order.** Shared schema prefers `candidate.score` before `matchScore.score`; results route and client results prefer `matchScore.score`; candidate directory and dashboard prefer `profile_score` only.
6. **Persistence stores role-fit score only inside JSON.** `resumes.profile_score` is scalar and easy to query, but role-fit `matchScore.score` is not separately versioned, cached, or indexed.
7. **Candidate profile backfill/upsert copies one JSON candidate.** Any historical mismatch inside `parse_result.candidates[0]` is preserved in `candidate_profiles.profile` until a new analysis overwrites that profile.

## Why `profileScore` stayed stable while match/fit score varied

The diagnostic held prepared input, model/provider/prompt version, compact mode, and retry count constant. `yearsExperience` stayed stable because it is an extraction/normalization-like fact from resume evidence. `profile_score` is also prompted as a resume-only general quality score with no JD dependence, so it has fewer moving parts and less comparative judgment than JD-fit scoring.

By contrast, `matchScore.score` and `fit_assessment.overall_fit_score` require the model to weigh resume evidence against role-specific requirements, infer relative importance across criteria, and emit a single calibrated judgment. Even with identical text and deterministic app inputs, the model can vary within that subjective scoring band. The observed spread therefore fits AI nondeterminism in the model-generated role-fit score, not pipeline nondeterminism.

## Proposed canonical score contract

Adopt an explicit contract before any functional change:

```js
candidate.scores = {
  final_score: number | null,          // canonical ranking/display score for the current analysis context
  final_score_scale: '0-100',
  final_score_source: 'app_deterministic_v1' | 'ai_match_score' | 'profile_score_fallback' | 'legacy',
  match_score: number | null,          // normalized AI JD-fit score, from matchScore.score only
  match_score_out_of_ten: number | null, // app-derived from match_score, never model-authored
  fit_score: number | null,            // normalized fit_assessment.overall_fit_score
  profile_score: number | null,        // resume-only quality score
  scoring_version: string,
  input_fingerprint: string,
  job_description_fingerprint: string | null,
  prompt_version: string | null,
  provider: string | null,
  model: string | null
}
```

Compatibility fields can remain during migration:

- `candidate.score` mirrors `scores.final_score`.
- `candidate.matchScore.score` mirrors `scores.match_score` or `scores.final_score` only under a documented compatibility mode.
- `candidate.matchScore.score_out_of_ten` is app-derived.
- `candidate.profile_score` mirrors `scores.profile_score`.

## Recommended safest production approach

Use a two-phase rollout with no historical rewrite:

1. **Diagnostic/contract phase (this RCA PR):** document current sources, add tests only if approved later, and do not alter runtime behavior.
2. **Feature-flagged canonicalization phase:** add a read-only score contract builder that computes and logs `scores.*` beside existing fields under a disabled-by-default flag such as `SCORING_CONTRACT_V1_SHADOW=true`. In shadow mode, emit drift diagnostics when `score`, `matchScore.score`, `fit_assessment.overall_fit_score`, and `profile_score` differ.
3. **Deterministic final score phase:** when `ENABLE_DETERMINISTIC_FINAL_SCORE_V1=true`, derive `final_score` app-side from normalized evidence and/or normalized AI sub-scores using a fixed formula. Do not ask the model for the final ranking number. If still using AI sub-scores, treat them as inputs and clamp/round once app-side.
4. **Optional cache phase:** cache `final_score` keyed by resume fingerprint + JD fingerprint + prompt/model/scoring version. This protects users from rerun variance, but it should complement—not replace—a deterministic app-side final score, because caching alone locks in one nondeterministic model sample.
5. **Migration phase:** after confidence, update ranking code to consume `scores.final_score` first, keep legacy fallbacks for old records, and never mutate historical records unless a separate approved migration/backfill exists.

Safest minimal fix: shadow a canonical score contract first, then derive `score_out_of_ten` app-side and make `candidate.score`/ranking use `scores.final_score` behind a feature flag. Avoid schema changes until shadow diagnostics prove the contract.

## Regression tests proposed

Before functional rollout, add tests that assert:

1. Results route normalization uses the canonical final score when feature flag is enabled and preserves current `matchScore.score` behavior when disabled.
2. Candidate Results UI sorting uses one canonical resolver and does not switch between `score` and `profile_score` when match score is present.
3. Candidate Directory continues to use resume-only `profile_score` and labels it as such.
4. Shortlist snapshots preserve the score source used at add time and do not recalculate from newer candidate profile data.
5. `matchScore.score_out_of_ten` is derived from the canonical source and cannot drift from `/10` display.
6. Existing analyses without `scores.*` still render and rank with current legacy fallbacks.
7. PR 982 diagnostic harness can report stable input fingerprints while separating `profile_score`, `matchScore.score`, and `fit_assessment.overall_fit_score` variance.

## Rollback notes

All proposed functional changes should be guarded by disabled-by-default flags. Rollback is disabling the flag to return to the existing field-resolution ladders. Do not rewrite historical `resumes.parse_result`, `parse_jobs.result`, or `candidate_profiles.profile` during rollout; instead, adapt readers with compatibility fallbacks.
