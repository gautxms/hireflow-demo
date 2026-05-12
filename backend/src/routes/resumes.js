import { Router } from 'express'
import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'
import { sanitizeFilename } from '../utils/sanitize.js'

const router = Router()

const s3Bucket = process.env.AWS_S3_BUCKET
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
})

const DOC_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function resolveContentType(filename, mimeType, fileType) {
  const normalized = String(mimeType || fileType || '').trim().toLowerCase()
  if (normalized) {
    if (normalized === 'application/pdf') return normalized
    if (DOC_MIME_TYPES.has(normalized)) return normalized
  }

  const safeName = String(filename || '').toLowerCase()
  if (safeName.endsWith('.pdf')) return 'application/pdf'
  if (safeName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (safeName.endsWith('.doc')) return 'application/msword'
  return 'application/octet-stream'
}

router.get('/:resumeId/view', requireAuth, async (req, res) => {
  try {
    if (!s3Bucket) {
      return res.status(500).json({ error: 'Resume storage is not configured' })
    }

    const resumeId = String(req.params.resumeId || '').trim()
    if (!resumeId) {
      return res.status(400).json({ error: 'resumeId is required' })
    }

    const result = await pool.query(
      `SELECT r.filename,
              r.file_type,
              uc.mime_type,
              uc.assembled_s3_key,
              uc.status
       FROM resumes r
       INNER JOIN upload_chunks uc ON uc.resume_id = r.id
       WHERE r.id = $1
         AND r.user_id = $2
         AND uc.user_id = $2
         AND uc.status = 'completed'
       ORDER BY uc.updated_at DESC
       LIMIT 1`,
      [resumeId, req.userId],
    )

    const row = result.rows[0]
    if (!row) {
      return res.status(404).json({ error: 'Resume not found' })
    }

    const assembledS3Key = String(row.assembled_s3_key || '').trim()
    if (!assembledS3Key) {
      return res.status(404).json({ error: 'Original resume file is unavailable' })
    }

    const contentType = resolveContentType(row.filename, row.mime_type, row.file_type)
    const dispositionType = String(req.query.download || '').trim() === '1' ? 'attachment' : 'inline'
    const safeFilename = sanitizeFilename(row.filename || `${resumeId}.pdf`)

    const objectResult = await s3Client.send(new GetObjectCommand({
      Bucket: s3Bucket,
      Key: assembledS3Key,
    }))

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeFilename}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (objectResult.ContentLength != null) {
      res.setHeader('Content-Length', String(objectResult.ContentLength))
    }

    objectResult.Body.pipe(res)
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode
    if (error instanceof NoSuchKey || statusCode === 404 || error?.name === 'NoSuchKey') {
      return res.status(404).json({ error: 'Original resume file is missing from storage' })
    }

    console.error('[Resumes] Failed to stream resume file:', error)
    return res.status(500).json({ error: 'Unable to open resume file' })
  }
})

export default router
