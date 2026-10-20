import crypto from 'node:crypto'

export const JOB_DESCRIPTION_PREVIEW_RECEIPT_TTL_SECONDS = 30 * 60
const RECEIPT_VERSION = 1
const SIGNING_CONTEXT = 'hireflow:job-description-preview:v1:'

export class JobDescriptionPreviewReceiptError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'JobDescriptionPreviewReceiptError'
    this.code = code
    this.status = status
  }
}

function requireSigningSecret(secret) {
  const normalized = String(secret || '')
  if (!normalized) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_SIGNING_UNAVAILABLE',
      'Job description confirmation is temporarily unavailable.',
      503,
    )
  }
  return normalized
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sign(encodedPayload, secret) {
  return crypto
    .createHmac('sha256', requireSigningSecret(secret))
    .update(`${SIGNING_CONTEXT}${encodedPayload}`)
    .digest('base64url')
}

function parsePayload(encodedPayload) {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload')
    return parsed
  } catch {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_INVALID',
      'This job description preview can no longer be confirmed. Preview the file again.',
    )
  }
}

function safeSignatureEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''))
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

function validateStoredFile(storedFile) {
  const fileUrl = String(storedFile?.fileUrl || '').trim()
  const fileSha256 = String(storedFile?.fileSha256 || '').trim().toLowerCase()
  const fileName = String(storedFile?.fileName || '').trim()
  const contentType = String(storedFile?.contentType || '').trim()

  if (!fileUrl || !/^[a-f0-9]{64}$/.test(fileSha256) || !fileName || !contentType) {
    throw new TypeError('Stored job description file metadata is incomplete')
  }

  return { fileUrl, fileSha256, fileName, contentType }
}

export function issueJobDescriptionPreviewReceipt({
  userId,
  preview,
  storedFile,
  secret,
  now = Date.now(),
  ttlSeconds = JOB_DESCRIPTION_PREVIEW_RECEIPT_TTL_SECONDS,
  previewId = crypto.randomUUID(),
}) {
  const subject = String(userId || '').trim()
  if (!subject) throw new TypeError('A user id is required')
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    throw new TypeError('A job description preview is required')
  }

  const file = validateStoredFile(storedFile)
  const issuedAt = Math.floor(Number(now) / 1000)
  const lifetime = Number(ttlSeconds)
  if (!Number.isFinite(issuedAt) || !Number.isInteger(lifetime) || lifetime <= 0 || lifetime > 60 * 60) {
    throw new TypeError('Preview receipt lifetime must be between 1 and 3600 seconds')
  }

  const payload = {
    v: RECEIPT_VERSION,
    jti: previewId,
    sub: subject,
    file,
    previewSha256: sha256(JSON.stringify(preview)),
    iat: issuedAt,
    exp: issuedAt + lifetime,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const token = `${encodedPayload}.${sign(encodedPayload, secret)}`

  return {
    token,
    previewId: payload.jti,
    previewSha256: payload.previewSha256,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}

export function verifyJobDescriptionPreviewReceipt({ token, userId, secret, now = Date.now() }) {
  const [encodedPayload, signature, extra] = String(token || '').split('.')
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_INVALID',
      'This job description preview can no longer be confirmed. Preview the file again.',
    )
  }

  const expectedSignature = sign(encodedPayload, secret)
  if (!safeSignatureEqual(signature, expectedSignature)) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_INVALID',
      'This job description preview can no longer be confirmed. Preview the file again.',
    )
  }

  const payload = parsePayload(encodedPayload)
  const nowSeconds = Math.floor(Number(now) / 1000)
  if (
    payload.v !== RECEIPT_VERSION
    || !payload.jti
    || !payload.sub
    || !payload.previewSha256
    || !payload.iat
    || !payload.exp
  ) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_INVALID',
      'This job description preview can no longer be confirmed. Preview the file again.',
    )
  }

  const file = validateStoredFile(payload.file)
  if (payload.sub !== String(userId || '').trim()) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_FORBIDDEN',
      'This job description preview belongs to another account.',
      403,
    )
  }
  if (!Number.isFinite(nowSeconds) || payload.exp <= nowSeconds) {
    throw new JobDescriptionPreviewReceiptError(
      'JD_PREVIEW_TOKEN_EXPIRED',
      'This job description preview expired. Preview the file again.',
      410,
    )
  }

  return {
    previewId: payload.jti,
    userId: payload.sub,
    previewSha256: payload.previewSha256,
    file,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}
