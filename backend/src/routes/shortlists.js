import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { resolveCandidateResumeUuid } from '../utils/candidateIdentity.js'

const router = Router()

router.use(requireAuth)

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id,
              s.name,
              s.description,
              s.created_at,
              COUNT(sc.id)::int AS candidate_count
       FROM shortlists s
       LEFT JOIN shortlist_candidates sc ON sc.shortlist_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [req.userId],
    )

    return res.json({ shortlists: result.rows })
  } catch (error) {
    console.error('[Shortlists] Failed to list shortlists:', error)
    return res.status(500).json({ error: 'Unable to fetch shortlists' })
  }
})

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const description = req.body?.description ? String(req.body.description).trim() : null

  if (!name) {
    return res.status(400).json({ error: 'Shortlist name is required' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO shortlists (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, name, description, created_at`,
      [req.userId, name.slice(0, 120), description ? description.slice(0, 500) : null],
    )

    return res.status(201).json({ shortlist: result.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to create shortlist:', error)
    return res.status(500).json({ error: 'Unable to create shortlist' })
  }
})

router.get('/:id', async (req, res) => {
  const sortBy = String(req.query.sortBy || 'added_at')
  const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const orderByMap = {
    rating: `sc.rating ${sortOrder} NULLS LAST, sc.added_at DESC`,
    added_at: `sc.added_at ${sortOrder}`,
  }

  const orderByClause = orderByMap[sortBy] || orderByMap.added_at

  try {
    const shortlistResult = await pool.query(
      `SELECT id, user_id, name, description, created_at
       FROM shortlists
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [req.params.id, req.userId],
    )

    const shortlist = shortlistResult.rows[0]

    if (!shortlist) {
      return res.status(404).json({ error: 'Shortlist not found' })
    }

    const candidatesResult = await pool.query(
      `SELECT sc.id,
              sc.shortlist_id,
              sc.resume_id,
              sc.notes,
              sc.rating,
              sc.added_at,
              sc.analysis_id,
              sc.candidate_snapshot,
              sc.decision_status,
              sc.created_at,
              sc.updated_at,
              r.filename,
              r.created_at AS resume_created_at
       FROM shortlist_candidates sc
       INNER JOIN resumes r ON r.id = sc.resume_id
       WHERE sc.shortlist_id = $1
       ORDER BY ${orderByClause}`,
      [req.params.id],
    )

    return res.json({ shortlist, candidates: candidatesResult.rows })
  } catch (error) {
    console.error('[Shortlists] Failed to fetch shortlist details:', error)
    return res.status(500).json({ error: 'Unable to fetch shortlist details' })
  }
})

router.post('/:id/candidates', async (req, res) => {
  const resumeId = resolveCandidateResumeUuid(req.body?.resumeId)
    || resolveCandidateResumeUuid(req.body?.candidateId)
    || resolveCandidateResumeUuid(req.body)
  const notes = req.body?.notes ? String(req.body.notes).trim() : null
  const parsedRating = Number(req.body?.rating)
  const rating = Number.isInteger(parsedRating) ? parsedRating : null
  const analysisId = resolveCandidateResumeUuid(req.body?.analysisId) || null
  const candidateSnapshot = req.body?.candidateSnapshot && typeof req.body.candidateSnapshot === 'object'
    ? req.body.candidateSnapshot
    : null
  const decisionStatus = req.body?.decisionStatus ? String(req.body.decisionStatus).trim().slice(0, 64) : null

  if (!resumeId) {
    return res.status(400).json({ error: 'resumeId is required' })
  }

  if (rating !== null && (rating < 1 || rating > 5)) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' })
  }

  try {
    const ownershipAndResumeCheck = await pool.query(
      `SELECT
         EXISTS(
           SELECT 1
           FROM shortlists
           WHERE id = $1 AND user_id = $2
         ) AS shortlist_exists,
         EXISTS(
           SELECT 1
           FROM resumes
           WHERE id = $3 AND user_id = $2
         ) AS resume_exists`,
      [req.params.id, req.userId, resumeId],
    )
    const checks = ownershipAndResumeCheck.rows[0] || {}

    if (!checks.shortlist_exists) {
      return res.status(404).json({ error: 'Shortlist not found' })
    }

    if (!checks.resume_exists) {
      return res.status(404).json({ error: 'Resume not found for this user' })
    }

    const result = await pool.query(
      `INSERT INTO shortlist_candidates (
         shortlist_id,
         resume_id,
         notes,
         rating,
         analysis_id,
         candidate_snapshot,
         decision_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (shortlist_id, resume_id)
       DO UPDATE SET notes = EXCLUDED.notes,
                     rating = EXCLUDED.rating,
                     analysis_id = COALESCE(EXCLUDED.analysis_id, shortlist_candidates.analysis_id),
                     candidate_snapshot = COALESCE(EXCLUDED.candidate_snapshot, shortlist_candidates.candidate_snapshot),
                     decision_status = COALESCE(EXCLUDED.decision_status, shortlist_candidates.decision_status),
                     updated_at = NOW()
       RETURNING id, shortlist_id, resume_id, notes, rating, added_at, analysis_id, candidate_snapshot, decision_status, created_at, updated_at`,
      [
        req.params.id,
        resumeId,
        notes ? notes.slice(0, 1000) : null,
        rating,
        analysisId,
        candidateSnapshot,
        decisionStatus,
      ],
    )

    return res.status(201).json({ candidate: result.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to add candidate to shortlist:', error)
    return res.status(500).json({ error: 'Unable to add candidate to shortlist' })
  }
})

router.delete('/:id/candidates/:resumeId', async (req, res) => {
  try {
    const resolvedResumeId = resolveCandidateResumeUuid(req.params.resumeId) || String(req.params.resumeId || '').trim()
    const ownerCheck = await pool.query(
      `SELECT id FROM shortlists WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: 'Shortlist not found' })
    }

    const result = await pool.query(
      `DELETE FROM shortlist_candidates
       WHERE shortlist_id = $1 AND resume_id = $2
       RETURNING id`,
      [req.params.id, resolvedResumeId],
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Candidate not found in shortlist' })
    }

    return res.json({ ok: true })
  } catch (error) {
    console.error('[Shortlists] Failed to remove candidate from shortlist:', error)
    return res.status(500).json({ error: 'Unable to remove candidate from shortlist' })
  }
})

export default router
