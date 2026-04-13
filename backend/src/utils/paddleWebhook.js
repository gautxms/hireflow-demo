import crypto from 'crypto'

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

export function mapToSubscriptionStatus(eventType, payload) {
  const normalizedEventType = eventType ? String(eventType).toLowerCase() : ''

  if (normalizedEventType === 'subscription.created' || normalizedEventType === 'subscription_created') {
    const paddleStatus = payload?.data?.status || payload?.status
    if (paddleStatus === 'trialing') {
      return 'trialing'
    }
    return paddleStatus || 'active'
  }

  if (normalizedEventType === 'subscription.updated' || normalizedEventType === 'subscription_updated') {
    return payload?.data?.status || payload?.status || null
  }

  if (
    normalizedEventType === 'subscription.canceled' ||
    normalizedEventType === 'subscription.cancelled' ||
    normalizedEventType === 'subscription_cancelled'
  ) {
    return 'cancelled'
  }

  if (normalizedEventType === 'transaction.completed' || normalizedEventType === 'subscription_payment_succeeded') {
    return 'active'
  }

  if (normalizedEventType === 'transaction.refunded' || normalizedEventType === 'subscription.paused') {
    return 'paused'
  }

  return null
}
