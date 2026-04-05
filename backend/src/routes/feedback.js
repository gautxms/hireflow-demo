import { Router } from 'express'
import { pool } from '../db/client.js'
import { analyzeCommentSentiment, trackFeedbackSubmitted } from '../services/analytics.js'

const router = Router()

const ALLOWED_FEEDBACK_TYPES = new Set([
  'helpful',
  'unhelpful',
  'flag_false_positive',
  'flag_missing',
])

function normalizeComment(input) {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 1000)
}

router.post('/', async (req, res) => {
  const userId = req.userId
  const { candidateId, feedbackType, comment } = req.body || {}

  if (!candidateId || typeof candidateId !== 'string') {
    return res.status(400).json({ error: 'candidateId is required' })
  }

  if (!ALLOWED_FEEDBACK_TYPES.has(feedbackType)) {
    return res.status(400).json({ error: 'Invalid feedbackType' })
  }

  const normalizedCandidateId = candidateId.trim()

  if (!normalizedCandidateId) {
    return res.status(400).json({ error: 'candidateId is required' })
  }

  const safeComment = normalizeComment(comment)
  const sentiment = analyzeCommentSentiment(safeComment)

  try {
    const result = await pool.query(
      `INSERT INTO candidate_feedback (user_id, candidate_id, feedback_type, comment, sentiment_label, sentiment_score)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, candidate_id, feedback_date) DO NOTHING
       RETURNING id, user_id, candidate_id, feedback_type, comment, sentiment_label, sentiment_score, created_at`,
      [userId, normalizedCandidateId, feedbackType, safeComment, sentiment.label, sentiment.score],
    )

    if (!result.rowCount) {
      return res.status(429).json({
        error: 'Feedback already submitted for this candidate today',
        code: 'FEEDBACK_RATE_LIMITED',
      })
    }

    const row = result.rows[0]

    await trackFeedbackSubmitted({
      userId,
      candidateId: row.candidate_id,
      feedbackType: row.feedback_type,
      comment: row.comment,
      sentimentLabel: row.sentiment_label,
      sentimentScore: row.sentiment_score,
    })

    return res.status(201).json({ feedback: row })
  } catch (error) {
    console.error('[Feedback] Failed to submit feedback', error)
    return res.status(500).json({ error: 'Unable to submit feedback' })
  }
})

export default router
