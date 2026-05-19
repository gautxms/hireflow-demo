# Candidate Results RCA + Safe Implementation Plan (2026-05-13)

## Scope
RCA-only pass across the end-to-end path:
1) Resume upload/extraction/OCR
2) AI prompt + output schema
3) Backend normalization
4) DB persistence
5) API response shape
6) Frontend Candidate Results rendering + fallback logic

No runtime behavior changes are included in this PR.

## Executive summary
Primary issue appears to be **frontend field-resolution drift and legacy fallback logic**, not a single parser collapse:
- Skills are being persisted, but Candidate Results can still show **"No skills were extracted"** because the drawer skill resolver reads only `top_skills || skills` and ignores `skills_structured` / `skills_flat` in key paths.
- Education is likely being extracted/persisted in canonical object form (`education[]`), but UI formatting omits important fields (`rawText`, `grade`, years) and can degrade to `N/A` when legacy paths dominate.
- Location depends entirely on extracted/AI-populated `location`; no robust cross-field fallback exists in Candidate Results.
- Experience fallback logic in UI hard-defaults to `0.1` years when parseable values are missing, which explains misleading display.

Secondary risk:
- OCR path uses plain `tesseract` on full PDF and then whitespace-flattens output, which is weak for table structures (education tables) and can lose row/column semantics.

## Dataflow RCA

### 1) Resume upload + extraction/OCR
- OCR service executes `tesseract` over the input file, then collapses all whitespace (`replace(/\s+/g, ' ')`). This likely harms table fidelity and heading segmentation. (`backend/src/services/ocrService.js`).
- There is no explicit table-preserving extraction contract in OCR output.

Assessment:
- **Possible contributor** to education-table misses.
- Not conclusively the sole root cause from code inspection alone.

### 2) AI prompt + schema
- System prompt includes `location`, `education[]`, structured `skills`, `top_skills`, fit assessment matched/missing requirements, and explicit experience contract fields (`totalExperienceYears`, `relevantExperienceYears`, `experienceSource`, etc.). (`backend/src/services/adminSystemPromptService.js`).
- Prompt already enforces no hallucination + conservative unknown handling.

Assessment:
- **Schema is present** for skills/education/location/experience.
- Prompt can still be strengthened for table extraction and evidence-based missing/weak distinction, but this is likely not the first failure point.

### 3) Backend normalization
- Parse job normalizes skills into:
  - `skills_structured` (canonical object)
  - `skills` (object mirror)
  - `skills_flat` (flattened array)
- Education is normalized into canonical array objects with degree/field/institution/date/grade/rawText.
- Experience fields are normalized and preserved (`totalExperienceYears`, `relevantExperienceYears`, `experienceLabel`, `experienceSource`, etc.). (`backend/src/jobs/parseResumeJob.js`).

Assessment:
- Backend normalization path appears **mostly correct** and backward-aware.

### 4) DB persistence
- `resumes.parse_result` stores full parse result.
- Resume top-level columns persist `top_skills`, `skills_structured`, and legacy `skills` column currently receives `skills_flat` array (intentional compatibility behavior).
- Candidate profile snapshot upsert is invoked after parse completion. (`backend/src/jobs/parseResumeJob.js`).

Assessment:
- Persistence has mixed legacy semantics but does not appear to drop core data by design.

### 5) API response shape
- Results route normalization keeps canonical education + highest education aliases and emits `skills_flat` fallback from parsed `candidate.skills` when needed. (`backend/src/routes/results.js`).
- Matched/missing requirements are mapped from `fit_assessment` and aliases.

Assessment:
- API route seems to provide enough fields for correct rendering.

### 6) Frontend Candidate Results rendering/fallback
#### Skills
- Drawer resolver `resolveSkillSignals` defines:
  - `explicitMatched` from `fit_assessment.matched_requirements` and legacy aliases ✅
  - `allSkills` from **only** `candidate.top_skills || candidate.skills` ❌
- If `skills` is object/structured form, list normalization returns empty and UI shows "No skills were extracted for this profile." (`src/components/candidateScoreSkillsResolver.js`, `src/components/CandidateResults.jsx`).

Primary root cause for skills symptom:
- **All Skills (Reference) reads wrong/insufficient sources** and misses `skills_structured` / `skills_flat`.

#### Education
- `resolveCandidateEducationText` prefers `candidate.education` then aliases, good in principle.
- But education formatter ignores several normalized fields (e.g., backend `rawText`, grade/year fields in display path), and object variants can collapse into sparse output.
- Card fallback converts empty resolution to `N/A` aggressively. (`src/components/candidateResultsState.js`, `src/components/CandidateResults.jsx`).

Likely cause for observed N/A:
- **Frontend display normalization mismatch** across modern/legacy education shapes and overly aggressive fallback.

#### Location
- UI renders location directly from `candidate.location` with fallback "Location unavailable". No additional alias use in the expanded header path beyond this value.
- If parser places location elsewhere or extraction misses it, UI remains unavailable. (`src/components/CandidateResults.jsx`, `src/components/candidateResultsState.js`).

Assessment:
- Potentially real extraction gap in some resumes, plus thin UI fallback coverage.

#### Experience
- `resolveCandidateBasics` fallback path parses number from free-form `experience`; if absent, hard defaults to **`0.1`** years.
- This exactly matches observed behavior and is misleading without provenance labeling. (`src/components/candidateResultsState.js`).

Primary root cause for 0.1 yrs symptom:
- **Unsafe UI fallback default** rather than explicit unknown/estimated contract.

## Problem classification against requested checklist

- OCR/text extraction missing table content: **Possible/partial contributor** (table flattening risk in OCR service).
- Resume text truncated before AI analysis: **Needs runtime verification** (not proven in static RCA).
- AI prompt not requiring full structured extraction: **Partially** (already structured, but can be stronger re table/weak-vs-missing evidence).
- AI schema missing education/skills/location fields: **No** (fields exist).
- Backend parser/normalizer dropping fields: **Not evident as primary issue**.
- Database persistence not saving fields: **Not evident as primary issue**.
- API not returning fields: **Not evident as primary issue**.
- Frontend reading wrong fields / only matched skills: **Yes (primary for skills/all-skills display)**.
- Fallback logic converting missing to N/A incorrectly: **Yes (education/location/execution nuance), and especially experience 0.1 fallback**.

## Error Code Mismatch (corrected)

The earlier hypothesis that these error codes were absent and invented by a transformation layer is incorrect. The codes are **first-class internal categories propagated across layers**.

Concrete evidence:
- `backend/src/jobs/parseResumeJob.js` defines `mapParseErrorCode` with explicit mappings for provider/system categories (e.g., `image_only_low_ocr`, `response_format_error`, `rate_limit_error`, `network_error`) and explicit failover behavior to `parse_failed`; it also throws categorized failures such as `extraction_failed::...` and records `failureCategory` in parse outcomes.
- `backend/src/jobs/resumePreflight.js` emits `failureCategory: 'image_only_low_ocr'` in `evaluateOcrOutcome` when OCR confidence is below threshold.
- `backend/src/jobs/parseProviderError.js` declares `CATEGORY_MESSAGES` for the same category family and uses `NORMALIZED_PREFIX_PATTERN` to normalize category-prefixed provider messages (including `image_only_low_ocr`, `response_format_error`, `timeout_error`, etc.).
- `backend/src/contracts/parseResultEnums.js` defines `FAILURE_CATEGORIES` as allowed contract enums (including `image_only_low_ocr`, `response_format_error`, `rate_limit_error`, `unknown_error`, etc.) and `normalizeFailureCategory` to normalize/validate incoming category values.

RCA conclusion update:
- Replace “transformation layer invented these codes” with: **“these codes are first-class internal failure categories that are intentionally emitted, normalized, and contract-validated across preflight, parse job, provider-error normalization, and parse-result enum layers.”**

## Does system prompt need update?
Yes, but as a **Phase 5 hardening step** after data-loss point confirmation.
Recommended targeted additions:
1) "Extract profile facts first" section before scoring.
2) Explicit table extraction directive for education heading variants:
   - EDUCATIONAL / PROFESSIONAL QUALIFICATION
   - Education
   - Qualification
   - Academic Details
3) Add education fields in instruction text (without breaking schema compatibility): degree, institution/university, year/start/end, percentage/CGPA/status, specialization.
4) Add rule: do not classify as "missing" when skill appears anywhere in resume text; mark as weak evidence where applicable.
5) Require uncertainty note when extraction is partial due to OCR ambiguity.

## Does OCR/extraction need improvement?
Yes, likely for table-heavy resumes:
- Preserve line breaks/tabs in OCR normalization for section/table reconstruction.
- Add section-aware heuristics before flattening.
- Validate extraction quality flags for tables (education rows count, heading detection).

## Does backend normalization/persistence/API mapping need fixes?
- Likely **incremental**, not foundational:
  - Ensure canonical output includes explicit `allExtractedSkills` alias generated from `skills_structured + skills_flat`.
  - Ensure education objects can carry year/grade/status consistently in route output (legacy-safe optional fields).
  - Add explicit experience provenance fields to API contract (where missing in older records use null/default-safe values).

## Is frontend rendering reading wrong field?
**Yes.**
Primary concrete mismatch:
- "All Skills (Reference)" currently sources from `top_skills || skills` only, which fails when canonical source is `skills_structured` / `skills_flat`.
- Experience fallback displays `0.1 yrs` default.
- Education display is under-specified for canonical object variants and can degrade to N/A.

## Safe phased implementation plan

### Phase 1 — RCA/data contract audit only (this PR)
- Freeze contract map for skills/education/location/experience across parse job, DB, results API, Candidate Results UI.
- Add failing fixtures/tests that reproduce observed issues before behavior changes.

### Phase 2 — Extraction/schema/normalization fixes
- Backend: introduce canonical derived fields (non-breaking):
  - `allExtractedSkills`
  - `matchedSkills`
  - `missingRequirements`
  - `totalExperienceYears`, `relevantExperienceYears`, `experienceEstimateSource`, `isExperienceEstimated`, `experienceExplanation`
- Keep legacy aliases and existing fields for backward compatibility.
- Education canonical model: include optional year/status/grade/specialization keys while preserving existing consumers.

### Phase 3 — Frontend Candidate Results rendering/fallback fixes
- Skills rendering:
  - All Skills from `allExtractedSkills` fallback to `skills_flat` then flattened `skills_structured` then legacy arrays/strings.
  - Matched Skills from explicit matched requirements only.
  - Missing Requirements from explicit missing requirements only.
- Education rendering:
  - Render canonical education entries with degree/institution/year/grade/status if available.
  - Avoid N/A when any meaningful education evidence exists.
- Location rendering:
  - Use safe alias chain but do not infer fabricated location.
- Experience rendering:
  - Remove magic `0.1` default.
  - Show `Unknown` when absent.
  - Show estimated badge + explanation when inferred from date ranges.

### Phase 4 — Tests + regression fixtures
Add tests/fixtures requested:
- Resume fixture with education table.
- Resume fixture with skills section.
- Resume fixture with location.
- Resume fixture with no explicit total exp but dated roles.
- Backend normalizer tests for canonical fields and legacy compatibility.
- API contract tests for candidate profile fields.
- Frontend rendering tests for full, partial, legacy payloads and fallbacks.

### Phase 5 — Prompt refinement (optional, post-confirmation)
- Update system prompt with stronger extraction-first and table-specific directives.
- Keep JSON contract backward-compatible; only additive instruction changes.

## Recommended PR split
- PR 1: RCA + data contract plan (this document).
- PR 2: Extraction/schema/normalization fixes (backend + contract adapters).
- PR 3: Candidate Results rendering/fallback fixes (frontend).
- PR 4: Regression fixtures + tests.

## Safety gates for all implementation PRs
- Do not alter queue/job semantics in parse pipeline.
- Preserve status handling for completed/partial/processing/failed analyses.
- Preserve backward compatibility for old `parse_result` records.
- Keep scoring/ranking contract unchanged unless additive and tested.
- Validate job creation/editing untouched.
- UI updates must remain within `docs/DESIGN_CONSTITUTION.md` constraints.

## Rollout readiness + approval criteria
Before approving full rollout, confirm the following operational controls are active in production/staging:

- Dashboards are live for resume failure spikes segmented by **failure category** (OCR/extraction, schema validation, normalization, persistence, API mapping, frontend rendering).
- Alerting is enabled (and routed) for anomaly thresholds on failure rate and time-to-recovery.
- Stage-level token usage views are available so on-call teams can diagnose cost/performance regressions at each processing stage.
- Runbook links from alerts point responders to category-specific triage steps.

Full rollout decision rule:
- **Approve full rollout only if both conditions are true:**
  1) token-per-successful-resume improves versus baseline, and
  2) mixed-batch user clarity metrics meet target.
- If either condition fails, hold rollout at canary/partial stage and continue remediation.
