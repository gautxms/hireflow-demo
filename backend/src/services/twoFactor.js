import crypto from 'crypto'

const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.ADMIN_2FA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-admin-2fa-key').digest()
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const BACKUP_CODE_COUNT = 8

function toBase32(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31]
  }

  return output
}

function fromBase32(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const cleaned = String(base32).replace(/=+$/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes = []

  for (const char of cleaned) {
    const idx = alphabet.indexOf(char)
    if (idx < 0) continue

    value = (value << 5) | idx
    bits += 5

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

function generateTotp(secretBase32, timeStep = 30) {
  const key = fromBase32(secretBase32)
  const counter = Math.floor(Date.now() / 1000 / timeStep)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000

  return String(code).padStart(6, '0')
}

function encryptText(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptText(payload) {
  if (!payload) return null

  const [ivHex, authTagHex, encryptedHex] = String(payload).split(':')
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted payload format')
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

export function createTwoFactorSetup({ label, issuer = 'HireFlow Admin' }) {
  const secretBuffer = crypto.randomBytes(20)
  const secretBase32 = toBase32(secretBuffer)
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => crypto.randomBytes(5).toString('hex').toUpperCase())

  const otpauthUrl = `otpauth://totp/${encodeURIComponent(label)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`

  return {
    secretBase32,
    otpauthUrl,
    encryptedSecret: encryptText(secretBase32),
    backupCodes,
    backupCodeHashes: hashBackupCodes(backupCodes),
  }
}

export async function createQrCodeDataUrl(otpauthUrl) {
  if (!otpauthUrl) {
    return null
  }

  const escaped = String(otpauthUrl)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
  <rect width="100%" height="100%" fill="#fff"/>
  <rect x="16" y="16" width="328" height="328" fill="none" stroke="#111827" stroke-width="4"/>
  <text x="180" y="70" font-family="Arial, sans-serif" font-size="18" text-anchor="middle" fill="#111827">Authenticator setup</text>
  <foreignObject x="32" y="96" width="296" height="232">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 12px/1.4 Arial, sans-serif; word-break: break-all; color: #111827;">
      ${escaped}
    </div>
  </foreignObject>
</svg>
`.trim()

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function verifyTotpCode({ encryptedSecret, token }) {
  const secretBase32 = decryptText(encryptedSecret)

  if (!secretBase32) {
    return false
  }

  const trimmedToken = String(token || '').trim()
  if (!/^\d{6}$/.test(trimmedToken)) {
    return false
  }

  const current = generateTotp(secretBase32)
  if (trimmedToken === current) return true

  const thirtySecondsAgo = new Date(Date.now() - 30_000)
  const previousCounter = Math.floor(thirtySecondsAgo.getTime() / 1000 / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(previousCounter))
  const key = fromBase32(secretBase32)
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const previousCode = String((((digest[offset] & 0x7f) << 24 | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)) % 1_000_000)).padStart(6, '0')

  return trimmedToken === previousCode
}

export function hashBackupCodes(codes) {
  return codes.map((code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex'))
}

export function verifyAndConsumeBackupCode(rawCode, hashedCodes = []) {
  if (!rawCode || !hashedCodes.length) {
    return { valid: false, remainingHashes: hashedCodes }
  }

  const normalized = String(rawCode).trim().toUpperCase()
  const hashedAttempt = crypto.createHash('sha256').update(normalized).digest('hex')
  const matchIndex = hashedCodes.findIndex((hash) => hash === hashedAttempt)

  if (matchIndex === -1) {
    return { valid: false, remainingHashes: hashedCodes }
  }

  const remainingHashes = [...hashedCodes]
  remainingHashes.splice(matchIndex, 1)

  return {
    valid: true,
    remainingHashes,
  }
}
