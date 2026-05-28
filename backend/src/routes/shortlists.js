import { Router } from 'express'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authMiddleware.js'
import { resolveCandidateResumeUuid } from '../utils/candidateIdentity.js'

const router = Router()

router.use(requireAuth)

function normalizeBatchResumeIds(input) {
  const list = Array.isArray(input) ? input : []
  const unique = new Set()

  for (const value of list) {
    const resolved = resolveCandidateResumeUuid(value)
      || resolveCandidateResumeUuid(value?.resumeId)
      || resolveCandidateResumeUuid(value?.candidateId)
      || String(value || '').trim()

    if (resolved) {
      unique.add(resolved)
    }
  }

  return [...unique]
}

function normalizeJobDescriptionId(input) {
  if (input === null || input === undefined) return null
  const value = String(input).trim()
  if (!value) return null
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidPattern.test(value) ? value.toLowerCase() : null
}

router.get('/', async (req, res) => {
  const includeArchived = String(req.query.includeArchived || 'false').toLowerCase() === 'true'
  try {
    const result = await pool.query(
      `SELECT s.id,
              s.name,
              s.description,
              s.status,
              s.created_at,
              s.job_description_id,
              COALESCE(NULLIF(TRIM(jd.title), ''), CASE WHEN s.job_description_id IS NOT NULL THEN CONCAT('Job ', s.job_description_id::text) ELSE NULL END) AS job_label,
              COUNT(sc.id)::int AS candidate_count
       FROM shortlists s
       LEFT JOIN shortlist_candidates sc ON sc.shortlist_id = s.id
       LEFT JOIN job_descriptions jd ON jd.id = s.job_description_id
       WHERE s.user_id = $1
         AND ($2::boolean = true OR s.status = 'active')
       GROUP BY s.id, jd.title
       ORDER BY s.created_at DESC`,
      [req.userId, includeArchived],
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
  const shortlistJobId = normalizeJobDescriptionId(req.body?.jobDescriptionId)

  if (!name) {
    return res.status(400).json({ error: 'Shortlist name is required' })
  }

  try {
    let validatedJobId = null
    if (shortlistJobId) {
      const jobResult = await pool.query(
        'SELECT id, title FROM job_descriptions WHERE id = $1 AND user_id = $2 LIMIT 1',
        [shortlistJobId, req.userId],
      )
      if (!jobResult.rows[0]) {
        return res.status(400).json({ error: 'Invalid jobDescriptionId' })
      }
      validatedJobId = jobResult.rows[0].id
    }

    const result = await pool.query(
      `INSERT INTO shortlists (user_id, name, description, job_description_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, description, job_description_id, status, created_at`,
      [req.userId, name.slice(0, 120), description ? description.slice(0, 500) : null, validatedJobId],
    )
    const createdShortlist = result.rows[0]
    const shortlistWithLabel = await pool.query(
      `SELECT s.id,
              s.name,
              s.description,
              s.job_description_id,
              COALESCE(NULLIF(TRIM(jd.title), ''), CASE WHEN s.job_description_id IS NOT NULL THEN CONCAT('Job ', s.job_description_id::text) ELSE NULL END) AS job_label,
              s.status,
              s.created_at
       FROM shortlists s
       LEFT JOIN job_descriptions jd ON jd.id = s.job_description_id
       WHERE s.id = $1 AND s.user_id = $2
       LIMIT 1`,
      [createdShortlist.id, req.userId],
    )

    return res.status(201).json({ shortlist: shortlistWithLabel.rows[0] || createdShortlist })
  } catch (error) {
    console.error('[Shortlists] Failed to create shortlist:', error)
    return res.status(500).json({ error: 'Unable to create shortlist' })
  }
})

router.patch('/:id', async (req, res) => {
  const name = req.body?.name === undefined ? undefined : String(req.body.name || '').trim().slice(0, 120)
  const description = req.body?.description === undefined ? undefined : (req.body.description ? String(req.body.description).trim().slice(0, 500) : null)

  if (name !== undefined && !name) {
    return res.status(400).json({ error: 'Shortlist name is required' })
  }

  try {
    const currentResult = await pool.query(
      'SELECT id, name, description FROM shortlists WHERE id = $1 AND user_id = $2 LIMIT 1',
      [req.params.id, req.userId],
    )
    const current = currentResult.rows[0]
    if (!current) {
      return res.status(404).json({ error: 'Shortlist not found' })
    }

    const updated = await pool.query(
      `UPDATE shortlists
       SET name = $3,
           description = $4,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, description, status, created_at, updated_at`,
      [req.params.id, req.userId, name ?? current.name, description ?? current.description],
    )
    return res.json({ shortlist: updated.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to rename/update shortlist:', error)
    return res.status(500).json({ error: 'Unable to update shortlist' })
  }
})

router.post('/:id/archive', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE shortlists
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, status, updated_at`,
      [req.params.id, req.userId],
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Shortlist not found' })
    return res.json({ shortlist: result.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to archive shortlist:', error)
    return res.status(500).json({ error: 'Unable to archive shortlist' })
  }
})

router.post('/:id/unarchive', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE shortlists
       SET status = 'active', updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, status, updated_at`,
      [req.params.id, req.userId],
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Shortlist not found' })
    return res.json({ shortlist: result.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to unarchive shortlist:', error)
    return res.status(500).json({ error: 'Unable to unarchive shortlist' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM shortlists WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId])
    if (!result.rows[0]) return res.status(404).json({ error: 'Shortlist not found' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('[Shortlists] Failed to delete shortlist:', error)
    return res.status(500).json({ error: 'Unable to delete shortlist' })
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
      `SELECT s.id, s.user_id, s.name, s.description, s.job_description_id, s.status, s.created_at,
              COALESCE(NULLIF(TRIM(jd.title), ''), CASE WHEN s.job_description_id IS NOT NULL THEN CONCAT('Job ', s.job_description_id::text) ELSE NULL END) AS job_label
       FROM shortlists s
       LEFT JOIN job_descriptions jd ON jd.id = s.job_description_id
       WHERE s.id = $1 AND s.user_id = $2
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
              sc.source_context,
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
  const sourceContext = req.body?.sourceContext && typeof req.body.sourceContext === 'object' ? req.body.sourceContext : null

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
           WHERE id = $1 AND user_id = $2 AND status = 'active'
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
      return res.status(404).json({ error: 'Shortlist not found or archived' })
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
         decision_status,
         source_context
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (shortlist_id, resume_id)
       DO UPDATE SET notes = EXCLUDED.notes,
                     rating = EXCLUDED.rating,
                     analysis_id = COALESCE(EXCLUDED.analysis_id, shortlist_candidates.analysis_id),
                     candidate_snapshot = COALESCE(EXCLUDED.candidate_snapshot, shortlist_candidates.candidate_snapshot),
                     decision_status = COALESCE(EXCLUDED.decision_status, shortlist_candidates.decision_status),
                     source_context = COALESCE(EXCLUDED.source_context, shortlist_candidates.source_context),
                     updated_at = NOW()
       RETURNING id, shortlist_id, resume_id, notes, rating, added_at, analysis_id, candidate_snapshot, decision_status, source_context, created_at, updated_at`,
      [
        req.params.id,
        resumeId,
        notes ? notes.slice(0, 1000) : null,
        rating,
        analysisId,
        candidateSnapshot,
        decisionStatus,
        sourceContext,
      ],
    )

    return res.status(201).json({ candidate: result.rows[0] })
  } catch (error) {
    console.error('[Shortlists] Failed to add candidate to shortlist:', error)
    return res.status(500).json({ error: 'Unable to add candidate to shortlist' })
  }
})

router.post('/:id/candidates/batch', async (req, res) => {
  const resumeIds = normalizeBatchResumeIds(req.body?.resumeIds)

  if (resumeIds.length === 0) {
    return res.status(400).json({ error: 'resumeIds must include at least one resume ID' })
  }

  const hasRating = Object.prototype.hasOwnProperty.call(req.body || {}, 'rating')
  const parsedRating = Number(req.body?.rating)
  const rating = hasRating && Number.isInteger(parsedRating) ? parsedRating : null
  if (hasRating && rating !== null && (rating < 1 || rating > 5)) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' })
  }

  const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 1000) : null
  const sourceContext = req.body?.sourceContext && typeof req.body.sourceContext === 'object' ? req.body.sourceContext : null
  const sourceContextByResumeId = req.body?.sourceContextByResumeId && typeof req.body.sourceContextByResumeId === 'object' ? req.body.sourceContextByResumeId : {}
  const candidateSnapshotByResumeId = req.body?.candidateSnapshotByResumeId && typeof req.body.candidateSnapshotByResumeId === 'object' ? req.body.candidateSnapshotByResumeId : {}

  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM shortlists WHERE id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [req.params.id, req.userId],
    )
    if (!ownerCheck.rows[0]) {
      return res.status(404).json({
        error: 'This shortlist is no longer available. Select another shortlist or create a new one to continue.',
        errorCode: 'missing_shortlist',
        retryGuidance: 'Choose a different shortlist or create a new shortlist, then retry.',
      })
    }

    const visibleResumesResult = await pool.query(
      `SELECT id
       FROM resumes
       WHERE user_id = $1
         AND id = ANY($2::uuid[])`,
      [req.userId, resumeIds],
    )
    const visibleResumeIds = new Set(visibleResumesResult.rows.map((row) => row.id))
    const invalidIds = resumeIds.filter((resumeId) => !visibleResumeIds.has(resumeId))

    let existingIds = new Set()
    if (visibleResumeIds.size > 0) {
      const existingResult = await pool.query(
        `SELECT resume_id
         FROM shortlist_candidates
         WHERE shortlist_id = $1
           AND resume_id = ANY($2::uuid[])`,
        [req.params.id, [...visibleResumeIds]],
      )
      existingIds = new Set(existingResult.rows.map((row) => row.resume_id))

      const sourceContextRows = [...visibleResumeIds].map((resumeId) => ({
        resume_id: resumeId,
        source_context: sourceContextByResumeId[resumeId] || sourceContext || null,
        candidate_snapshot: candidateSnapshotByResumeId[resumeId] || null,
      }))
      await pool.query(
        `INSERT INTO shortlist_candidates (shortlist_id, resume_id, notes, rating, source_context, candidate_snapshot)
         SELECT $1, x.resume_id::uuid, $3, $4, x.source_context::jsonb, x.candidate_snapshot::jsonb
         FROM jsonb_to_recordset($6::jsonb) AS x(resume_id text, source_context jsonb, candidate_snapshot jsonb)
         ON CONFLICT (shortlist_id, resume_id)
         DO UPDATE SET notes = EXCLUDED.notes,
                       rating = CASE
                         WHEN $5::boolean THEN EXCLUDED.rating
                         ELSE shortlist_candidates.rating
                       END,
                       source_context = COALESCE(EXCLUDED.source_context, shortlist_candidates.source_context),
                       candidate_snapshot = COALESCE(EXCLUDED.candidate_snapshot, shortlist_candidates.candidate_snapshot)`,
        [req.params.id, [...visibleResumeIds], notes, rating, hasRating, JSON.stringify(sourceContextRows)],
      )
    }

    const outcomes = resumeIds.map((resumeId) => {
      if (!visibleResumeIds.has(resumeId)) {
        return {
          resumeId,
          ok: false,
          code: 'invalid/missing',
          message: 'Resume not found for this user',
        }
      }
      return {
        resumeId,
        ok: true,
        code: existingIds.has(resumeId) ? 'updated/already-present' : 'added',
      }
    })

    const successCount = outcomes.filter((item) => item.ok).length
    const failureCount = outcomes.length - successCount

    return res.json({
      shortlistId: req.params.id,
      ok: failureCount === 0,
      partialFailure: failureCount > 0,
      summary: {
        requested: resumeIds.length,
        succeeded: successCount,
        failed: failureCount,
        added: outcomes.filter((item) => item.code === 'added').length,
        updated: outcomes.filter((item) => item.code === 'updated/already-present').length,
        invalid: invalidIds.length,
      },
      errorCode: failureCount > 0 ? 'partial_failure' : null,
      retryGuidance: failureCount > 0 ? 'Retry failed or invalid/missing items after refreshing selection.' : null,
      outcomes,
    })
  } catch (error) {
    console.error('[Shortlists] Failed to batch add candidates:', error)
    return res.status(500).json({ error: 'Unable to batch add candidates to shortlist' })
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

router.post('/:id/candidates/batch-remove', async (req, res) => {
  const resumeIds = normalizeBatchResumeIds(req.body?.resumeIds)

  if (resumeIds.length === 0) {
    return res.status(400).json({ error: 'resumeIds must include at least one resume ID' })
  }

  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM shortlists WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [req.params.id, req.userId],
    )

    if (!ownerCheck.rows[0]) {
      return res.status(404).json({ error: 'Shortlist not found' })
    }

    const deletedResult = await pool.query(
      `DELETE FROM shortlist_candidates
       WHERE shortlist_id = $1
         AND resume_id = ANY($2::uuid[])
       RETURNING resume_id`,
      [req.params.id, resumeIds],
    )
    const removed = new Set(deletedResult.rows.map((row) => row.resume_id))

    const outcomes = resumeIds.map((resumeId) => ({
      resumeId,
      ok: true,
      code: removed.has(resumeId) ? 'removed' : 'not_present',
    }))
    const removedCount = outcomes.filter((item) => item.code === 'removed').length

    return res.json({
      shortlistId: req.params.id,
      ok: true,
      partialFailure: false,
      summary: {
        requested: resumeIds.length,
        removed: removedCount,
        notPresent: resumeIds.length - removedCount,
      },
      outcomes,
    })
  } catch (error) {
    console.error('[Shortlists] Failed to batch remove candidates:', error)
    return res.status(500).json({ error: 'Unable to batch remove candidates from shortlist' })
  }
})

export default router
