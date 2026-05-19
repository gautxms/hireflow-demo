import crypto from 'crypto'
import { pool } from '../db/client.js'

const RETENTION_DAYS = 7
const MAX_SAMPLES_PER_REASON_PER_DAY = 25
const MAX_SNIPPET_LENGTH = 800
const REDACTED = '[REDACTED]'

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig
const PHONE_PATTERN = /\b(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g

function redactPii(value) {
  const normalized = String(value || '')
  return normalized
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(SSN_PATTERN, REDACTED)
}

function buildSampleSnippet(candidate) {
  const payload = {
    name: candidate?.name || null,
    summary: candidate?.summary || null,
    strengths: Array.isArray(candidate?.strengths) ? candidate.strengths : [],
    considerations: Array.isArray(candidate?.considerations) ? candidate.considerations : [],
    experienceLabel: candidate?.experienceLabel || null,
    years_experience: candidate?.years_experience ?? null,
    top_skills: Array.isArray(candidate?.top_skills) ? candidate.top_skills.slice(0, 8) : [],
  }
  const text = redactPii(JSON.stringify(payload))
  return text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…` : text
}

export async function recordValidationFailureSample({
  resumeId,
  parseJobId,
  userId,
  provider,
  model,
  failureReason,
  candidate,
}) {
  if (!failureReason || !candidate) return
  const sampleSnippet = buildSampleSnippet(candidate)
  if (!sampleSnippet) return

  const sampleHash = crypto.createHash('sha256').update(sampleSnippet).digest('hex')
  const reason = String(failureReason).trim().slice(0, 120)

  await pool.query(
    `DELETE FROM parse_validation_failure_samples
     WHERE expires_at <= NOW()`,
  )

  const capacityResult = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM parse_validation_failure_samples
     WHERE failure_reason = $1
       AND created_at >= DATE_TRUNC('day', NOW())`,
    [reason],
  )
  if (Number(capacityResult.rows[0]?.count || 0) >= MAX_SAMPLES_PER_REASON_PER_DAY) {
    return
  }

  await pool.query(
    `INSERT INTO parse_validation_failure_samples
      (resume_id, parse_job_id, user_id, provider, model, failure_reason, sample_snippet, sample_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9::int * INTERVAL '1 day'))
     ON CONFLICT (failure_reason, sample_hash) DO NOTHING`,
    [resumeId || null, parseJobId || null, userId || null, provider || null, model || null, reason, sampleSnippet, sampleHash, RETENTION_DAYS],
  )
}

