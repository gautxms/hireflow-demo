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

export async function createSubscriptionSession(_user, _planId) {
  try {
    const client = initializePaddleClient()

    return {
      status: 'not_implemented',
      provider: 'paddle',
      environment: PADDLE_ENV,
      baseUrl: client.baseUrl,
    }
  } catch (error) {
    console.error('Failed to initialize Paddle subscription session:', error)
    throw new Error('Unable to create Paddle subscription session.')
  }
}

export function verifyPaddleWebhookSignature(_rawBody, _signatureHeader) {
  try {
    initializePaddleClient()

    return {
      status: 'not_implemented',
      verified: false,
    }
  } catch (error) {
    console.error('Failed to verify Paddle webhook signature:', error)
    return {
      status: 'error',
      verified: false,
      error: 'Unable to verify Paddle webhook signature.',
    }
  }
}

export async function handlePaddleWebhookEvent(_eventPayload) {
  try {
    initializePaddleClient()

    return {
      status: 'not_implemented',
      provider: 'paddle',
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
