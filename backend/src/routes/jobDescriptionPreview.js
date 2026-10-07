import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { requireActiveSubscription } from '../middleware/subscriptionCheck.js'
import {
  JobDescriptionPreviewError,
  MAX_JD_PREVIEW_FILE_BYTES,
  previewJobDescription,
} from '../services/jobDescriptionPreviewService.js'

const router = Router()

const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId),
  message: { code: 'JD_PREVIEW_RATE_LIMITED', error: 'Too many extraction requests. Try again in 15 minutes.' },
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_JD_PREVIEW_FILE_BYTES, files: 1 },
})

router.post('/preview', requireActiveSubscription, previewLimiter, (req, res, next) => {
  upload.single('jdFile')(req, res, (error) => {
    if (!error) return next()
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ code: 'JD_FILE_TOO_LARGE', error: 'JD file must be 20MB or smaller.' })
    }
    return res.status(400).json({ code: 'JD_INVALID_UPLOAD', error: 'Upload one PDF or DOCX job description.' })
  })
}, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const preview = await previewJobDescription(req.file)
    return res.json(preview)
  } catch (error) {
    if (error instanceof JobDescriptionPreviewError) {
      return res.status(error.status).json({ code: error.code, error: error.message })
    }
    console.error('[JobDescriptionPreview] extraction failed:', { code: error?.code || error?.name || 'UNKNOWN_ERROR' })
    return res.status(503).json({ code: 'JD_EXTRACTION_UNAVAILABLE', error: 'Automatic extraction is temporarily unavailable. You can enter the job details manually.' })
  }
})

export default router
