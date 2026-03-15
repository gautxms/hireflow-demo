import multer from 'multer'
import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { sanitizeFilename } from '../utils/sanitize.js'
import { requireAuth } from '../middleware/auth.js'
import {
  enforceUploadLimit,
  requireActiveSubscription,
  trackUploadUsage,
} from '../middleware/subscriptionCheck.js'

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

// Mock candidate data for MVP
const getMockCandidates = () => [
  {
    id: '1',
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
    id: '2',
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
    id: '3',
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

router.post('/', requireAuth, (req, res, next) => {
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
}, async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'At least one resume file is required' })
  }

  try {
    const userResult = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [req.userId],
    )

      const usage = req.usageContext
      const used = (usage?.currentUsage || 0) + 1
      const limit = usage?.uploadLimit

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (user.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'Subscription required',
        message: 'Your trial has expired or subscription is inactive. Please upgrade to continue.',
      })
    } catch (error) {
      console.error('[Uploads] Error processing upload:', error)
      return res.status(500).json({ error: 'Unable to process upload request' })
    }

    const acceptedFiles = req.files.map((file) => ({
      name: file.safeName,
      type: file.mimetype,
      size: file.size,
    }))

    const mockCandidates = getMockCandidates()

    return res.status(200).json({
      ok: true,
      acceptedFiles,
      candidates: mockCandidates,
      message: 'Resumes analyzed successfully (using mock data for MVP)',
    })
  } catch (error) {
    console.error('[Uploads] Error processing upload:', error)
    return res.status(500).json({ error: 'Unable to process upload request' })
  }
})

export default router
