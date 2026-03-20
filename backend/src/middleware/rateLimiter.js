import rateLimit from 'express-rate-limit'

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const rateLimitEvents = []

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

function recordRateLimitEvent(scope, req, limiterKey, retryAfterSeconds) {
  rateLimitEvents.push({
    scope,
    key: limiterKey,
    ip: req.ip,
    path: req.originalUrl,
    method: req.method,
    retryAfterSeconds,
    timestamp: new Date().toISOString(),
  })

  if (rateLimitEvents.length > 1000) {
    rateLimitEvents.shift()
  }
}

function buildRateLimitHandler({ scope, message, windowMs, keyExtractor }) {
  return (req, res) => {
    const retryAfterSeconds = resolveRetryAfterSeconds(req, windowMs)
    const limiterKey = keyExtractor?.(req)

    recordRateLimitEvent(scope, req, limiterKey, retryAfterSeconds)

    console.warn(`[RATELIMIT] ${scope} exceeded`, {
      ip: req.ip,
      key: limiterKey,
      path: req.originalUrl,
      method: req.method,
      retryAfterSeconds,
    })

    res.set('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({
      error: message,
      code: 'TOO_MANY_REQUESTS',
      retryAfterSeconds,
    })
  }
}

export function getRateLimitStats() {
  const summary = rateLimitEvents.reduce((acc, event) => {
    acc[event.scope] = (acc[event.scope] || 0) + 1
    return acc
  }, {})

  return {
    totalHits: rateLimitEvents.length,
    hitsByScope: summary,
    recentHits: rateLimitEvents.slice(-50).reverse(),
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
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isLocalhostRequest,
  handler: buildRateLimitHandler({
    scope: 'Signup attempts',
    message: 'Too many signup attempts. Try again in 15 minutes.',
    windowMs: 15 * 60 * 1000,
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
    message: 'Too many password reset requests. Try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
    keyExtractor: getPasswordResetKey,
  }),
})

export const generalApiLimiterUnauth = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalhostRequest(req) || Boolean(req.userId),
  handler: buildRateLimitHandler({
    scope: 'General API unauthenticated requests',
    message: 'Too many API requests. Please try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
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
    message: 'Too many API requests. Please try again in 1 hour.',
    windowMs: 60 * 60 * 1000,
    keyExtractor: (req) => String(req.userId || req.ip),
  }),
})

function resolveUploadDailyLimit(req) {
  return req.subscriptionStatus === 'active' ? 100 : 10
}

export const uploadLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: resolveUploadDailyLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.userId || req.ip),
  skip: (req) => isLocalhostRequest(req) || !req.userId,
  handler: buildRateLimitHandler({
    scope: 'Daily upload requests',
    message: 'Daily upload limit reached. Try again tomorrow.',
    windowMs: 24 * 60 * 60 * 1000,
    keyExtractor: (req) => String(req.userId || req.ip),
  }),
})
