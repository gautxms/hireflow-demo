# Skills Field Provenance (Parse Output ↔ Render Paths)

## Scope
This document maps current usage and provenance for these fields across parse output and rendering code paths:

- `skills_structured`
- `skills`
- `skills_flat`
- `top_skills`
- `matchedSkills`
- `fit_assessment.matched_requirements`
- `fit_assessment.missing_requirements`

## Canonical field decisions

| Use case | Canonical field | Type | Why |
|---|---|---|---|
| 1) All extracted resume skills | `skills_structured` | object `{ tools_and_platforms, methodologies, domain_expertise, soft_skills }` | Parse job always normalizes into this shape and routes normalize back to this object for API payload consistency. |
| 2) Matched skills against JD | `fit_assessment.matched_requirements` | string[] | Resolver prioritizes this as explicit match signal before legacy aliases (`matchedSkills`, `matched_skills`, `fit_assessment.matched`). |
| 3) Missing JD requirements | `fit_assessment.missing_requirements` | string[] | Resolver prioritizes this as explicit gap signal before legacy aliases (`missingSkills`, `missing_skills`, `fit_assessment.missing`, skill gap aliases). |

## End-to-end provenance map

### A) Parse writer (`backend/src/jobs/parseResumeJob.js`)

- Normalizes candidate skills into canonical structured object via `normalizeStructuredSkills(candidate?.skills)`.  
- Builds fallback list from original `candidate.skills` via `normalizeSkills(...)`, then flattens structured data and falls back to original list if flattened is empty.  
- Writes candidate fields:
  - `skills_structured: skillsStructured`
  - `skills: skillsStructured` (object mirror)
  - `skills_flat: normalizeStringArray(resolvedSkillsFlat).slice(0, 25)`
  - `top_skills: normalizeStringArray(candidate?.top_skills).slice(0, 15)`
- Persists resume row columns:
  - `skills_structured` column receives structured object
  - `skills` column receives `primaryCandidate?.skills_flat` array (not structured object)

**Notable type/truncation behavior**
- `top_skills` truncated to **15** items.
- `skills_flat` truncated to **25** items.
- `skills` is object in parse result/candidate payload, but `resumes.skills` DB column is written as flat array from `skills_flat`.

### B) API normalization/reader (`backend/src/routes/results.js`)

- `parseSkills(skills)` accepts **object / array / comma string** and always returns `string[]`.
- `normalizeCandidate(...)` canonicalizes skills object with fallback priority:
  1. `candidate.skills_structured` object,
  2. `candidate.skills` object,
  3. synthesize object from `candidate.skills` list/string into `tools_and_platforms`.
- Emits both:
  - `skills` as object (canonical in API output)
  - `skills_structured` as same object mirror
  - `skills_flat` as stored array when present, else parsed from `candidate.skills`
  - `top_skills` as stored array when non-empty, else first 5 parsed skills fallback
- Matched/missing requirements fallback chain:
  - matched: `candidate.matchedRequirements` → `fit_assessment.matched` → `fit_assessment.matched_requirements` → `[]`
  - missing: `candidate.missingRequirements` → `fit_assessment.missing` → `fit_assessment.missing_requirements` → `[]`

**Notable type/truncation behavior**
- `top_skills` fallback is truncated to **5** (`slice(0, 5)`) in route-normalized output.
- Multiple alias fields coexist for matched/missing requirements (camelCase and snake_case).

### C) Legacy payload normalizer (`src/components/candidateResultsPayload.js`)

- Reads `fit_assessment.matched_requirements` and `fit_assessment.missing_requirements` only (strict array checks).
- Rewrites `fit_assessment` to include both canonical snake_case and alias fields:
  - `matched_requirements`, `missing_requirements`
  - `matched`, `missing` fall back to canonical arrays when absent
- `top_skills` is forced to array or empty array.

**Notable type/truncation behavior**
- No truncation.
- Strict type narrowing to arrays; non-array values collapse to `[]`.

### D) Skill signal resolver (`src/components/candidateScoreSkillsResolver.js`)

- Matched skills explicit-source precedence:
  1. `fit_assessment.matched_requirements` (canonical)
  2. `matchedSkills`
  3. `matched_skills`
  4. `fit_assessment.matched`
- Missing skills precedence:
  1. `fit_assessment.missing_requirements` (canonical)
  2. `missingSkills`
  3. `missing_skills`
  4. `fit_assessment.missing`
  5. `skill_gaps`
  6. `skillGaps`
- Relevant/all skills fall back to `top_skills` then `skills`.

**Notable type/truncation behavior**
- `normalizeList` accepts arrays only; non-array values become `[]`.
- Dedupe is case-insensitive; no truncation here.

### E) UI consumer (`src/components/CandidateResults.jsx`)

- `deriveTopSkills(candidate)` precedence:
  1. `top_skills` array
  2. aggregate `skills_structured` object arrays
  3. fallback parse of `skills`
- `parseSkills(...)` supports `skills` as array (including object entries via name/label coercion) or comma string.
- Filtering path uses `parseSkills(candidate?.skills)` for selected skill matching.
- Decision text helpers currently inspect legacy direct arrays:
  - `matchedSkills` / `matched_skills`
  - `missingSkills` / `missing_skills`

**Notable type/truncation behavior**
- No direct truncation in this component for mapped fields.
- Type coercion from object entries to display text can hide schema drift.

## Field-by-field read/write matrix

| Field | Primary writer(s) | Reader(s) | Fallback / substitutions | Type shifts |
|---|---|---|---|---|
| `skills_structured` | parse job writes canonical object | results route, CandidateResults top skills derivation | route falls back to `skills` object or synthesized object | stable object when canonical path is present |
| `skills` | parse job sets object in parse result; resume DB `skills` column stores flat array | results route `parseSkills` and UI filters/skill lists | object/array/string all accepted by readers | object ↔ array ↔ string across paths |
| `skills_flat` | parse job computes flattened list and writes | results route emits directly when array | falls back to parsed `skills` in route | array canonical, but regenerated from mixed `skills` source |
| `top_skills` | parse job writes (max 15) | route output, resolver relevant/all skills, CandidateResults deriveTopSkills | route fallback first 5 parsed skills | array expected; non-array normalized to [] in payload normalizer |
| `matchedSkills` | legacy upstream/input only (no writer in scoped files) | resolver + CandidateResults decision text | superseded by `fit_assessment.matched_requirements` in resolver | array expected; non-array dropped |
| `fit_assessment.matched_requirements` | upstream parse payload / payload normalizer pass-through | payload normalizer, resolver (highest precedence) | route may populate `matchedRequirements` from alternative aliases | array expected |
| `fit_assessment.missing_requirements` | upstream parse payload / payload normalizer pass-through | payload normalizer, resolver (highest precedence) | route may populate `missingRequirements` from alternative aliases | array expected |

## Recommended operational guidance

- Treat `skills_structured` as source-of-truth for extracted resume skills in newly produced payloads.
- Treat `fit_assessment.matched_requirements` and `fit_assessment.missing_requirements` as source-of-truth for JD alignment signals.
- Keep aliases only for backward compatibility at read time, not as new write targets.
- Consider aligning resume DB `skills` column semantics with API `skills` object to remove current object/array mismatch.
