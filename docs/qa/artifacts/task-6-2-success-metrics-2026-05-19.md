# Task 6.2 — Success Metrics Definition & Monitoring Plan (2026-05-19)

## Scope
This artifact defines the KPI contract and ongoing monitoring queries for parse stabilization outcomes.

Monitoring window: **14 days post-rollout** (compare to previous 14-day baseline).

## Primary KPIs

### 1) `ai_output_validation_failed` rate (target: down)
**Definition**
- Numerator: resumes with `parse_status = 'failed'` and canonical `failureCategory` = `ai_output_validation_failed` (including subtype values like `ai_output_validation_failed::ai_placeholder_output`).
- Denominator: all terminal parses (`parse_status IN ('complete','failed')`).

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', r.updated_at) AS day,
  COUNT(*) FILTER (
    WHERE r.parse_status = 'failed'
      AND COALESCE(r.parse_result->>'failureCategory', '') LIKE 'ai_output_validation_failed%'
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE r.parse_status IN ('complete', 'failed')), 0) AS ai_output_validation_failed_rate
FROM resumes r
WHERE r.updated_at >= NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY 1;
```

### 2) % failures with placeholder/narrative counters (target: down)
**Definition**
- Numerator: failed parses where `failureCategory` is `ai_output_validation_failed::ai_placeholder_output`.
- Denominator: all failed parses.

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', r.updated_at) AS day,
  COUNT(*) FILTER (
    WHERE r.parse_status = 'failed'
      AND COALESCE(r.parse_result->>'failureCategory', '') = 'ai_output_validation_failed::ai_placeholder_output'
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE r.parse_status = 'failed'), 0) AS placeholder_narrative_failure_share
FROM resumes r
WHERE r.updated_at >= NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY 1;
```

### 3) Successful parse rate (target: up)
**Definition**
- Numerator: resumes with `parse_status = 'complete'`.
- Denominator: all terminal parses (`complete + failed`).

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', r.updated_at) AS day,
  COUNT(*) FILTER (WHERE r.parse_status = 'complete')::float
  / NULLIF(COUNT(*) FILTER (WHERE r.parse_status IN ('complete', 'failed')), 0) AS successful_parse_rate
FROM resumes r
WHERE r.updated_at >= NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY 1;
```

## Secondary KPIs

### 4) Median parse latency
**Definition**
- Median of `parse_duration_ms` across terminal parses.

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', r.updated_at) AS day,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.parse_duration_ms) AS median_parse_latency_ms
FROM resumes r
WHERE r.updated_at >= NOW() - INTERVAL '14 days'
  AND r.parse_status IN ('complete', 'failed')
  AND r.parse_duration_ms IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

### 5) Token usage per resume
**Definition**
- Median and P90 `total_tokens` per parsed resume, from `token_usage` records.

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', tu.created_at) AS day,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY tu.total_tokens) AS p50_total_tokens,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY tu.total_tokens) AS p90_total_tokens
FROM token_usage tu
WHERE tu.created_at >= NOW() - INTERVAL '14 days'
  AND tu.total_tokens IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

### 6) Retry rate and retry success rate
**Definition**
- Retry rate: share of parses where placeholder retry was attempted.
- Retry success rate: share of attempted retries that succeeded.

**Query (daily trend)**
```sql
SELECT
  date_trunc('day', r.updated_at) AS day,
  COUNT(*) FILTER (
    WHERE COALESCE((r.parse_result->>'placeholderRetryAttempted')::boolean, false)
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE r.parse_status IN ('complete','failed')), 0) AS retry_rate,
  COUNT(*) FILTER (
    WHERE COALESCE((r.parse_result->>'placeholderRetryAttempted')::boolean, false)
      AND COALESCE((r.parse_result->>'placeholderRetrySucceeded')::boolean, false)
  )::float
  / NULLIF(COUNT(*) FILTER (
    WHERE COALESCE((r.parse_result->>'placeholderRetryAttempted')::boolean, false)
  ), 0) AS retry_success_rate
FROM resumes r
WHERE r.updated_at >= NOW() - INTERVAL '14 days'
GROUP BY 1
ORDER BY 1;
```

## Alert guardrails
- Alert if `ai_output_validation_failed` rate rises **>20%** over rolling 7-day baseline for 3 consecutive hours.
- Alert if placeholder/narrative failure share exceeds **15%** of all failures for 3 consecutive hours.
- Alert if median parse latency regresses **>25%** vs baseline.

## Rollout decision rule
Advance rollout stage only when all hold for at least 48h:
1. `ai_output_validation_failed` rate improving or neutral.
2. Placeholder/narrative failure share improving.
3. Successful parse rate stable/up.
4. No latency or token-usage regressions beyond guardrails.
