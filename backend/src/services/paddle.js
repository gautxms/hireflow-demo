import crypto from 'crypto'

const {
  PADDLE_VENDOR_ID,
  PADDLE_API_KEY,
  PADDLE_PUBLIC_KEY,
  PADDLE_ENV = 'sandbox',
} = process.env

let paddleClient = null

const requiredConfig = {
  vendorId: PADDLE_VENDOR_ID,
  apiKey: PADDLE_API_KEY,
  publicKey: PADDLE_PUBLIC_KEY,
}

const hasMissingConfig = Object.values(requiredConfig).some((value) => !value)

function initializePaddleClient() {
  if (paddleClient) {
    return paddleClient
  }

  if (hasMissingConfig) {
    throw new Error('Paddle configuration is incomplete. Check required environment variables.')
  }

  paddleClient = {
    baseUrl:
      PADDLE_ENV === 'production'
        ? 'https://api.paddle.com'
        : 'https://sandbox-api.paddle.com',
    vendorId: requiredConfig.vendorId,
    apiKey: requiredConfig.apiKey,
    publicKey: requiredConfig.publicKey,
  }

  return paddleClient
}

function phpSerializeValue(value) {
  if (value === null || value === undefined) {
    return 'N;'
  }

  if (typeof value === 'boolean') {
    return `b:${value ? 1 : 0};`
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? `i:${value};` : `d:${value};`
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((entry, index) => `${phpSerializeValue(index)}${phpSerializeValue(entry)}`)
      .join('')

    return `a:${value.length}:{${entries}}`
  }

  const stringValue = String(value)
  return `s:${Buffer.byteLength(stringValue, 'utf8')}:"${stringValue}";`
}

function phpSerializeObject(value) {
  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'p_signature')
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  const entries = Object.entries(normalized)
    .map(([key, entryValue]) => `${phpSerializeValue(key)}${phpSerializeValue(entryValue)}`)
    .join('')

  return `a:${Object.keys(normalized).length}:{${entries}}`
}

export async function createSubscriptionSession(_user, planId) {
  try {
    const client = initializePaddleClient()

    return {
      status: 'not_implemented',
      provider: 'paddle',
      environment: PADDLE_ENV,
      baseUrl: client.baseUrl,
      planId: planId || null,
      // Future logic: create transaction or checkout link with Paddle API.
      checkoutUrl: null,
    }
  } catch (error) {
    console.error('Failed to initialize Paddle subscription session:', error)
    throw new Error('Unable to create Paddle subscription session.')
  }
}

export function verifyPaddleWebhookSignature(eventPayload, signature) {
  try {
    const client = initializePaddleClient()

    if (!eventPayload || !signature) {
      return false
    }

    const serializedPayload = phpSerializeObject(eventPayload)
    const verifier = crypto.createVerify('sha1')
    verifier.update(serializedPayload)
    verifier.end()

    return verifier.verify(client.publicKey, Buffer.from(signature, 'base64'))
  } catch (error) {
    console.error('Failed to verify Paddle webhook signature:', error)
    return false
  }
}

export async function handlePaddleWebhookEvent(eventPayload) {
  try {
    initializePaddleClient()

    const eventType = eventPayload?.alert_name

    // Internal status mapping only. Persisting to the database should happen
    // in a future update where subscription/account tables are finalized.
    const statusMap = {
      subscription_created: 'active',
      subscription_payment_succeeded: 'active',
      subscription_cancelled: 'cancelled',
    }

    if (!statusMap[eventType]) {
      return {
        processed: false,
        reason: 'unsupported_event',
        eventType,
      }
    }

    return {
      processed: true,
      provider: 'paddle',
      eventType,
      internalStatus: statusMap[eventType],
      // Include IDs so future persistence logic can upsert by subscription.
      subscriptionId: eventPayload?.subscription_id ?? null,
      userId: eventPayload?.passthrough ?? null,
    }
  } catch (error) {
    console.error('Failed to handle Paddle webhook event:', error)
    throw new Error('Unable to handle Paddle webhook event.')
  }
}

export default {
  createSubscriptionSession,
  verifyPaddleWebhookSignature,
  handlePaddleWebhookEvent,
}
