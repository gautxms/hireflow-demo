import multer from 'multer'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sanitizeFilename } from '../utils/sanitize.js'
import {
  enforceUploadLimit,
  requireActiveSubscription,
  trackUploadUsage,
} from '../middleware/subscriptionCheck.js'
import { trackEvent } from '../services/analytics.js'

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

const getMockCandidates = () => [
  { id: '1', name: 'Sarah Chen', score: 92, tier: 'top' },
  { id: '2', name: 'Marcus Johnson', score: 78, tier: 'strong' },
  { id: '3', name: 'Elena Rodriguez', score: 68, tier: 'consider' },
]

router.post(
  '/',
  requireAuth,
  requireActiveSubscription,
  enforceUploadLimit,
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
  async (req, res, next) => {
    await trackEvent({
      userId: req.userId,
      eventType: 'upload_start',
      metadata: {
        file_count: Array.isArray(req.files) ? req.files.length : 0,
      },
    })

    return next()
  },
  trackUploadUsage,
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one resume file is required' })
    }

    try {
      const acceptedFiles = req.files.map((file) => ({
        name: file.safeName,
        type: file.mimetype,
        size: file.size,
      }))

      const parseSucceeded = true

      await trackEvent({
        userId: req.userId,
        eventType: 'upload_complete',
        metadata: {
          file_count: acceptedFiles.length,
          file_types: [...new Set(acceptedFiles.map((file) => file.type))],
        },
      })

      await trackEvent({
        userId: req.userId,
        eventType: parseSucceeded ? 'parse_success' : 'parse_fail',
        metadata: {
          parser: 'mock_mvp',
          file_count: acceptedFiles.length,
        },
      })

      return res.status(200).json({
        ok: true,
        acceptedFiles,
        candidates: getMockCandidates(),
        message: 'Resumes analyzed successfully (using mock data for MVP)',
      })
    } catch (error) {
      console.error('[Uploads] Error processing upload:', error)
      await trackEvent({
        userId: req.userId,
        eventType: 'parse_fail',
        metadata: { parser: 'mock_mvp', reason: 'server_error' },
      })
      return res.status(500).json({ error: 'Unable to process upload request' })
    }
  },
)

export default router
