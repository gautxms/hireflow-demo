import crypto from 'crypto'
import { Buffer } from 'node:buffer'

export const PADDLE_WEBHOOK_TOLERANCE_SECONDS = 300

export function parseSignatureHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return null
  }

  return headerValue.split(';').reduce((acc, part) => {
    const [key, value] = part.split('=').map((item) => item.trim())

    if (key && value) {
      acc[key] = value
    }

    return acc
  }, {})
}

export function safeCompareHex(expectedHex, receivedHex) {
  if (!expectedHex || !receivedHex) {
    return false
  }

  const expectedBuffer = Buffer.from(expectedHex, 'hex')
  const receivedBuffer = Buffer.from(receivedHex, 'hex')

  if (expectedBuffer.length === 0 || receivedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

function normalizeSecret(secret) {
  if (!secret || typeof secret !== 'string') {
    return null
  }

  let normalizedSecret = secret.trim()

  try {
    const decodedSecret = Buffer.from(normalizedSecret, 'base64')
    const reEncodedSecret = decodedSecret.toString('base64').replace(/=+$/, '')
    const normalizedBase64Input = normalizedSecret.replace(/=+$/, '')

    if (decodedSecret.length > 0 && reEncodedSecret === normalizedBase64Input) {
      normalizedSecret = decodedSecret
    }
  } catch {
    // Fall back to trimmed secret.
  }

  return normalizedSecret
}

export function verifyPaddleSignature(rawBody, signatureHeader, secret, options = {}) {
  const parsed = parseSignatureHeader(signatureHeader)
  const normalizedSecret = normalizeSecret(secret)

  if (!parsed?.ts || !parsed?.h1 || !normalizedSecret) {
    return { isValid: false, reason: 'missing_signature_fields' }
  }

  const timestampSeconds = Number.parseInt(parsed.ts, 10)
  if (!Number.isFinite(timestampSeconds)) {
    return { isValid: false, reason: 'invalid_timestamp' }
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  const toleranceSeconds = Number.isFinite(options.maxAgeSeconds)
    ? options.maxAgeSeconds
    : PADDLE_WEBHOOK_TOLERANCE_SECONDS
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds)

  if (ageSeconds > toleranceSeconds) {
    return { isValid: false, reason: 'timestamp_out_of_range' }
  }

  const signedPayload = `${parsed.ts}:${rawBody}`
  const expected = crypto
    .createHmac('sha256', normalizedSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  const isValid = safeCompareHex(expected, parsed.h1)

  return {
    isValid,
    reason: isValid ? null : 'signature_mismatch',
    timestampSeconds,
  }
}

export function getWebhookEventType(payload) {
  return payload?.event_type || payload?.eventType || payload?.alert_name || null
}

export function getPaddleEventId(payload) {
  return payload?.event_id || payload?.eventId || payload?.notification_id || payload?.id || null
}


export function getEventDeduplicationId(payload, rawBody = '') {
  const explicit = getPaddleEventId(payload)
  if (explicit) {
    return String(explicit)
  }

  const hash = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex')
  return `hash:${hash}`
}

const SUBSCRIPTION_LIFECYCLE_EVENT_ALIASES = new Map([
  ['subscription.created', 'subscription.created'],
  ['subscription_created', 'subscription.created'],
  ['subscription.updated', 'subscription.updated'],
  ['subscription_updated', 'subscription.updated'],
  ['subscription.activated', 'subscription.activated'],
  ['subscription_activated', 'subscription.activated'],
  ['subscription.trialing', 'subscription.trialing'],
  ['subscription_trialing', 'subscription.trialing'],
  ['subscription.past_due', 'subscription.past_due'],
  ['subscription_past_due', 'subscription.past_due'],
  ['subscription.paused', 'subscription.paused'],
  ['subscription_paused', 'subscription.paused'],
  ['subscription.resumed', 'subscription.resumed'],
  ['subscription_resumed', 'subscription.resumed'],
  ['subscription.canceled', 'subscription.canceled'],
  ['subscription.cancelled', 'subscription.canceled'],
  ['subscription_cancelled', 'subscription.canceled'],
])

const EVENT_STATUS_OVERRIDES = new Map([
  ['subscription.activated', 'active'],
  ['subscription.trialing', 'trialing'],
  ['subscription.past_due', 'past_due'],
  ['subscription.paused', 'paused'],
  ['subscription.resumed', 'active'],
  ['subscription.canceled', 'cancelled'],
])

const SUPPORTED_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
  'cancelled',
])

export function normalizePaddleSubscriptionStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  const storedStatus = normalized === 'canceled' ? 'cancelled' : normalized
  return SUPPORTED_SUBSCRIPTION_STATUSES.has(storedStatus) ? storedStatus : null
}

export function normalizePaddleSubscriptionLifecycleEventType(eventType) {
  return SUBSCRIPTION_LIFECYCLE_EVENT_ALIASES.get(String(eventType || '').trim().toLowerCase()) || null
}

export function getPaddleSubscriptionLifecycleProjection(eventType, payload) {
  const normalizedEventType = normalizePaddleSubscriptionLifecycleEventType(eventType)
  if (!normalizedEventType) return null

  const rawProviderStatus = payload?.data?.status ?? payload?.status ?? null
  const providerStatus = normalizePaddleSubscriptionStatus(rawProviderStatus)
  const eventStatus = EVENT_STATUS_OVERRIDES.get(normalizedEventType) || null

  if (rawProviderStatus && !providerStatus) {
    return { eventType: normalizedEventType, status: null, reason: 'unsupported_provider_status' }
  }

  if (eventStatus && providerStatus && eventStatus !== providerStatus) {
    return { eventType: normalizedEventType, status: null, reason: 'event_status_mismatch' }
  }

  return {
    eventType: normalizedEventType,
    status: eventStatus || providerStatus,
    reason: eventStatus || providerStatus ? null : 'provider_status_missing',
  }
}

export function mapToSubscriptionStatus(eventType, payload) {
  const lifecycleProjection = getPaddleSubscriptionLifecycleProjection(eventType, payload)
  if (lifecycleProjection) return lifecycleProjection.status

  const normalizedEventType = eventType ? String(eventType).toLowerCase() : ''

  if (normalizedEventType === 'transaction.completed' || normalizedEventType === 'subscription_payment_succeeded') {
    return 'active'
  }

  if (normalizedEventType === 'transaction.failed' || normalizedEventType === 'transaction.payment_failed') {
    return 'payment_failed'
  }

  return null
}

export function getTransactionSubscriptionId(payload) {
  return payload?.data?.subscription_id || payload?.data?.subscription?.id || payload?.subscription_id || payload?.subscription?.id || null
}
