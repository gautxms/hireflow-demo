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
    ADD COLUMN IF NOT EXISTS years_experience INTEGER,
    ADD COLUMN IF NOT EXISTS profile_score INTEGER,
    ADD COLUMN IF NOT EXISTS strengths JSONB,
    ADD COLUMN IF NOT EXISTS considerations JSONB,
    ADD COLUMN IF NOT EXISTS seniority_level TEXT,
    ADD COLUMN IF NOT EXISTS tags JSONB,
    ADD COLUMN IF NOT EXISTS top_skills JSONB,
    ADD COLUMN IF NOT EXISTS skills_structured JSONB,
    ADD COLUMN IF NOT EXISTS skills JSONB,
    ADD COLUMN IF NOT EXISTS scan_status TEXT,
    ADD COLUMN IF NOT EXISTS scan_result JSONB,
    ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS job_description_id UUID,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `)
}

async function ensureAnalysisTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analyses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      error_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS analysis_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
      parse_job_id TEXT REFERENCES parse_jobs(job_id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (analysis_id, resume_id)
    );

    CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_job_description_id ON analyses(job_description_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
    CREATE INDEX IF NOT EXISTS idx_analysis_items_analysis_id ON analysis_items(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_items_resume_id ON analysis_items(resume_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_items_parse_job_id ON analysis_items(parse_job_id);
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

    let analysisId = null

    try {
      await ensureResumeParseColumns()
      await ensureAnalysisTables()
      const selectedJobDescriptionId = req.body.jobDescriptionId || null
      console.log(
        '[HireFlow] JD received at endpoint:',
        selectedJobDescriptionId ? `${String(selectedJobDescriptionId).slice(0, 80)}...` : 'NONE',
      )

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
      const analysisResult = await pool.query(
        `INSERT INTO analyses (user_id, job_description_id, status)
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [req.userId, selectedJobDescriptionId],
      )
      analysisId = analysisResult.rows[0].id

      for (const file of req.files) {
        const scanResult = await scanFileBuffer(file.buffer, file.safeName)

        if (scanResult.malicious) {
          return res.status(400).json({
            error: `Upload rejected for ${file.safeName}: malware detected`,
            scan: scanResult,
          })
        }

        // Convert buffer once so binary bytes are UTF-8 safe for SQL parameters.
        const fileBufferBase64 = file.buffer.toString('base64')
        const scanResultJson = JSON.stringify(scanResult)

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
            scanResultJson,
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

        await pool.query(
          `INSERT INTO analysis_items (analysis_id, resume_id, parse_job_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (analysis_id, resume_id)
           DO UPDATE SET parse_job_id = EXCLUDED.parse_job_id`,
          [analysisId, resumeId, String(job.id)],
        )
      }

      return res.status(202).json({
        ok: true,
        message: 'Resume parsing queued',
        analysisId,
        jobId: jobs[0].jobId,
        jobs,
      })
    } catch (error) {
      console.error('[Uploads] Error queuing upload:', error)

      if (analysisId) {
        await pool.query(
          `UPDATE analyses
           SET status = 'failed',
               completed_at = NOW(),
               error_summary = $2
           WHERE id = $1`,
          [analysisId, error.message?.slice(0, 500) || 'Unable to queue upload request'],
        )
      }

      return res.status(500).json({ error: 'Unable to queue upload request' })
    }
  },
)

export default router
