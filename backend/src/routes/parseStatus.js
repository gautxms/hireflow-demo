import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'
import { getCachedJobResult, parseQueue } from '../services/jobQueue.js'
import { normalizeParseStatus } from '../services/parseStatusMapper.js'

export { normalizeParseStatus } from '../services/parseStatusMapper.js'

const router = Router()

router.get('/:id/parse-status', requireAuth, async (req, res) => {
  const { id } = req.params

  try {
    const jobRowResult = await pool.query(
      `SELECT job_id, status, progress, result, error_message, resume_id, user_id
       FROM parse_jobs
       WHERE job_id = $1
       LIMIT 1`,
      [id],
    )

    const jobRow = jobRowResult.rows[0]

    if (!jobRow || Number(jobRow.user_id) !== Number(req.userId)) {
      return res.status(404).json({ error: 'Parse job not found' })
    }

    const cached = await getCachedJobResult(id)
    if (cached) {
      return res.json({
        ...cached,
        jobId: String(jobRow.job_id || id),
        resumeId: String(jobRow.resume_id || ''),
      })
    }

    const queueJob = await parseQueue.getJob(id)

    const status = queueJob ? await queueJob.getState() : jobRow.status
    const normalizedStatus = normalizeParseStatus(status, jobRow.status)

    const responsePayload = {
      jobId: String(jobRow.job_id || id),
      resumeId: String(jobRow.resume_id || ''),
      status: normalizedStatus,
      progress: Number(jobRow.progress || (queueJob ? queueJob.progress() : 0) || 0),
      result: jobRow.result || null,
      error: jobRow.error_message || null,
    }

    return res.json(responsePayload)
  } catch (error) {
    console.error('[ParseStatus] Failed to fetch parse status:', error)
    return res.status(500).json({ error: 'Unable to fetch parse status' })
  }
})

export default router
