import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { dashboardMatchScoreRowsSql } from './profile.js'

const connectionString = process.env.DASHBOARD_POSTGRES_TEST_DATABASE_URL

test('dashboard averages the saved job match score for each analysis item', {
  skip: !connectionString,
}, async () => {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query(`CREATE TEMP TABLE parse_jobs (
      job_id TEXT PRIMARY KEY,
      user_id INTEGER,
      status TEXT,
      result JSONB
    )`)
    await client.query(`INSERT INTO parse_jobs (job_id, user_id, status, result) VALUES
      ('job87', 52, 'complete', '{"candidates":[{"matchScore":{"score":87},"score":78,"profile_score":78}]}'),
      ('job63', 52, 'complete', '{"candidates":[{"matchScore":{"score":63},"profile_score":78}]}'),
      ('jobZero', 52, 'complete', '{"output":{"candidates":[{"matchScore":{"score":"invalid"},"score":0,"profile_score":99}]}}'),
      ('otherUser', 53, 'complete', '{"candidates":[{"matchScore":{"score":100}}]}'),
      ('failedJob', 52, 'failed', '{"candidates":[{"matchScore":{"score":100}}]}')`)

    const rows = await client.query(`WITH analysis_window AS (
      SELECT * FROM (VALUES
        ('resume-1', TIMESTAMP '2026-10-07 08:00:00', 'complete', 'role-1', 'job87'),
        ('resume-1', TIMESTAMP '2026-10-08 08:00:00', 'complete', 'role-2', 'job63'),
        ('resume-2', TIMESTAMP '2026-10-08 09:00:00', 'complete', 'role-2', 'jobZero'),
        ('resume-3', TIMESTAMP '2026-10-08 10:00:00', 'complete', NULL, 'job87'),
        ('resume-4', TIMESTAMP '2026-10-08 11:00:00', 'failed', 'role-1', 'job87'),
        ('resume-5', TIMESTAMP '2026-10-08 12:00:00', 'complete', 'role-1', 'otherUser'),
        ('resume-6', TIMESTAMP '2026-10-08 13:00:00', 'complete', 'role-1', 'failedJob')
      ) AS items(resume_id, created_at, status, job_description_id, parse_job_id)
    ), completed_scored_item_window AS (
      ${dashboardMatchScoreRowsSql('analysis_window')}
    )
    SELECT resume_id, score, created_at
    FROM completed_scored_item_window
    ORDER BY created_at`, [52])

    assert.deepEqual(rows.rows.map((row) => [row.resume_id, Number(row.score)]), [
      ['resume-1', 87],
      ['resume-1', 63],
      ['resume-2', 0],
    ])
    assert.equal(rows.rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.rowCount, 50)
  } finally {
    await client.end()
  }
})

test('one legacy numeric matchScore wins over a different profile score', {
  skip: !connectionString,
}, async () => {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query(`CREATE TEMP TABLE parse_jobs (
      job_id TEXT PRIMARY KEY, user_id INTEGER, status TEXT, result JSONB
    )`)
    await client.query(`INSERT INTO parse_jobs (job_id, user_id, status, result)
      VALUES ('one-job', 52, 'complete',
        '{"candidates":[{"matchScore":86.8,"score":78,"profile_score":78}]}')`)

    const result = await client.query(`WITH analysis_window AS (
      SELECT 'analysis-one' AS id, 'one-resume' AS resume_id, TIMESTAMP '2026-10-07 08:00:00' AS created_at,
             'complete' AS status, 'one-role' AS job_description_id, 'one-job' AS parse_job_id
    ), completed_scored_item_window AS (
      ${dashboardMatchScoreRowsSql('analysis_window')}
    )
    SELECT ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*)::int AS scored_count
    FROM completed_scored_item_window`, [52])

    assert.equal(Number(result.rows[0].avg_score), 86.8)
    assert.equal(result.rows[0].scored_count, 1)
  } finally {
    await client.end()
  }
})
