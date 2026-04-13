import { Router } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { matchCandidatesToJob } from '../services/matchingService.js'
import { pool } from '../db/client.js'
import { normalizeTags } from './candidateTagsState.js'

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

router.post('/tags/bulk', requireAuth, async (req, res) => {
  const operation = ['add', 'remove', 'replace'].includes(req.body?.operation) ? req.body.operation : null
  const tags = normalizeTags(req.body?.tags)
  const resumeIds = [...new Set((Array.isArray(req.body?.resumeIds) ? req.body.resumeIds : []).map((id) => String(id || '').trim()).filter(Boolean))]

  if (!operation) {
    return res.status(400).json({ error: 'operation must be add, remove, or replace' })
  }

  if (resumeIds.length === 0) {
    return res.status(400).json({ error: 'resumeIds are required' })
  }

  try {
    const ownerCheck = await pool.query(
      `SELECT id
       FROM resumes
       WHERE user_id = $1
         AND id = ANY($2::uuid[])`,
      [req.userId, resumeIds],
    )
    const allowedResumeIds = ownerCheck.rows.map((row) => row.id)

    if (allowedResumeIds.length === 0) {
      return res.status(404).json({ error: 'No matching resumes found for this user' })
    }

    if (operation === 'replace') {
      await pool.query(
        `DELETE FROM candidate_tags
         WHERE user_id = $1
           AND resume_id = ANY($2::uuid[])`,
        [req.userId, allowedResumeIds],
      )
    }

    if (operation === 'remove') {
      await pool.query(
        `DELETE FROM candidate_tags
         WHERE user_id = $1
           AND resume_id = ANY($2::uuid[])
           AND tag = ANY($3::text[])`,
        [req.userId, allowedResumeIds, tags],
      )
    } else if (tags.length > 0) {
      await pool.query(
        `INSERT INTO candidate_tags (user_id, resume_id, tag)
         SELECT $1, resume_id, tag_value
         FROM unnest($2::uuid[]) AS resume_id
         CROSS JOIN unnest($3::text[]) AS tag_value
         ON CONFLICT (user_id, resume_id, tag) DO NOTHING`,
        [req.userId, allowedResumeIds, tags],
      )
    }

    const result = await pool.query(
      `SELECT resume_id, array_agg(tag ORDER BY tag) AS tags
       FROM candidate_tags
       WHERE user_id = $1
         AND resume_id = ANY($2::uuid[])
       GROUP BY resume_id`,
      [req.userId, allowedResumeIds],
    )

    return res.json({
      resumeTags: result.rows,
      updatedCount: allowedResumeIds.length,
    })
  } catch (error) {
    console.error('[Candidates] Failed to mutate tags:', error)
    return res.status(500).json({ error: 'Unable to update candidate tags' })
  }
})

export default router
