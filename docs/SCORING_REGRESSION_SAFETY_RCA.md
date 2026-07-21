# Scoring regression-safety RCA

This document characterizes the current implementation. It deliberately proposes no score, prompt, extraction, persistence, or UI changes.

## Upload-to-display data flow

1. Analysis routes create resume and `parse_jobs` rows and enqueue one parse job per file. Analysis status is derived from job counts, so a mixed terminal set is reported as partial while all-success and all-failure sets remain distinguishable.
2. `runParse` loads the stored file, resolves its job-description context, and calls `prepareDocumentPayloadForAnalysis`. PDF remains a binary provider input (with canonical extraction diagnostics/controlled experiments); DOCX is extracted through Mammoth; legacy DOC uses the existing gated legacy extractor.
3. `aiResumeAnalysisService` sends the unchanged system/user prompt to the configured provider and parses the JSON response. Its response includes candidate profile fields, `matchScore`, fit assessment, confidence fields, and (when computed) the V2 shadow contract.
4. The parse job normalizes candidates, applies the existing JD/profile mode, canonicalizes score fields, then runs the existing deterministic and V2 allowlisted experiments. Diagnostics run after those selection steps and before persistence.
5. The complete payload is persisted unchanged in `resumes.parse_result` and `parse_jobs.result`; selected profile columns are also copied to `resumes`. Failure handling writes terminal failure payloads instead of a candidate result.
6. The results API reads stored JSON without rewriting it. It normalizes old and current candidate shapes. Candidate results render the normalized `matchScore.score`/`score`; directory views use their separate score-display resolver.

## Findings

### Extraction entry points

- `backend/src/jobs/parseResumeJob.js` is the asynchronous entry point and delegates to `backend/src/services/resumeDocumentExtractionService.js`.
- PDF: the current provider-compatible binary path is preserved. `pdfCanonicalExtractionService.js` supplies safe fingerprints and observe-only/allowlisted canonical-text experiments.
- DOCX: `resumeDocumentExtractionService.js` validates the ZIP/container and uses Mammoth text extraction.
- DOC: file signature/MIME detection occurs before the gated `legacyDocExtractionService.js`; `legacyDocSemanticExtractionService.js` is separately observe-only/allowlisted.
- Existing synthetic PDF/DOCX/DOC fixtures and extraction tests already exercise routing, MIME/extension disagreement, malformed input, fallback, and privacy-safe diagnostics.

### Async orchestration and persistence

- `backend/src/routes/analyses.js` creates/enqueues work and derives completed, processing, failed, and partial summaries from resume/job states.
- `runParse` has cancellation checks before AI, after AI, and before persistence. Success updates both the resume JSON/result columns and the parse job. `handleParseJobFailure` classifies errors and writes failure state/payloads.
- The parse-job normalization suite characterizes complete, cancel, timeout, retry/failure, multiple-file identity, persistence, and failure-cache behavior. No queue or database behavior is changed here.

### Prompt and response schema

- Prompt construction and provider retry/token ladders live in `backend/src/services/aiResumeAnalysisService.js`. The service requests structured candidate identity/profile, experience, skills, `matchScore`, fit-assessment and confidence data.
- V2 is derived as a shadow scoring contract with four categories: skills (40%), relevant experience (30%), education relevance (15%), and seniority/progression (15%). This PR does not alter that schema, those weights, any prompt text, token limit, retry, or parsing behavior.

### Score generation, confidence, and selection

- Legacy/model score: the model-authored score is normalized into `matchScore.score`, top-level `score`, and fit-assessment fields by parse normalization/canonicalization.
- V2: `ai_scoring_contract_v2.weighted_total_score_recomputed` is computed from the four category values. Visible application requires the V2 apply flag, all-users or user/analysis allowlist eligibility, contract version `ai_jd_fit_rubric_v2`, JD context, a score in 0–100, and configured minimum confidence (default `high`). It fails open to the existing visible score.
- Deterministic JD-fit: a separate allowlisted `deterministic_jd_fit_v1` scorer can replace the three visible score locations when eligible. Its category breakdown includes requirements, skills, experience, location, evidence, risk and confidence adjustment. This path predates and is not modified by this PR.
- Results selection: the results API prefers object `matchScore.score` (or numeric `matchScore`) and falls back to top-level `score`, then clamps 0–100. Frontend legacy schema resolution prefers top-level `score`, then `matchScore.score`, numeric `matchScore`, then `profile_score`. Directory display prefers `scoreDisplay`, then `scoreRaw`, then `profileScore`.
- The new diagnostic reports which already-selected source won: `deterministic_jd_fit`, `ai_scoring_contract_v2`, `matchScore.score`, `candidate.score`, or `missing`. V2 is reported only when its applied score equals the score selected by production precedence; a shadow-only contract never supplies the displayed version. When both experiments apply, V2 wins because it runs last, while the original AI score is retained from the deterministic application chain. It is observational only.

### Persisted score-like fields and consumers

- Candidate JSON may contain: `score`, `matchScore.score`, `matchScore.score_out_of_ten`, `fit_assessment.overall_fit_score`, `profile_score`, `confidenceScores`, `scoreBreakdown`, `ai_scoring_contract_v2` category/weighted/confidence fields, `v2_visible_score_experiment`, and `deterministic_jd_fit_apply_metadata`.
- Resume columns include `profile_score`; complete JSON is duplicated in `resumes.parse_result` and `parse_jobs.result`. The optional `ai_score_cache` stores canonical score, out-of-ten score, source, context, and scoring-contract version for its shadow/cache path.
- Results sorting/filtering/export and candidate cards consume the normalized results score. Candidate-directory surfaces consume raw/display/profile metadata through their own resolver. Admin/telemetry consumes diagnostics, not resume text.
- Version/source is therefore present for V2/deterministic/cache records, but legacy stored candidates do not necessarily carry an explicit version/source. The diagnostic identifies their resolution source without backfilling or mutating them.

### Old-result compatibility and truncation

- `backend/src/routes/results.js` normalizes legacy numeric `matchScore`, object `matchScore`, and top-level-only score shapes and preserves fuller text fields when present. `src/schemas/analysisResultsSchema.js` performs a second defensive client normalization.
- Possible mid-sentence storage sources include provider output-token truncation/invalid JSON recovery, generic `clampString(...).slice`, array item normalization limits, and compact response modes. Results preview clamping is sentence-aware and retains `*Full`/`rawDisplayFields` when available. Per scope, no truncation fix is included.

### Role-specific caps and adjustments

- No SDE-title-specific or other job-title-specific score adjustment was found. Caps are evidence/experience and contract based (including below-minimum experience and deterministic relevance/cap signals), not keyed to an SDE title. Alternative/preferred semantics remain whatever the current provider/V2/deterministic paths produce.

## Coverage added and retained

- Frozen anonymized archetypes cover excellent, strong, moderate, clearly low, decimal in-range experience, exact boundaries, alternative technology, preferred versus required, and no education requirement.
- Characterization asserts only broad ordering and data-contract preservation; it does not establish candidate-specific or role-specific target production scores.
- Existing suites remain the baseline for PDF/DOCX/DOC paths, async terminal states, old/current result normalization, current score selection, rendering contracts, and historical-payload non-mutation.
- The score-delta diagnostic now includes original AI score, V2 score, displayed score/source/version, V2 confidence and numeric category breakdown. It logs identifiers/fingerprints and numeric metadata only, never candidate name, contact data, reasoning, skills, or resume text.

## Remaining gaps and risks

- Provider calls are mocked; there is no committed corpus of real resumes or live-model repeatability test.
- Legacy records lacking source/version can be classified only by field-resolution source, not reconstructed provenance.
- Binary extraction depends on third-party parsers and provider behavior; fixtures characterize routing rather than every document producer.
- Observability depends on existing V2 shadow diagnostics being enabled and retained by the deployment logging pipeline.
- Score fields can intentionally disagree during experiments; downstream consumers have different documented precedence rules.

## Rollback

Revert this PR's single commit. That removes the fixture, characterization assertions, RCA, and extra fields from the existing safe diagnostic. No migration, backfill, record rewrite, flag change, prompt rollback, cache invalidation, or UI deployment step is required.
