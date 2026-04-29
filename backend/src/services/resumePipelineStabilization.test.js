import test from 'node:test'
import assert from 'node:assert/strict'

import { hasCompleteChunkSet } from './fileUploadService.js'
import { isScanResultSafe } from './virusScanService.js'
import { shouldUseOcrFallback } from '../jobs/ocrFallbackJob.js'
import { applyJobDescriptionScoringMode, buildJobDescriptionContext, isTerminalJobFailure } from '../jobs/parseResumeJob.js'
import { SCORING_MODE_FIXTURES } from '../jobs/__fixtures__/scoringModeFixtures.js'
import { normalizeQueueCounts } from '../routes/admin/health.js'
import { redactValue } from '../routes/admin/logs.js'

test('chunk assembly validator rejects missing, duplicate, and out-of-order gaps', () => {
  assert.equal(hasCompleteChunkSet([0, 1, 2], 3), true)
  assert.equal(hasCompleteChunkSet(['0', '1', '2'], 3), true)
  assert.equal(hasCompleteChunkSet([0, 2], 3), false)
  assert.equal(hasCompleteChunkSet([0, 1, 1], 3), false)
  assert.equal(hasCompleteChunkSet([1, 2, 3], 3), false)
  assert.equal(hasCompleteChunkSet([0, 'abc', 2], 3), false)
})

test('virus scan safety classification enforces safe/unsafe states', () => {
  assert.equal(isScanResultSafe({ status: 'clean', malicious: false }), true)
  assert.equal(isScanResultSafe({ status: 'skipped', malicious: false }), true)
  assert.equal(isScanResultSafe({ status: 'timeout', malicious: false }), false)
  assert.equal(isScanResultSafe({ status: 'clean', malicious: true }), false)
})

test('ocr fallback decision only triggers for scanned/low-confidence/no-text inputs', () => {
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 5000, aiConfidence: 92 }), false)
  assert.equal(shouldUseOcrFallback({ scannedPdf: true, extractionLength: 5000, aiConfidence: 92 }), true)
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 0, aiConfidence: 92 }), true)
  assert.equal(shouldUseOcrFallback({ scannedPdf: false, extractionLength: 5000, aiConfidence: 69 }), true)
})

test('queue retry logic marks resume failed only on terminal failure', () => {
  assert.equal(isTerminalJobFailure({ attemptsMade: 0, opts: { attempts: 3 } }), false)
  assert.equal(isTerminalJobFailure({ attemptsMade: 1, opts: { attempts: 3 } }), false)
  assert.equal(isTerminalJobFailure({ attemptsMade: 2, opts: { attempts: 3 } }), true)
})

test('job description context preserves nullable numeric fields', () => {
  const normalized = buildJobDescriptionContext({
    id: 'jd-1',
    title: 'Platform Engineer',
    experience_years: null,
    salary_min: null,
    salary_max: null,
  })

  assert.equal(normalized.experienceYears, null)
  assert.equal(normalized.salaryMin, null)
  assert.equal(normalized.salaryMax, null)
})

test('job description context includes manual JD fields when provided', () => {
  const normalized = buildJobDescriptionContext({
    id: 'jd-42',
    title: 'Platform Engineer',
    description: 'Build internal developer tooling',
    requirements: '5+ years Node.js',
    skills: ['Node.js', 'PostgreSQL'],
    experience_years: 5,
  })

  assert.equal(normalized.hasContext, true)
  assert.equal(normalized.jobDescriptionId, 'jd-42')
  assert.equal(normalized.title, 'Platform Engineer')
  assert.deepEqual(normalized.skills, ['Node.js', 'PostgreSQL'])
})

test('job description context marks missing JD when parse request has no JD row', () => {
  const normalized = buildJobDescriptionContext(null)
  assert.deepEqual(normalized, {
    hasContext: false,
    source: 'none',
    missingReason: 'job_description_missing',
  })
})

test('fixture: scoring mode preserves score when job-description context exists', () => {
  const { candidates, jobDescriptionContext } = SCORING_MODE_FIXTURES.withJobDescriptionContext
  const [candidate] = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)

  assert.deepEqual(candidate.matchScore, { score: 91, reason: 'Excellent role alignment' })
  assert.equal(candidate.fit_assessment.has_job_description_context, true)
  assert.equal(candidate.fit_assessment.overall_fit_score, 91)
})

test('fixture: no-JD scoring mode nulls score fields and adds missing context reason exactly once', () => {
  const { candidates, jobDescriptionContext } = SCORING_MODE_FIXTURES.missingJobDescriptionContext
  const [candidate] = applyJobDescriptionScoringMode(candidates, jobDescriptionContext)

  assert.equal(candidate.matchScore, null)
  assert.equal(candidate.matchScoreReason, 'job_description_missing')
  assert.equal(candidate.fit_assessment.has_job_description_context, false)
  assert.equal(candidate.fit_assessment.overall_fit_score, null)
  assert.equal(candidate.fit_assessment.skill_match_score, null)
  assert.equal(candidate.fit_assessment.experience_match_score, null)
  assert.equal(candidate.fit_assessment.notes.filter((note) => note === 'job_description_missing').length, 1)
})

test('health queue response normalizes numeric counts safely', () => {
  const normalized = normalizeQueueCounts({ pending: '3', processing: '2', failed: null, succeeded: undefined })
  assert.deepEqual(normalized, {
    pending: 3,
    processing: 2,
    failed: 0,
    succeeded: 0,
  })
})

test('admin log redaction removes sensitive fields and emails', () => {
  const input = {
    token: 'abc',
    nested: {
      email: 'candidate@example.com',
      endpoint: '/api/uploads',
    },
    message: 'Failed for user candidate@example.com',
  }

  const redacted = redactValue(input)
  assert.equal(redacted.token, '[REDACTED]')
  assert.equal(redacted.nested.email, '[REDACTED]')
  assert.equal(redacted.nested.endpoint, '/api/uploads')
  assert.equal(redacted.message.includes('candidate@example.com'), false)
})
