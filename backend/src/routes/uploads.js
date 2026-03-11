import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'

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

router.post('/', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [req.userId]
    )

    const user = userResult.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Check subscription status - return 403 if not active
    if (user.subscription_status !== 'active') {
      return res.status(403).json({
        error: 'Subscription required',
        message: 'Your trial has expired or subscription is inactive. Please upgrade to continue.',
      })
    }

    // TODO: Parse actual resume files using PDF.js or similar
    // For now, return mock candidates
    const mockCandidates = getMockCandidates()

    return res.status(200).json({ 
      ok: true,
      candidates: mockCandidates,
      message: 'Resumes analyzed successfully (using mock data for MVP)',
    })
  } catch (error) {
    console.error('[Uploads] Error processing upload:', error)
    return res.status(500).json({ error: 'Unable to process upload request' })
  }
})

export default router
