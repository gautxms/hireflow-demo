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

test('upsert sanitizes direct unsafe metadata before DB write without mutating input', async () => {
  let capturedParams = null
  const db = {
    async query(sql, params) {
      capturedParams = params
      return { rows: [{ cache_key: params[0], metadata: JSON.parse(params[13]) }] }
    },
  }
  const input = {
    ...buildValidPayload(),
    metadata: {
      schema_version: 'ai_score_cache_storage_v1',
      resumeText: 'Jane Candidate jane@example.com 555-1212',
      jobDescription: 'Secret raw JD',
      filename: 'jane-resume.pdf',
      notes: 'Call Jane at 555-1212',
      rawProviderResponse: { text: 'raw model response' },
    },
  }

  await upsertScoreCacheEntry(input, db)

  const serializedParams = JSON.stringify(capturedParams)
  assert.equal(serializedParams.includes('Jane'), false)
  assert.equal(serializedParams.includes('jane@example.com'), false)
  assert.equal(serializedParams.includes('555-1212'), false)
  assert.equal(serializedParams.includes('Secret raw JD'), false)
  assert.equal(serializedParams.includes('jane-resume.pdf'), false)
  assert.equal(serializedParams.includes('rawProviderResponse'), false)
  assert.deepEqual(JSON.parse(capturedParams[13]), { schema_version: 'ai_score_cache_storage_v1' })
  assert.equal(input.metadata.resumeText, 'Jane Candidate jane@example.com 555-1212')
})

test('upsert sanitizes direct unsafe optional token fields before DB write', async () => {
  let capturedParams = null
  const db = {
    async query(sql, params) {
      capturedParams = params
      return { rows: [{ cache_key: params[0] }] }
    },
  }
  const input = {
    ...buildValidPayload(),
    canonical_score_source: 'Jane Candidate jane@example.com 555-1212',
    canonical_score_context: 'jane-resume.pdf',
    provider: 'anthropic-primary',
    model: 'claude-test',
    prompt_version: 'resume-score-v1',
    compact_mode: 'standard',
  }

  await upsertScoreCacheEntry(input, db)

  assert.equal(capturedParams[5], null)
  assert.equal(capturedParams[6], null)
  assert.equal(capturedParams[7], 'anthropic-primary')
  assert.equal(capturedParams[8], 'claude-test')
  assert.equal(capturedParams[9], 'resume-score-v1')
  assert.equal(capturedParams[10], 'standard')
  assert.equal(input.canonical_score_source, 'Jane Candidate jane@example.com 555-1212')
  assert.equal(input.canonical_score_context, 'jane-resume.pdf')
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
  const { readdir, readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const root = path.resolve('backend/src')
  const ignoredFiles = new Set([
    path.join(root, 'services/aiScoreCacheStorageService.js'),
    path.join(root, 'services/aiScoreCacheStorageService.test.js'),
  ])

  async function collectFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(entryPath)
      if (entry.isFile()) return [entryPath]
      return []
    }))

    return files.flat()
  }

  const references = []
  for (const file of await collectFiles(root)) {
    if (ignoredFiles.has(file)) continue

    const contents = await readFile(file, 'utf8')
    if (contents.includes('aiScoreCacheStorageService')) references.push(path.relative(root, file))
  }

  assert.deepEqual(references, [])
})
