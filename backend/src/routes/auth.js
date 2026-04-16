import crypto from 'crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../db/client.js'
import { signToken } from '../utils/jwt.js'
import { sendVerificationEmail } from '../utils/mailer.js'
import { schemas, validateBody } from '../middleware/validation.js'
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js'
import { trackEvent } from '../services/analytics.js'
import {
  ADMIN_COOKIE_NAME,
  clearAdminSession,
  createAdminSession,
  isIpAllowed,
  logAdminAction,
  parseAdminToken,
  revokeAdminSession,
  setAdminCookie,
} from '../middleware/adminAuth.js'
import {
  createQrCodeDataUrl,
  createTwoFactorSetup,
  verifyAndConsumeBackupCode,
  verifyTotpCode,
} from '../services/twoFactor.js'
import { triggerWebhook } from '../services/webhookService.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
const resendVerificationAttemptsByEmail = new Map()
const ADMIN_SETUP_TOKEN_TTL_MS = 10 * 60 * 1000
const TOTP_PERIOD_SECONDS = 30

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return `$pbkdf2$${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password, hash) {
  const [_, __, saltHex, hashHex] = hash.split('$')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  return computed === hashHex
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

function signAdminSetupToken(userId) {
  return jwt.sign(
    {
      userId,
      admin_setup: true,
      admin_setup_expires_at: Date.now() + ADMIN_SETUP_TOKEN_TTL_MS,
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  )
}

function readSetupTokenState(setupToken) {
  const decoded = jwt.verify(setupToken, process.env.JWT_SECRET)
  const expiresAt = Number(decoded?.admin_setup_expires_at || 0)
  const secondsRemaining = expiresAt > 0 ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0
  return { decoded, expiresAt, secondsRemaining }
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildVerificationUrl(req, token) {
  const configuredApiUrl = process.env.BACKEND_PUBLIC_URL
  const baseUrl = configuredApiUrl || `${req.protocol}://${req.get('host')}`
  const url = new URL('/api/auth/verify-email', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

function getVerificationSuccessUrl() {
  const configuredSuccessUrl = process.env.EMAIL_VERIFICATION_SUCCESS_URL

  if (configuredSuccessUrl) {
    return configuredSuccessUrl
  }

  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
  return `${frontendOrigin}/verify-email/success`
}

function getResendWindowState(email, now = Date.now()) {
  const oneMinuteAgo = now - 60 * 1000
  const oneHourAgo = now - 60 * 60 * 1000
  const attemptHistory = resendVerificationAttemptsByEmail.get(email) || []
  const recentAttempts = attemptHistory.filter((timestamp) => timestamp > oneHourAgo)

  resendVerificationAttemptsByEmail.set(email, recentAttempts)

  const mostRecentAttempt = recentAttempts[recentAttempts.length - 1]
  const retryAfterOneMinute = mostRecentAttempt ? Math.ceil((mostRecentAttempt + 60 * 1000 - now) / 1000) : 0

  if (mostRecentAttempt && mostRecentAttempt > oneMinuteAgo && retryAfterOneMinute > 0) {
    return {
      blocked: true,
      retryAfterSeconds: retryAfterOneMinute,
      reason: 'minute',
    }
  }

  if (recentAttempts.length >= 5) {
    const oldestAttemptInWindow = recentAttempts[0]
    const retryAfterOneHour = Math.ceil((oldestAttemptInWindow + 60 * 60 * 1000 - now) / 1000)

    if (retryAfterOneHour > 0) {
      return {
        blocked: true,
        retryAfterSeconds: retryAfterOneHour,
        reason: 'hour',
      }
    }
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
  }
}

function recordResendAttempt(email, now = Date.now()) {
  const attempts = resendVerificationAttemptsByEmail.get(email) || []
  resendVerificationAttemptsByEmail.set(email, [...attempts, now])
}

router.post('/signup', signupLimiter, validateBody(schemas.signup), async (req, res) => {
  console.log('[AUTH] Signup route called')
  const { email, password, company = '', phone = '' } = req.body

  const normalizedEmail = email.trim().toLowerCase()
  const verificationToken = crypto.randomBytes(32).toString('hex')
  const verificationTokenHash = hashVerificationToken(verificationToken)
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  try {
    console.log('[AUTH] Signup attempt for:', normalizedEmail)
    console.log('[AUTH] About to hash password and insert user into database')
    const passwordHash = hashPassword(password)
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, company, phone, email_verification_token, email_verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, company, phone, created_at`,
      [normalizedEmail, passwordHash, company, phone, verificationTokenHash, verificationExpiresAt],
    )
    console.log('[AUTH] Insert query completed')

    const user = result.rows[0]
    console.log('[AUTH] User created with id:', user?.id)
    const token = signToken({ ...user, subscription_status: 'trialing' })
    setAuthCookie(res, token)

    const verificationUrl = buildVerificationUrl(req, verificationToken)

    try {
      await sendVerificationEmail({
        to: user.email,
        verificationUrl,
      })
    } catch (mailError) {
      console.error('[AUTH] Failed to send verification email:', mailError)
    }

    try {
      console.log('[AUTH] About to track event for user:', user.id)
      await trackEvent({
        userId: user.id,
        eventType: 'signup',
        metadata: { source: 'auth.signup' },
      })
      console.log('[AUTH] Event tracked successfully')
    } catch (trackError) {
      console.error('[AUTH] Failed to track event:', trackError)
    }

    try {
      await triggerWebhook('user.created', {
        userId: user.id,
        email: user.email,
        company: user.company || '',
        createdAt: user.created_at,
      })
    } catch (webhookError) {
      console.error('[AUTH] Failed to send user.created webhook:', webhookError)
    }

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        email_verified: false,
        company: user.company || '',
        phone: user.phone || '',
        subscription_status: 'trialing',
        created_at: user.created_at,
      },
    })
  } catch (error) {
    console.error('[AUTH] Signup error:', error.message, error.code)
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' })
    }

    return res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.get('/verify-email', async (req, res) => {
  const token = req.query.token

  if (typeof token !== 'string' || token.length === 0) {
    return res.status(400).json({ error: 'Invalid token' })
  }

  const verificationTokenHash = hashVerificationToken(token)

  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL
       WHERE email_verification_token = $1
         AND email_verification_expires_at > NOW()
       RETURNING id`,
      [verificationTokenHash],
    )

    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Invalid or expired token' })
    }

    await trackEvent({
      userId: result.rows[0].id,
      eventType: 'email_verified',
      metadata: { source: 'auth.verify_email' },
    })

    return res.redirect(getVerificationSuccessUrl())
  } catch {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/resend-email-verification', signupLimiter, async (req, res) => {
  const normalizedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Valid email is required' })
  }

  const resendWindow = getResendWindowState(normalizedEmail)

  if (resendWindow.blocked) {
    console.info('[AUTH] Verification email resend blocked', {
      email: normalizedEmail,
      retryAfterSeconds: resendWindow.retryAfterSeconds,
      reason: resendWindow.reason,
    })

    return res.status(429).json({
      error: 'Too many resend attempts',
      retryAfterSeconds: resendWindow.retryAfterSeconds,
    })
  }

  recordResendAttempt(normalizedEmail)

  try {
    const result = await pool.query(
      `SELECT id, email, email_verified, email_verification_expires_at
       FROM users
       WHERE email = $1`,
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (!user || user.email_verified) {
      console.info('[AUTH] Verification email resend attempted for non-pending account', {
        email: normalizedEmail,
      })

      return res.json({
        message: 'Email sent! Check your inbox',
        retryAfterSeconds: 60,
      })
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenHash = hashVerificationToken(verificationToken)
    const existingTokenStillValid =
      user.email_verification_expires_at && new Date(user.email_verification_expires_at).getTime() > Date.now()
    const verificationExpiresAt = existingTokenStillValid
      ? new Date(user.email_verification_expires_at)
      : new Date(Date.now() + 24 * 60 * 60 * 1000)

    await pool.query(
      `UPDATE users
       SET email_verification_token = $1,
           email_verification_expires_at = $2
       WHERE id = $3`,
      [verificationTokenHash, verificationExpiresAt, user.id],
    )

    const verificationUrl = buildVerificationUrl(req, verificationToken)

    await sendVerificationEmail({
      to: user.email,
      verificationUrl,
    })

    console.info('[AUTH] Verification email resent', {
      userId: user.id,
      email: user.email,
    })

    return res.json({
      message: 'Email sent! Check your inbox',
      retryAfterSeconds: 60,
    })
  } catch (error) {
    console.error('[AUTH] Failed to resend verification email:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/login', loginLimiter, validateBody(schemas.login), async (req, res) => {
  const { email, password } = req.body

  const normalizedEmail = email.trim().toLowerCase()

  try {
    console.log('[AUTH] Login attempt for:', normalizedEmail)
    const result = await pool.query(
      'SELECT id, email, company, phone, password_hash, created_at, subscription_status, deleted_at, deletion_scheduled_for, email_verified FROM users WHERE email = $1',
      [normalizedEmail],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    console.log('[AUTH] User found, password_hash format:', user.password_hash?.substring(0, 20))
    const isValidPassword = verifyPassword(password, user.password_hash)
    console.log('[AUTH] Password valid:', isValidPassword)

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (user.deleted_at) {
      return res.status(403).json({ error: 'Account is scheduled for deletion. Contact support to recover access.' })
    }

    const token = signToken(user)
    setAuthCookie(res, token)

    await trackEvent({
      userId: user.id,
      eventType: 'login',
      metadata: { source: 'auth.login' },
    })

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        company: user.company || '',
        phone: user.phone || '',
        subscription_status: user.subscription_status,
        created_at: user.created_at,
        deleted_at: user.deleted_at,
        deletion_scheduled_for: user.deletion_scheduled_for,
      },
    })
  } catch (error) {
    console.error('[AUTH] Login error:', error.message)
    return res.status(500).json({ error: 'Internal server error', details: error.message })
  }
})

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, company, phone, subscription_status, created_at, deleted_at, deletion_scheduled_for
       FROM users
       WHERE id = $1`,
      [req.userId],
    )

    const user = result.rows[0]

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    return res.json(user)
  } catch (error) {
    console.error('[AUTH] Failed to fetch current user:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/admin/login', loginLimiter, async (req, res) => {
  const { email, password, totpCode, backupCode, acceptedEula = false } = req.body || {}
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  if (!isIpAllowed(req.ip)) {
    return res.status(403).json({ error: 'IP address is not on the admin allow list' })
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, is_admin, admin_two_factor_enabled,
              admin_two_factor_secret_enc, admin_backup_codes, admin_eula_accepted_at,
              admin_last_login_ip
       FROM users
       WHERE email = $1`,
      [normalizedEmail],
    )

    const user = result.rows[0]
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin account required' })
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    if (!user.admin_eula_accepted_at && !acceptedEula) {
      return res.status(428).json({
        error: 'EULA acceptance is required before first admin login',
        requiresEula: true,
      })
    }

    if (!user.admin_two_factor_enabled || !user.admin_two_factor_secret_enc) {
      const setupToken = signAdminSetupToken(user.id)
      const setupTokenState = readSetupTokenState(setupToken)
      return res.status(200).json({
        requiresTwoFactorSetup: true,
        setupToken,
        setupTokenExpiresAt: setupTokenState.expiresAt,
        setupTokenSecondsRemaining: setupTokenState.secondsRemaining,
      })
    }

    const hasTotpCode = typeof totpCode === 'string' && totpCode.trim().length >= 6
    const hasBackupCode = typeof backupCode === 'string' && backupCode.trim().length > 0

    if (!hasTotpCode && !hasBackupCode) {
      return res.status(401).json({
        error: '2FA code is required',
        requiresTwoFactor: true,
        totpPeriodSeconds: TOTP_PERIOD_SECONDS,
      })
    }

    let usedBackupCode = false
    let newBackupCodeHashes = user.admin_backup_codes || []
    let isValidTwoFactor = false

    if (hasTotpCode) {
      isValidTwoFactor = verifyTotpCode({
        encryptedSecret: user.admin_two_factor_secret_enc,
        token: totpCode.trim(),
      })
    }

    if (!isValidTwoFactor && hasBackupCode) {
      const backupAttempt = verifyAndConsumeBackupCode(backupCode, user.admin_backup_codes || [])
      isValidTwoFactor = backupAttempt.valid
      usedBackupCode = backupAttempt.valid
      newBackupCodeHashes = backupAttempt.remainingHashes
    }

    if (!isValidTwoFactor) {
      return res.status(401).json({ error: 'Invalid 2FA code' })
    }

    const session = await createAdminSession({
      adminId: user.id,
      email: user.email,
      ipAddress: String(req.ip || '').replace('::ffff:', ''),
    })

    setAdminCookie(res, session.token)

    const previousLoginIp = user.admin_last_login_ip || null

    await pool.query(
      `UPDATE users
       SET admin_eula_accepted_at = COALESCE(admin_eula_accepted_at, CASE WHEN $2::boolean THEN NOW() ELSE NULL END),
           admin_last_login_at = NOW(),
           admin_last_login_ip = $3,
           admin_backup_codes = $4::jsonb
       WHERE id = $1`,
      [user.id, acceptedEula, String(req.ip || '').replace('::ffff:', ''), JSON.stringify(newBackupCodeHashes)],
    )

    await logAdminAction({
      adminId: user.id,
      actionType: 'admin_login',
      details: {
        usedBackupCode,
        newIpDetected: Boolean(previousLoginIp && previousLoginIp !== String(req.ip || '').replace('::ffff:', '')),
      },
      ipAddress: String(req.ip || '').replace('::ffff:', ''),
    })

    return res.json({
      ok: true,
      admin: { id: user.id, email: user.email },
      usedBackupCode,
      totpPeriodSeconds: TOTP_PERIOD_SECONDS,
      sessionTimeoutSeconds: Math.floor((15 * 60 * 1000) / 1000),
      sessionExpiresAt: session.expiresAt,
      newIpDetected: Boolean(previousLoginIp && previousLoginIp !== String(req.ip || '').replace('::ffff:', '')),
    })
  } catch (error) {
    console.error('[AUTH] Admin login error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/admin/2fa/setup', async (req, res) => {
  const { setupToken, appName = 'HireFlow Admin' } = req.body || {}

  if (!setupToken) {
    return res.status(400).json({ error: 'setupToken is required' })
  }

  try {
    const setupTokenState = readSetupTokenState(setupToken)
    const { decoded } = setupTokenState
    if (!decoded?.admin_setup || setupTokenState.secondsRemaining <= 0) {
      return res.status(401).json({ error: 'Invalid or expired setup token' })
    }

    const userResult = await pool.query(
      'SELECT id, email, is_admin FROM users WHERE id = $1',
      [decoded.userId],
    )
    const user = userResult.rows[0]

    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin account required' })
    }

    const setupPayload = createTwoFactorSetup({ label: `${appName}:${user.email}` })
    const qrCodeDataUrl = await createQrCodeDataUrl(setupPayload.otpauthUrl)

    await pool.query(
      `UPDATE users
       SET admin_two_factor_pending_secret_enc = $2,
           admin_pending_backup_codes = $3::jsonb
       WHERE id = $1`,
      [user.id, setupPayload.encryptedSecret, JSON.stringify(setupPayload.backupCodeHashes)],
    )

    return res.json({
      setupToken,
      setupTokenExpiresAt: setupTokenState.expiresAt,
      setupTokenSecondsRemaining: setupTokenState.secondsRemaining,
      totpPeriodSeconds: TOTP_PERIOD_SECONDS,
      otpauthUrl: setupPayload.otpauthUrl,
      manualEntryKey: setupPayload.secretBase32,
      qrCodeDataUrl,
      backupCodes: setupPayload.backupCodes,
      message: 'Save your backup codes securely before verification.',
    })
  } catch {
    return res.status(401).json({ error: 'Invalid or expired setup token' })
  }
})

router.post('/admin/2fa/verify', async (req, res) => {
  const { setupToken, totpCode } = req.body || {}

  if (!setupToken || !totpCode) {
    return res.status(400).json({ error: 'setupToken and totpCode are required' })
  }

  try {
    const setupTokenState = readSetupTokenState(setupToken)
    const { decoded } = setupTokenState
    if (!decoded?.admin_setup || setupTokenState.secondsRemaining <= 0) {
      return res.status(401).json({ error: 'Invalid setup token' })
    }

    const userResult = await pool.query(
      `SELECT id, email, is_admin, admin_two_factor_pending_secret_enc, admin_pending_backup_codes
       FROM users WHERE id = $1`,
      [decoded.userId],
    )

    const user = userResult.rows[0]
    if (!user || !user.is_admin || !user.admin_two_factor_pending_secret_enc) {
      return res.status(400).json({ error: '2FA setup not initialized' })
    }

    const isValidCode = verifyTotpCode({
      encryptedSecret: user.admin_two_factor_pending_secret_enc,
      token: String(totpCode).trim(),
    })

    if (!isValidCode) {
      return res.status(401).json({ error: 'Invalid TOTP code' })
    }

    await pool.query(
      `UPDATE users
       SET admin_two_factor_enabled = true,
           admin_two_factor_secret_enc = admin_two_factor_pending_secret_enc,
           admin_backup_codes = admin_pending_backup_codes,
           admin_two_factor_pending_secret_enc = NULL,
           admin_pending_backup_codes = NULL,
           admin_password_changed_at = COALESCE(admin_password_changed_at, NOW())
       WHERE id = $1`,
      [user.id],
    )

    await logAdminAction({
      adminId: user.id,
      actionType: 'admin_2fa_enabled',
      details: { via: 'totp_setup' },
      ipAddress: String(req.ip || '').replace('::ffff:', ''),
    })

    return res.json({ ok: true, totpPeriodSeconds: TOTP_PERIOD_SECONDS })
  } catch {
    return res.status(401).json({ error: 'Invalid setup token' })
  }
})

router.post('/admin/logout', async (req, res) => {
  const parsed = parseAdminToken(req)

  if (parsed?.decoded?.sid) {
    await revokeAdminSession(parsed.decoded.sid)
  }

  clearAdminSession(res)
  res.clearCookie(ADMIN_COOKIE_NAME)
  return res.status(204).send()
})

router.post('/logout', (_req, res) => {
  res.clearCookie('token')
  return res.status(204).send()
})

export default router
