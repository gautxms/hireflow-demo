import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAnalysisDetailPayload,
  loadAnalysisReadModel,
} from './analysisReadModelService.js'
import { getMcpAnalysisResults } from './mcpHireFlowReadService.js'

function createParityDb() {
  const analysis = {
    id: 'analysis-parity',
    user_id: 42,
    name: 'Parity batch',
    status: 'failed',
    created_at: '2026-10-29T00:00:00.000Z',
    completed_at: '2026-10-29T00:01:00.000Z',
    job_description_id: 'job-42',
    job_description_title: 'Job title Customer Success Manager',
  }
  const items = [
    {
      id: 'item-lower',
      resume_id: 'resume-lower',
      original_filename: 'Lower.pdf',
      parse_job_status: 'complete',
      progress: 100,
      parse_result: { candidates: [{ id: 'lower', name: 'Lower Score', matchScore: { score: 68 } }] },
    },
    {
      id: 'item-higher',
      resume_id: 'resume-higher',
      original_filename: 'Higher.docx',
      parse_job_status: 'complete',
      progress: 100,
      parse_result: JSON.stringify({ output: JSON.stringify({ candidates: [{ id: 'higher', name: 'Higher Score', matchScore: { score: 91 } }] }) }),
    },
  ]
  const uploads = [{
    upload_id: 'upload-failed',
    filename: 'Failed.pdf',
    mime_type: 'application/pdf',
    status: 'rejected',
    updated_at: '2026-10-29T00:00:30.000Z',
  }]

  return {
    async query(sql, params) {
      const text = String(sql)
      if (text.includes('FROM analyses a')) {
        assert.match(text, /a\.id = \$1 AND a\.user_id = \$2/)
        assert.deepEqual(params, ['analysis-parity', 42])
        return { rows: [analysis] }
      }
      if (text.includes('FROM upload_chunks uc')) return { rows: uploads }
      if (text.includes('FROM analysis_items ai')) return { rows: items }
      if (text.includes('UPDATE analyses')) return { rows: [] }
      throw new Error(`Unexpected query: ${text}`)
    },
  }
}

test('web detail and MCP results share one owner-scoped analysis read model', async () => {
  const webReadModel = await loadAnalysisReadModel({
    db: createParityDb(),
    userId: 42,
    analysisId: 'analysis-parity',
    queue: null,
    now: new Date('2026-10-29T00:02:00.000Z'),
  })
  const webPayload = buildAnalysisDetailPayload(webReadModel)
  const mcpPayload = await getMcpAnalysisResults({
    db: createParityDb(),
    userId: 42,
    analysisId: 'analysis-parity',
    queue: null,
  })

  const webCandidates = webPayload.items.flatMap((item) => item.normalizedCandidates)
  assert.deepEqual(webCandidates.map((candidate) => candidate.name), ['Lower Score', 'Higher Score'])
  assert.deepEqual(webCandidates.map((candidate) => candidate.matchScore.score), [68, 91])
  assert.deepEqual(mcpPayload.candidates.map((candidate) => candidate.name), ['Higher Score', 'Lower Score'])
  assert.deepEqual(mcpPayload.candidates.map((candidate) => candidate.score), [91, 68])
  assert.deepEqual(mcpPayload.counts, {
    total: webPayload.summary.total,
    complete: webPayload.summary.complete,
    failed: webPayload.summary.failed,
    processing: webPayload.summary.processing,
    queued: webPayload.summary.pending,
  })
  assert.deepEqual(mcpPayload.job, { id: 'job-42', title: webPayload.jobDescriptionTitle })
  assert.deepEqual(mcpPayload.failures, [{ filename: 'Failed.pdf', reason: 'HireFlow could not analyse this resume.' }])
})

test('analysis read model rejects a row outside the requested owner', async () => {
  const db = {
    async query(sql) {
      if (String(sql).includes('FROM analyses a')) {
        return { rows: [{ id: 'analysis-other', user_id: 99 }] }
      }
      throw new Error('No further query should run for a cross-owner row')
    },
  }

  const result = await loadAnalysisReadModel({
    db,
    userId: 42,
    analysisId: 'analysis-other',
    queue: null,
  })
  assert.equal(result, null)
})
