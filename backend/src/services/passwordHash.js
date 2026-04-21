import crypto from 'crypto'

const PBKDF2_ITERATIONS = 100000
const PBKDF2_KEY_LENGTH = 32
const PBKDF2_DIGEST = 'sha256'

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
  return `$pbkdf2$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password, hash) {
  const [_, scheme, saltHex, hashHex] = String(hash || '').split('$')

  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) {
    return false
  }

  const salt = Buffer.from(saltHex, 'hex')
  const computed = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString('hex')

  return computed === hashHex
}
