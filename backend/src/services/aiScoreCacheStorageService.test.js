import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSafeScoreCacheStoragePayload,
  getScoreCacheEntry,
  markScoreCacheHit,
  upsertScoreCacheEntry,
} from './aiScoreCacheStorageService.js'

function basePayloadInput() {
  return {
    cacheKeyResult: {
      key: 'score_cache_v1:abc123',
      material: {
        cache_key_version: 'score_cache_v1',
        scoring_contract_version: 'canonical_score_fields_v1',
        resume_fingerprint: 'resume-fingerprint',
        job_description_fingerprint: 'jd-fingerprint',
        provider: 'anthropic-primary',
        model: 'claude-test',
        prompt_version: 'resume-score-v1',
        compact_mode: 'standard',
      },
    },
    cacheValue: {
      scoring_contract_version: 'canonical_score_fields_v1',
      canonical_score: 82,
      score_out_of_ten: 8.2,
      canonical_score_source: 'matchScore.score',
      canonical_score_context: 'jd_fit',
    },
    metadata: {
      schema_version: 'ai_score_cache_storage_v1',
      resumeText: 'Jane Candidate jane@example.com 555-1212',
      jobDescription: 'Secret raw JD',
      filename: 'jane-resume.pdf',
      rawProviderResponse: { score: 82 },
    },
  }
}

function buildValidPayload() {
  const { cacheKeyResult, cacheValue, metadata } = basePayloadInput()
  return buildSafeScoreCacheStoragePayload(cacheKeyResult, cacheValue, metadata).payload
}

test('storage payload rejects missing cache_key', () => {
  const { cacheKeyResult, cacheValue, metadata } = basePayloadInput()
  const result = buildSafeScoreCacheStoragePayload({ ...cacheKeyResult, key: null }, cacheValue, metadata)

  assert.equal(result.valid, false)
  assert.equal(result.eligible, false)
  assert.deepEqual(result.missingFields, ['cache_key'])
})

test('storage payload rejects null canonical_score', () => {
  const { cacheKeyResult, cacheValue, metadata } = basePayloadInput()
  const result = buildSafeScoreCacheStoragePayload(cacheKeyResult, { ...cacheValue, canonical_score: null }, metadata)

  assert.equal(result.valid, false)
  assert.equal(result.eligible, false)
  assert.ok(result.missingFields.includes('canonical_score'))
})

test('storage payload does not include PII or raw text', () => {
  const { cacheKeyResult, cacheValue, metadata } = basePayloadInput()
  const result = buildSafeScoreCacheStoragePayload(cacheKeyResult, {
    ...cacheValue,
    canonical_score_source: 'Jane Candidate jane@example.com 555-1212',
  }, metadata)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('Jane'), false)
  assert.equal(serialized.includes('jane@example.com'), false)
  assert.equal(serialized.includes('555-1212'), false)
  assert.equal(serialized.includes('Secret raw JD'), false)
  assert.equal(serialized.includes('jane-resume.pdf'), false)
  assert.equal(serialized.includes('rawProviderResponse'), false)
  assert.equal(result.payload.canonical_score_source, null)
})

test('upsert inserts and updates same cache_key', async () => {
  const calls = []
  const db = {
    async query(sql, params) {
      calls.push({ sql, params })
      return { rows: [{ cache_key: params[0], canonical_score: params[3] }] }
    },
  }

  const first = await upsertScoreCacheEntry(buildValidPayload(), db)
  const second = await upsertScoreCacheEntry({ ...buildValidPayload(), canonical_score: 91, score_out_of_ten: 9.1 }, db)

  assert.equal(calls.length, 2)
  assert.match(calls[0].sql, /ON CONFLICT \(cache_key\) DO UPDATE/)
  assert.equal(first.stored, true)
  assert.equal(second.entry.canonical_score, 91)
})

test('get by cache_key returns expected value', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /WHERE cache_key = \$1/)
      assert.deepEqual(params, ['score_cache_v1:abc123'])
      return { rows: [{ cache_key: 'score_cache_v1:abc123', canonical_score: 82 }] }
    },
  }

  const result = await getScoreCacheEntry('score_cache_v1:abc123', db)

  assert.equal(result.found, true)
  assert.equal(result.entry.canonical_score, 82)
})

test('mark hit increments hit_count and updates last_used_at', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /hit_count = hit_count \+ 1/)
      assert.match(sql, /last_used_at = NOW\(\)/)
      assert.deepEqual(params, ['score_cache_v1:abc123'])
      return { rows: [{ cache_key: 'score_cache_v1:abc123', hit_count: 2, last_used_at: new Date('2026-06-15T00:00:00Z') }] }
    },
  }

  const result = await markScoreCacheHit('score_cache_v1:abc123', db)

  assert.equal(result.updated, true)
  assert.equal(result.entry.hit_count, 2)
  assert.ok(result.entry.last_used_at)
})

test('no runtime analysis path imports storage service yet', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  let stdout = ''
  try {
    ;({ stdout } = await execFileAsync('rg', [
      '-n',
      'aiScoreCacheStorageService',
      'backend/src',
      '--glob',
      '!backend/src/services/aiScoreCacheStorageService.test.js',
      '--glob',
      '!backend/src/services/aiScoreCacheStorageService.js',
    ]))
  } catch (error) {
    if (error.code !== 1) throw error
    stdout = error.stdout || ''
  }

  assert.equal(stdout.trim(), '')
})
