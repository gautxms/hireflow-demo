import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import {
  enforceUploadLimit,
  requireActiveSubscription,
  trackUploadUsage,
} from '../middleware/subscriptionCheck.js'

const router = Router()

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

router.post(
  '/',
  requireAuth,
  requireActiveSubscription,
  enforceUploadLimit,
  trackUploadUsage,
  async (req, res) => {
    try {
      // TODO: Parse actual resume files using PDF.js or similar
      // For now, return mock candidates
      const mockCandidates = getMockCandidates()

      const usage = req.usageContext
      const used = (usage?.currentUsage || 0) + 1
      const limit = usage?.uploadLimit

      return res.status(200).json({
        ok: true,
        candidates: mockCandidates,
        usage: {
          used,
          limit,
          remaining: typeof limit === 'number' ? Math.max(limit - used, 0) : null,
        },
        message: 'Resumes analyzed successfully (using mock data for MVP)',
      })
    } catch (error) {
      console.error('[Uploads] Error processing upload:', error)
      return res.status(500).json({ error: 'Unable to process upload request' })
    }
  },
)

export default router
