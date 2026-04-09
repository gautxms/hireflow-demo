import multer from 'multer'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { sanitizeFilename } from '../utils/sanitize.js'
import { enqueueParseJob } from '../services/jobQueue.js'
import { scanFileBuffer } from '../services/virusScanService.js'
import {
  enforceUploadLimit,
  requireActiveSubscription,
  trackUploadUsage,
} from '../middleware/subscriptionCheck.js'
import { generalApiLimiterAuth, uploadLimiter } from '../middleware/rateLimiter.js'

const router = Router()

const MAX_FILE_SIZE = 50 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only PDF and DOCX files are allowed'))
    }

    file.safeName = sanitizeFilename(file.originalname)
    return cb(null, true)
  },
})

async function ensureResumeParseColumns() {
  await pool.query(`
    ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS file_size BIGINT,
    ADD COLUMN IF NOT EXISTS file_type TEXT,
    ADD COLUMN IF NOT EXISTS parse_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS parse_result JSONB,
    ADD COLUMN IF NOT EXISTS parse_error TEXT,
    ADD COLUMN IF NOT EXISTS parse_duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS scan_status TEXT,
    ADD COLUMN IF NOT EXISTS scan_result JSONB,
    ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS job_description_id UUID,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `)
}

router.post(
  '/',
  requireAuth,
  generalApiLimiterAuth,
  requireActiveSubscription,
  enforceUploadLimit,
  uploadLimiter,
  (req, res, next) => {
    upload.array('resumes')(req, res, (error) => {
      if (!error) {
        return next()
      }

      console.warn('[Uploads] Validation failed', { message: error.message, ip: req.ip })

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Each file must be 50MB or smaller' })
      }

      return res.status(400).json({ error: error.message || 'Invalid file upload request' })
    })
  },
  trackUploadUsage,
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one resume file is required' })
    }

    try {
      await ensureResumeParseColumns()
      const selectedJobDescriptionId = req.body.jobDescriptionId || null

      if (selectedJobDescriptionId) {
        const jdResult = await pool.query(
          `SELECT id
           FROM job_descriptions
           WHERE id = $1
             AND user_id = $2
             AND status <> 'archived'
           LIMIT 1`,
          [selectedJobDescriptionId, req.userId],
        )

        if (!jdResult.rows[0]) {
          return res.status(400).json({ error: 'Selected job description is invalid or archived' })
        }
      }

      const jobs = []

      for (const file of req.files) {
        const scanResult = await scanFileBuffer(file.buffer, file.safeName)

        if (scanResult.malicious) {
          return res.status(400).json({
            error: `Upload rejected for ${file.safeName}: malware detected`,
            scan: scanResult,
          })
        }

        // Convert buffer once so it can be safely used in SQL and queue payloads.
        const fileBufferBase64 = file.buffer.toString('base64')

        const insertResult = await pool.query(
          `INSERT INTO resumes (
             user_id,
             filename,
             raw_text,
             file_size,
             file_type,
             parse_status,
             scan_status,
             scan_result,
             file_sha256,
             job_description_id,
             updated_at
           )
           VALUES ($1, $2, '', $3, $4, 'pending', $5, $6::jsonb, encode(digest(decode($7, 'base64'), 'sha256'), 'hex'), $8, NOW())
           RETURNING id`,
          [
            req.userId,
            file.safeName,
            file.size,
            file.mimetype,
            scanResult.status || 'clean',
            JSON.stringify(scanResult),
            fileBufferBase64,
            selectedJobDescriptionId,
          ],
        )

        const resumeId = insertResult.rows[0].id

        const job = await enqueueParseJob({
          resumeId,
          userId: req.userId,
          filename: file.safeName,
          mimeType: file.mimetype,
          fileSize: file.size,
          fileBufferBase64,
          jobDescriptionId: selectedJobDescriptionId,
        })

        jobs.push({
          jobId: String(job.id),
          resumeId,
          filename: file.safeName,
          type: file.mimetype,
          size: file.size,
        })
      }

      return res.status(202).json({
        ok: true,
        message: 'Resume parsing queued',
        jobId: jobs[0].jobId,
        jobs,
      })
    } catch (error) {
      console.error('[Uploads] Error queuing upload:', error)
      return res.status(500).json({ error: 'Unable to queue upload request' })
    }
  },
)

export default router
