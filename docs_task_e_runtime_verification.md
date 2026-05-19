# Task E — Runtime verification (P0 operational)

## Scope
Runtime verification for a specific failing analysis ID, including:
- parse job status
- AI usage rows
- `/api/analyses/:id` payload shape (`items[].result` and normalized candidate shape)
- malformed fields detected post-process

## Commands executed
1. `echo $DATABASE_URL`
2. `psql -Atqc "select current_database(), current_user"`

## Execution result
- `DATABASE_URL` is not set in this environment.
- `psql` client is not installed in this environment (`/bin/bash: psql: command not found`).

Because of these two hard blockers, SQL verification and live API payload capture for the target analysis ID could not be executed from this runtime.

## RCA root-cause ranking revision
- Treat `backend/src/routes/analyses.js` as a **visibility/mapping layer by default**, not a primary root cause.
- Keep an analyses-layer bug as **primary only when evidence shows loss/mutation** between `parse_jobs` and `GET /api/analyses/:id` output.
- Until that diff is captured for a concrete failed row, prioritize upstream/downstream hypotheses first and classify analyses mapping as provisional.

## Evidence trail from code path (normalization + malformed detection)
- `GET /api/analyses/:id` composes each item with:
  - `result: parsedResult`
  - `normalizedCandidates: extracted.candidates`
- Extraction diagnostics increment malformed count when parse result is non-object/malformed.
- Analysis items are sourced from `parse_jobs.result` joined via `analysis_items.parse_job_id`.

These behaviors are implemented in `backend/src/routes/analyses.js` lines covering item query, extraction, and response shaping.

## SQL checks to run once DB access is provided
> Replace `<ANALYSIS_ID>` with the exact UUID and run against production/staging DB.

### 1) Parse job status for the analysis
```sql
SELECT
  ai.id AS analysis_item_id,
  ai.parse_job_id,
  pj.status AS parse_job_status,
  pj.progress,
  pj.error_message,
  pj.updated_at,
  r.parse_status AS resume_parse_status,
  r.parse_error,
  r.filename
FROM analysis_items ai
LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
LEFT JOIN resumes r ON r.id = ai.resume_id
WHERE ai.analysis_id = '<ANALYSIS_ID>'
ORDER BY ai.created_at ASC;
```

### 2) AI usage rows correlated to parse jobs in this analysis
```sql
SELECT
  u.id,
  u.resume_id,
  u.parse_job_id,
  u.provider,
  u.model,
  u.usage_available,
  u.unavailable_reason,
  u.input_tokens,
  u.output_tokens,
  u.total_tokens,
  u.estimated_cost_usd,
  u.created_at
FROM resume_analysis_token_usage u
INNER JOIN analysis_items ai ON ai.parse_job_id = u.parse_job_id
WHERE ai.analysis_id = '<ANALYSIS_ID>'
ORDER BY u.created_at ASC;
```

### 3) Raw parse payload inspection (malformed post-process root cause)
```sql
SELECT
  ai.id AS analysis_item_id,
  ai.parse_job_id,
  jsonb_typeof(pj.result) AS parse_result_type,
  pj.result
FROM analysis_items ai
LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
WHERE ai.analysis_id = '<ANALYSIS_ID>'
ORDER BY ai.created_at ASC;
```

### 4) Validation diff for one failed row (required before promoting analyses-layer to primary)
```sql
SELECT
  ai.id AS analysis_item_id,
  ai.parse_job_id,
  pj.status,
  pj.parse_error_code,
  pj.error_message,
  pj.result ->> 'failureCategory' AS parse_result_failure_category
FROM analysis_items ai
LEFT JOIN parse_jobs pj ON pj.job_id = ai.parse_job_id
WHERE ai.analysis_id = '<ANALYSIS_ID>'
  AND (pj.status = 'failed' OR pj.error_message IS NOT NULL)
ORDER BY ai.created_at ASC
LIMIT 1;
```

Then fetch API payload and compare the same item:
```bash
curl -sS "${API_BASE}/api/analyses/<ANALYSIS_ID>" \
  -H "Authorization: Bearer <TOKEN>" | jq '.items[] | {id, parse_job_id, status, error, failureCategory, parseOutcome}'
```

Required field-by-field comparison:
- `parse_jobs.status` ↔ API `items[].status`
- `parse_jobs.parse_error_code`/`parse_jobs.error_message` ↔ API `items[].error`
- `parse_jobs.result.failureCategory` ↔ API `items[].failureCategory`
- overall parse outcome expectation ↔ API `items[].parseOutcome`

Decision rule:
- If any compared field is lost or mutated in API output, keep analyses-layer as primary.
- If fields are preserved, demote analyses-layer to visibility/mapping and continue RCA upstream/downstream.

## API sample to capture once service/auth are available
```bash
curl -sS "${API_BASE}/api/analyses/<ANALYSIS_ID>" \
  -H "Authorization: Bearer <TOKEN>" | jq .
```
Inspect:
- `items[].result`
- `items[].normalizedCandidates`
- `diagnostics.resultExtraction.malformedItemCount`

## Current conclusion
Runtime root-cause confirmation for the exact analysis ID is **blocked** in the current container due to missing DB connectivity and missing `psql`. The concrete SQL/API evidence collection steps above are ready and mapped directly to the production code paths.

Interim ranking stance: `backend/src/routes/analyses.js` remains a visibility/mapping layer hypothesis and should **not** be kept as primary unless the required failed-row diff demonstrates field loss/mutation from `parse_jobs` to API output.
