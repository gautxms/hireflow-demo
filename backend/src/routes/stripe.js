import { Router } from 'express'
import crypto from 'crypto'

const router = Router()

function hasValidStripeConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY || ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

  // Keep this endpoint safe to deploy before Stripe is approved/configured.
  // Only treat Stripe as enabled once both expected secrets look valid.
  return secretKey.startsWith('sk_') && webhookSecret.startsWith('whsec_')
}

function parseStripeSignatureHeader(signatureHeader) {
  if (!signatureHeader) {
    return { timestamp: null, signatures: [] }
  }

  const parts = signatureHeader.split(',').map((part) => part.trim())
  let timestamp = null
  const signatures = []

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestamp = part.slice(2)
    }

    if (part.startsWith('v1=')) {
      signatures.push(part.slice(3))
    }
  }

  return { timestamp, signatures }
}

function isValidStripeSignature(payloadBuffer, signatureHeader, webhookSecret) {
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader)

  if (!timestamp || signatures.length === 0 || !Buffer.isBuffer(payloadBuffer)) {
    return false
  }

  const signedPayload = `${timestamp}.${payloadBuffer.toString('utf8')}`
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  return signatures.some((signature) => {
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
    const providedBuffer = Buffer.from(signature, 'utf8')

    if (expectedBuffer.length !== providedBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  })
}

router.post('/webhook', (req, res) => {
  if (!hasValidStripeConfig()) {
    return res.status(503).json({ error: 'Stripe is not enabled' })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const signatureHeader = req.headers['stripe-signature']

  // Stripe verification requires raw request bytes. app.js mounts
  // express.raw() specifically for this webhook path before express.json().
  const isValid = isValidStripeSignature(req.body, signatureHeader, webhookSecret)

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid Stripe signature' })
  }

  // Stub endpoint: intentionally no event business logic yet.
  // Future work should switch on event.type and update billing state safely.
  return res.status(200).json({ received: true })
})

export default router
