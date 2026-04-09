import crypto from 'crypto'
import { pool } from '../db/client.js'

const WEBHOOK_TIMEOUT_MS = 8_000
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY_MINUTES = 10

const SUPPORTED_EVENTS = new Set([
  'parse.completed',
  'user.created',
  'subscription.activated',
  'error.occurred',
  'webhook.test',
  '*',
])

function parseEvents(events) {
  if (!Array.isArray(events)) return []
  return [...new Set(events.map((event) => String(event || '').trim()).filter(Boolean))]
}

function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

async function performDelivery({ webhook, eventType, payload, attempt = 1 }) {
  const timestamp = new Date().toISOString()
  const body = JSON.stringify({
    event: eventType,
    timestamp,
    payload,
  })

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'hireflow-webhooks/1.0',
    'X-Hireflow-Event': eventType,
    'X-Hireflow-Timestamp': timestamp,
    'X-Hireflow-Delivery-Attempt': String(attempt),
  }

  if (webhook.secret) {
    headers['X-Hireflow-Signature'] = signPayload(webhook.secret, timestamp, body)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

  let responseStatus = null
  let responseBody = null
  let errorMessage = null
  let status = 'failed'

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    responseStatus = response.status
    responseBody = await response.text()
    status = response.ok ? 'success' : 'failed'
  } catch (error) {
    errorMessage = error?.message || 'Webhook delivery failed'
  } finally {
    clearTimeout(timeout)
  }

  const shouldRetry = status === 'failed' && attempt < MAX_RETRY_ATTEMPTS
  const nextRetryAt = shouldRetry
    ? new Date(Date.now() + RETRY_DELAY_MINUTES * 60 * 1000).toISOString()
    : null

  const logInsert = await pool.query(
    `INSERT INTO integration_webhook_logs (
       webhook_id,
       event_type,
       request_payload,
       response_status,
       response_body,
       error_message,
       attempt,
       status,
       next_retry_at
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
     RETURNING id, status, attempt, next_retry_at, created_at`,
    [
      webhook.id,
      eventType,
      JSON.stringify(payload),
      responseStatus,
      responseBody,
      errorMessage,
      attempt,
      status,
      nextRetryAt,
    ],
  )

  await pool.query(
    `UPDATE integration_webhooks
     SET last_triggered_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [webhook.id],
  )

  return logInsert.rows[0]
}

export async function ensureWebhookTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url TEXT NOT NULL,
      events TEXT[] NOT NULL,
      secret TEXT,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_triggered_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_webhook_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_id UUID NOT NULL REFERENCES integration_webhooks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      request_payload JSONB NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      error_message TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
      next_retry_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_integration_webhooks_is_active
      ON integration_webhooks (is_active);
    CREATE INDEX IF NOT EXISTS idx_integration_webhook_logs_created_at
      ON integration_webhook_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_integration_webhook_logs_status
      ON integration_webhook_logs (status, next_retry_at);
  `)
}

export function getSupportedWebhookEvents() {
  return [...SUPPORTED_EVENTS].filter((event) => event !== '*')
}

export async function createWebhook({ url, events, secret = null, description = null }) {
  if (!isValidWebhookUrl(url)) {
    throw new Error('A valid webhook URL is required')
  }

  const normalizedEvents = parseEvents(events)
  if (normalizedEvents.length === 0) {
    throw new Error('At least one event is required')
  }

  const invalidEvents = normalizedEvents.filter((event) => !SUPPORTED_EVENTS.has(event))
  if (invalidEvents.length > 0) {
    throw new Error(`Unsupported event(s): ${invalidEvents.join(', ')}`)
  }

  const result = await pool.query(
    `INSERT INTO integration_webhooks (url, events, secret, description)
     VALUES ($1, $2::text[], $3, $4)
     RETURNING id, url, events, description, is_active, last_triggered_at, created_at, updated_at`,
    [url, normalizedEvents, secret, description],
  )

  return result.rows[0]
}

export async function listWebhooks() {
  const result = await pool.query(
    `SELECT id, url, events, description, is_active, last_triggered_at, created_at, updated_at
     FROM integration_webhooks
     ORDER BY created_at DESC`,
  )

  return result.rows
}

export async function removeWebhook(id) {
  const result = await pool.query(
    `DELETE FROM integration_webhooks
     WHERE id = $1
     RETURNING id`,
    [id],
  )

  return result.rows[0] || null
}

export async function triggerWebhook(eventType, payload) {
  if (!SUPPORTED_EVENTS.has(eventType) || eventType === '*') {
    console.warn('[Webhooks] Unsupported event ignored:', eventType)
    return []
  }

  const result = await pool.query(
    `SELECT id, url, events, secret
     FROM integration_webhooks
     WHERE is_active = true
       AND ($1 = ANY(events) OR '*' = ANY(events))`,
    [eventType],
  )

  const deliveries = []
  for (const webhook of result.rows) {
    const log = await performDelivery({
      webhook,
      eventType,
      payload,
      attempt: 1,
    })
    deliveries.push(log)
  }

  return deliveries
}

export async function listWebhookLogs({ page = 1, pageSize = 25 } = {}) {
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1)
  const safePageSize = Math.max(5, Math.min(100, Number.parseInt(String(pageSize), 10) || 25))
  const offset = (safePage - 1) * safePageSize

  const result = await pool.query(
    `WITH logs AS (
       SELECT
         l.id,
         l.webhook_id,
         w.url,
         l.event_type,
         l.request_payload,
         l.response_status,
         l.response_body,
         l.error_message,
         l.attempt,
         l.status,
         l.next_retry_at,
         l.created_at,
         COUNT(*) OVER () AS total_count
       FROM integration_webhook_logs l
       JOIN integration_webhooks w ON w.id = l.webhook_id
     )
     SELECT *
     FROM logs
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [safePageSize, offset],
  )

  const total = result.rows[0] ? Number(result.rows[0].total_count) : 0
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    pages: Math.ceil(total / safePageSize) || 1,
    items: result.rows,
  }
}

export async function retryWebhookDelivery(logId) {
  const result = await pool.query(
    `SELECT
       l.id,
       l.webhook_id,
       l.event_type,
       l.request_payload,
       l.attempt,
       w.url,
       w.secret,
       w.is_active
     FROM integration_webhook_logs l
     JOIN integration_webhooks w ON w.id = l.webhook_id
     WHERE l.id = $1
     LIMIT 1`,
    [logId],
  )

  const entry = result.rows[0]
  if (!entry) {
    throw new Error('Webhook log not found')
  }

  if (!entry.is_active) {
    throw new Error('Webhook is inactive')
  }

  const nextAttempt = Number(entry.attempt || 1) + 1

  return performDelivery({
    webhook: {
      id: entry.webhook_id,
      url: entry.url,
      secret: entry.secret,
    },
    eventType: entry.event_type,
    payload: entry.request_payload,
    attempt: nextAttempt,
  })
}

export async function testWebhook(id) {
  const result = await pool.query(
    `SELECT id, url, secret, is_active
     FROM integration_webhooks
     WHERE id = $1
     LIMIT 1`,
    [id],
  )

  const webhook = result.rows[0]
  if (!webhook) {
    throw new Error('Webhook not found')
  }

  if (!webhook.is_active) {
    throw new Error('Webhook is inactive')
  }

  return performDelivery({
    webhook,
    eventType: 'webhook.test',
    payload: { ok: true, message: 'Webhook test from Hireflow admin' },
    attempt: 1,
  })
}
