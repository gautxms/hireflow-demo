import test from 'node:test'
import assert from 'node:assert/strict'

import { pool } from '../db/client.js'
import { syncCandidateProfilesForUser } from './candidateProfilesService.js'

const originalQuery = pool.query.bind(pool)

test.afterEach(() => {
  pool.query = originalQuery
})

test('syncCandidateProfilesForUser stamps resume-sourced profile with resume provenance', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim()
    calls.push({ sql, params })

    if (sql.startsWith('SELECT r.id AS resume_id')) {
      return {
        rows: [
          {
            resume_id: 'resume-1',
            resume_parse_result: { candidates: [{ full_name: 'Resume Candidate' }] },
            resume_updated_at: '2026-04-25T12:00:00.000Z',
            source_parse_job_id: 'parse-job-older',
            parse_job_result: { candidates: [{ full_name: 'Parse Job Candidate' }] },
            parse_job_updated_at: '2026-04-20T12:00:00.000Z',
          },
        ],
      }
    }

    if (sql.startsWith('INSERT INTO candidate_profiles')) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in candidateProfilesService.test: ${sql}`)
  }

  await syncCandidateProfilesForUser('user-1')

  const insertCall = calls.find((entry) => entry.sql.startsWith('INSERT INTO candidate_profiles'))
  assert.ok(insertCall, 'expected upsert query to run')
  assert.equal(insertCall.params[3], null)
  assert.equal(new Date(insertCall.params[4]).toISOString(), '2026-04-25T12:00:00.000Z')
})

test('syncCandidateProfilesForUser deletes snapshot when no profile can be resolved', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim()
    calls.push({ sql, params })

    if (sql.startsWith('SELECT r.id AS resume_id')) {
      return {
        rows: [
          {
            resume_id: 'resume-2',
            resume_parse_result: { candidates: [] },
            resume_updated_at: '2026-04-25T12:00:00.000Z',
            source_parse_job_id: 'parse-job-1',
            parse_job_result: { candidates: [] },
            parse_job_updated_at: '2026-04-24T12:00:00.000Z',
          },
        ],
      }
    }

    if (sql.startsWith('DELETE FROM candidate_profiles')) {
      return { rowCount: 1, rows: [] }
    }

    throw new Error(`Unexpected SQL in candidateProfilesService.test: ${sql}`)
  }

  const syncedCount = await syncCandidateProfilesForUser('user-2')

  assert.equal(syncedCount, 0)
  const deleteCall = calls.find((entry) => entry.sql.startsWith('DELETE FROM candidate_profiles'))
  assert.ok(deleteCall, 'expected delete query to run for stale snapshot cleanup')
  assert.deepEqual(deleteCall.params, ['user-2', 'resume-2'])
  const insertCall = calls.find((entry) => entry.sql.startsWith('INSERT INTO candidate_profiles'))
  assert.equal(insertCall, undefined)
})

test('syncCandidateProfilesForUser prefers strongest completeness signal when candidate array is heterogeneous', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim()
    calls.push({ sql, params })

    if (sql.startsWith('SELECT r.id AS resume_id')) {
      return {
        rows: [
          {
            resume_id: 'resume-3',
            resume_parse_result: {
              candidates: [
                { notes: 'no useful fields' },
                { full_name: 'Strong Candidate', experience: '6 years' },
                { skills: ['Node.js'] },
              ],
            },
            resume_updated_at: '2026-04-26T12:00:00.000Z',
            source_parse_job_id: null,
            parse_job_result: { candidates: [] },
            parse_job_updated_at: null,
          },
        ],
      }
    }

    if (sql.startsWith('INSERT INTO candidate_profiles')) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in candidateProfilesService.test: ${sql}`)
  }

  await syncCandidateProfilesForUser('user-3')

  const insertCall = calls.find((entry) => entry.sql.startsWith('INSERT INTO candidate_profiles'))
  assert.ok(insertCall, 'expected upsert query to run')
  assert.equal(JSON.parse(insertCall.params[2]).full_name, 'Strong Candidate')
})

test('syncCandidateProfilesForUser keeps first candidate for backward compatibility when completeness signal ties', async () => {
  const calls = []

  pool.query = async (queryText, params = []) => {
    const sql = String(queryText).trim()
    calls.push({ sql, params })

    if (sql.startsWith('SELECT r.id AS resume_id')) {
      return {
        rows: [
          {
            resume_id: 'resume-4',
            resume_parse_result: {
              candidates: [
                { full_name: 'First Candidate', experience: '5 years' },
                { full_name: 'Second Candidate', skills: ['React'] },
              ],
            },
            resume_updated_at: '2026-04-26T12:00:00.000Z',
            source_parse_job_id: null,
            parse_job_result: { candidates: [] },
            parse_job_updated_at: null,
          },
        ],
      }
    }

    if (sql.startsWith('INSERT INTO candidate_profiles')) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in candidateProfilesService.test: ${sql}`)
  }

  await syncCandidateProfilesForUser('user-4')

  const insertCall = calls.find((entry) => entry.sql.startsWith('INSERT INTO candidate_profiles'))
  assert.ok(insertCall, 'expected upsert query to run')
  assert.equal(JSON.parse(insertCall.params[2]).full_name, 'First Candidate')
})
