import { Router } from 'express'
import { pool } from '../../db/client.js'
import { trackEvent } from '../../services/analytics.js'
import { adminActionAuditMiddleware, requireAdminAuth } from '../../middleware/adminAuth.js'

const router = Router()

function normalizeRoute(value) {
  const route = String(value || '').trim()
  if (!route.startsWith('/admin')) {
    return '/admin/unknown'
  }

  return route.slice(0, 180)
}

router.post('/events', async (req, res) => {
  const { eventType, route, metadata = {} } = req.body || {}

  if (!eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'eventType is required' })
  }

  await trackEvent({
    userId: req.admin?.id || null,
    eventType,
    metadata: {
      route: normalizeRoute(route),
      actor: 'admin',
      ...(metadata || {}),
    },
  })

  return res.status(202).json({ ok: true })
})

router.post('/feedback', requireAdminAuth, adminActionAuditMiddleware, async (req, res) => {
  const route = normalizeRoute(req.body?.route)
  const isUseful = req.body?.isUseful
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) : ''

  if (typeof isUseful !== 'boolean') {
    return res.status(400).json({ error: 'isUseful must be boolean' })
  }

  await pool.query(
    `INSERT INTO admin_page_feedback (admin_id, route, is_useful, comment, context)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      req.admin?.id || null,
      route,
      isUseful,
      comment || null,
      JSON.stringify({ submittedFrom: 'admin_feedback_widget' }),
    ],
  )

  await trackEvent({
    userId: req.admin?.id || null,
    eventType: 'admin_page_feedback_submitted',
    metadata: {
      route,
      isUseful,
      hasComment: Boolean(comment),
    },
  })

  return res.status(201).json({ ok: true })
})

export default router
