import { Router } from 'express'
import {
  createWebhook,
  getSupportedWebhookEvents,
  listWebhookLogs,
  listWebhooks,
  removeWebhook,
  retryWebhookDelivery,
  testWebhook,
} from '../services/webhookService.js'

const router = Router()

router.get('/events', (_req, res) => {
  return res.json({ items: getSupportedWebhookEvents() })
})

router.get('/', async (_req, res) => {
  try {
    const items = await listWebhooks()
    return res.json({ items })
  } catch (error) {
    console.error('[Webhooks] Failed to list webhooks:', error)
    return res.status(500).json({ error: 'Failed to fetch webhooks' })
  }
})

router.post('/', async (req, res) => {
  const { url, events, secret = null, description = null } = req.body || {}

  try {
    const webhook = await createWebhook({
      url,
      events,
      secret,
      description,
    })

    return res.status(201).json({ ok: true, webhook })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to create webhook' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await removeWebhook(req.params.id)
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook not found' })
    }
    return res.json({ ok: true, id: deleted.id })
  } catch (error) {
    console.error('[Webhooks] Failed to remove webhook:', error)
    return res.status(500).json({ error: 'Failed to remove webhook' })
  }
})

router.post('/:id/test', async (req, res) => {
  try {
    const log = await testWebhook(req.params.id)
    return res.json({ ok: true, delivery: log })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Webhook test failed' })
  }
})

router.get('/logs', async (req, res) => {
  const page = req.query.page || 1
  const pageSize = req.query.pageSize || 25

  try {
    const logs = await listWebhookLogs({ page, pageSize })
    return res.json(logs)
  } catch (error) {
    console.error('[Webhooks] Failed to fetch logs:', error)
    return res.status(500).json({ error: 'Failed to fetch webhook logs' })
  }
})

router.post('/logs/:id/retry', async (req, res) => {
  try {
    const delivery = await retryWebhookDelivery(req.params.id)
    return res.json({ ok: true, delivery })
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to retry webhook delivery' })
  }
})

export default router
