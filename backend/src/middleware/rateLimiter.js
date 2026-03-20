import rateLimit from 'express-rate-limit'

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function isLocalhostRequest(req) {
  return LOCALHOST_IPS.has(req.ip)
}

function resolveRetryAfterSeconds(req, windowMs) {
  const resetTime = req.rateLimit?.resetTime

  if (resetTime instanceof Date) {
    return Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
  }

  return Math.ceil(windowMs / 1000)
}

function buildRateLimitHandler({ scope, message, windowMs, keyExtractor }) {
  return (req, res) => {
    const retryAfterSeconds = resolveRetryAfterSeconds(req, windowMs)
    const limiterKey = keyExtractor?.(req)

    console.warn(`[RATELIMIT] ${scope} exceeded`, {
      ip: req.ip,
      key: limiterKey,
      path: req.originalUrl,
      method: req.method,
      retryAfterSeconds,
    })

    res.set('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({ error: message })
  }
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isLocalhostRequest,
  handler: buildRateLimitHandler({
    scope: 'Login attempts',
    message: 'Too many login attempts. Try again in 15 minutes.',
    windowMs: 15 * 60 * 1000,
    keyExtractor: (req) => req.ip,
  }),
})

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isLocalhostRequest,
  handler: buildRateLimitHandler({
    scope: 'Signup attempts',
    message: 'Too many signups from this IP. Try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
    keyExtractor: (req) => req.ip,
  }),
})

function getPasswordResetKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return email || req.ip
}

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getPasswordResetKey,
  skip: isLocalhostRequest,
  handler: buildRateLimitHandler({
    scope: 'Password reset attempts',
    message: 'Too many reset requests. Try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
    keyExtractor: getPasswordResetKey,
  }),
})

export const generalApiLimiterUnauth = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalhostRequest(req) || Boolean(req.userId),
  handler: buildRateLimitHandler({
    scope: 'General API unauthenticated requests',
    message: 'Too many requests. Please try again in 10 minutes.',
    windowMs: 10 * 60 * 1000,
    keyExtractor: (req) => req.ip,
  }),
})

export const generalApiLimiterAuth = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId || req.ip),
  skip: (req) => isLocalhostRequest(req) || !req.userId,
  handler: buildRateLimitHandler({
    scope: 'General API authenticated requests',
    message: 'Too many requests. Please try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
    keyExtractor: (req) => String(req.userId || req.ip),
  }),
})
