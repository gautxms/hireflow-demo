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
import {
  isAcceptedResumeUpload as isAcceptedResumeFile,
  resolveEffectiveMimeType as resolveMimeFromUpload,
} from '../utils/fileMime.js'

const router = Router()

const MAX_FILE_SIZE = 50 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAcceptedResumeFile(file.mimetype, file.originalname)) {
      return cb(new Error('Only PDF, DOCX, and TXT files are allowed'))
    }

    file.safeName = sanitizeFilename(file.originalname)
    file.mimetype = resolveMimeFromUpload(file.mimetype, file.originalname) || file.mimetype
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

      const userId = req.user.id
      const requestedJobDescriptionId = req.body?.jobDescriptionId ? String(req.body.jobDescriptionId) : null

      if (requestedJobDescriptionId) {
        const ownershipCheck = await pool.query(
          `SELECT id
           FROM job_descriptions
           WHERE id = $1 AND user_id = $2`,
          [requestedJobDescriptionId, userId],
        )

        if (ownershipCheck.rowCount === 0) {
          return res.status(404).json({ error: 'Job description not found' })
        }
      }

      const analysisInsert = await pool.query(
        `INSERT INTO analyses (user_id, job_description_id, status)
         VALUES ($1, $2, 'processing')
         RETURNING id`,
        [userId, requestedJobDescriptionId],
      )
      analysisId = analysisInsert.rows[0].id

      const uploadResults = []

      for (const file of req.files) {
        const safeName = file.safeName || sanitizeFilename(file.originalname)
        const effectiveMimeType = resolveMimeFromUpload(file.mimetype, file.originalname) || file.mimetype

        const scanResult = await scanFileBuffer(file.buffer, {
          filename: safeName,
          mimetype: effectiveMimeType,
          userId,
          analysisId,
        })

        if (!scanResult.ok) {
          uploadResults.push({
            filename: safeName,
            status: 'failed',
            reason: scanResult.reason || 'Scan failed',
          })
          continue
        }

        const resumeInsert = await pool.query(
          `INSERT INTO resumes
            (user_id, file_name, file_size, file_type, parse_status, scan_status, scan_result, file_sha256, uploaded_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, NOW())
           RETURNING id`,
          [
            userId,
            safeName,
            Number(file.size || 0),
            effectiveMimeType,
            scanResult.status || 'clean',
            scanResult.details ? JSON.stringify(scanResult.details) : null,
            scanResult.sha256 || null,
          ],
        )

        const resumeId = resumeInsert.rows[0].id
        const parseJob = await enqueueParseJob({
          resumeId,
          userId,
          filename: safeName,
          mimetype: effectiveMimeType,
          fileBuffer: file.buffer,
          analysisId,
          jobDescriptionId: requestedJobDescriptionId,
        })

        await pool.query(
          `INSERT INTO analysis_items (analysis_id, resume_id, parse_job_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (analysis_id, resume_id) DO NOTHING`,
          [analysisId, resumeId, parseJob.jobId],
        )

        uploadResults.push({
          filename: safeName,
          status: 'queued',
          resumeId,
          parseJobId: parseJob.jobId,
        })
      }

      const failedCount = uploadResults.filter((result) => result.status === 'failed').length
      const queuedCount = uploadResults.filter((result) => result.status === 'queued').length

      if (analysisId) {
        const nextStatus = queuedCount > 0 ? 'processing' : 'failed'
        const errorSummary = failedCount > 0 && queuedCount === 0
          ? 'All uploads failed validation or scanning.'
          : null

        await pool.query(
          `UPDATE analyses
           SET status = $2,
               error_summary = $3
           WHERE id = $1`,
          [analysisId, nextStatus, errorSummary],
        )
      }

      return res.status(202).json({
        analysisId,
        queued: queuedCount,
        failed: failedCount,
        results: uploadResults,
      })
    } catch (error) {
      console.error('[Uploads] Failed to enqueue upload batch', error)

      if (analysisId) {
        await pool.query(
          `UPDATE analyses
           SET status = 'failed',
               error_summary = $2
           WHERE id = $1`,
          [analysisId, error.message || 'Upload processing failed'],
        )
      }

      return res.status(500).json({ error: 'Failed to process upload batch' })
    }
  },
)

export default router
