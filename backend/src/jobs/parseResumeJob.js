import { pool } from '../db/client.js'
import { cacheJobResult, parseQueue } from '../services/jobQueue.js'

function getMockCandidatesFromFilename(filename) {
  const seed = (filename || 'resume').toLowerCase()

  return [
    {
      id: `${seed}-1`,
      name: 'Sarah Chen',
      position: 'Senior Engineer',
      experience: '5 years',
      education: 'BS Computer Science, Stanford',
      score: 92,
      tier: 'top',
      fit: 'Excellent',
      skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
      pros: ['Strong technical background', 'Leadership experience', 'Excellent communication'],
      cons: ['May be overqualified'],
    },
    {
      id: `${seed}-2`,
      name: 'Marcus Johnson',
      position: 'Full Stack Developer',
      experience: '3 years',
      education: 'BS Information Technology, MIT',
      score: 78,
      tier: 'strong',
      fit: 'Strong',
      skills: ['React', 'Node.js', 'MongoDB', 'AWS'],
      pros: ['Quick learner', 'Team player', 'Good problem solver'],
      cons: ['Limited leadership experience'],
    },
    {
      id: `${seed}-3`,
      name: 'Elena Rodriguez',
      position: 'Backend Engineer',
      experience: '2 years',
      education: 'BS Computer Science, UC Berkeley',
      score: 68,
      tier: 'consider',
      fit: 'Good',
      skills: ['Node.js', 'Python', 'PostgreSQL', 'Docker'],
      pros: ['Strong backend skills', 'Quick learner'],
      cons: ['Less frontend experience', 'No AWS exposure'],
    },
  ]
}

async function setJobState(jobId, fields) {
  const columns = Object.keys(fields)
  const values = Object.values(fields)

  const setClause = columns.map((column, idx) => `${column} = $${idx + 2}`).join(', ')

  await pool.query(
    `UPDATE parse_jobs
     SET ${setClause}, updated_at = NOW()
     WHERE job_id = $1`,
    [String(jobId), ...values],
  )
}

async function runParse(job) {
  const { resumeId, filename, mimeType, fileSize, fileBufferBase64 } = job.data
  const startedAt = Date.now()

  await setJobState(job.id, {
    status: 'processing',
    progress: 10,
    attempts: job.attemptsMade,
  })

  await job.progress(10)

  if (!fileBufferBase64) {
    throw new Error('Resume payload is empty')
  }

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 45 })
  await job.progress(45)

  await new Promise((resolve) => setTimeout(resolve, 400))
  await setJobState(job.id, { progress: 75 })
  await job.progress(75)

  const fakeExtractedTextLength = Math.max(Math.floor((fileSize || 0) / 4), 250)
  const parseResult = {
    filename,
    mimeType,
    fileSize,
    parserVersion: 'bull-async-v1',
    extractedTextLength: fakeExtractedTextLength,
    candidates: getMockCandidatesFromFilename(filename),
  }

  const parseDurationMs = Date.now() - startedAt

  await pool.query(
    `UPDATE resumes
     SET parse_status = 'complete',
         parse_result = $2::jsonb,
         parse_error = NULL,
         parse_duration_ms = $3,
         updated_at = NOW(),
         raw_text = COALESCE(raw_text, '')
     WHERE id = $1`,
    [resumeId, JSON.stringify(parseResult), parseDurationMs],
  )

  await setJobState(job.id, {
    status: 'complete',
    progress: 100,
    result: JSON.stringify(parseResult),
    error_message: null,
    attempts: job.attemptsMade + 1,
  })

  await cacheJobResult(String(job.id), {
    status: 'complete',
    progress: 100,
    result: parseResult,
  })

  await job.progress(100)
  return parseResult
}

export function registerParseResumeJobProcessor() {
  parseQueue.process(async (job) => {
    try {
      return await runParse(job)
    } catch (error) {
      await pool.query(
        `UPDATE resumes
         SET parse_status = 'failed',
             parse_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [job.data.resumeId, error.message || 'Unknown parse error'],
      )

      await setJobState(job.id, {
        status: 'failed',
        progress: 100,
        error_message: error.message || 'Unknown parse error',
        attempts: job.attemptsMade + 1,
      })

      await cacheJobResult(String(job.id), {
        status: 'failed',
        progress: 100,
        result: null,
        error: error.message || 'Unknown parse error',
      })

      throw error
    }
  })

  console.log('[Queue] Parse resume worker registered')
}
