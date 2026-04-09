import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { matchCandidatesToJob } from '../services/matchingService.js'

const router = Router()

router.post('/match', requireAuth, async (req, res) => {
  try {
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : []
    const jobDescriptionId = req.body?.jobDescriptionId ?? null
    const incomingJobDescription = req.body?.jobDescription || {}

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Candidates are required for matching' })
    }

    const matchPayload = matchCandidatesToJob({
      candidates,
      jobDescription: {
        ...incomingJobDescription,
        id: incomingJobDescription.id || jobDescriptionId || null,
      },
    })

    return res.json({
      jobDescriptionId,
      ...matchPayload,
    })
  } catch (error) {
    console.error('[Candidates] Failed to calculate candidate matches:', error)
    return res.status(500).json({ error: 'Unable to calculate candidate match scores' })
  }
})

export default router
