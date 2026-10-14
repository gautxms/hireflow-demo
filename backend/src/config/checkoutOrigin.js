function validateOrigin(value, production) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value)) {
    return { reason: 'invalid_origin_format' }
  }

  try {
    const url = new URL(value)
    if (!url.hostname || url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || url.pathname !== '/' || url.search || url.hash || url.origin === 'null') {
      return { reason: 'invalid_origin_format' }
    }
    if (production && url.protocol !== 'https:') return { reason: 'https_required' }
    return { origin: url.origin }
  } catch {
    return { reason: 'invalid_origin_format' }
  }
}

export function resolveCanonicalCheckoutOrigin(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const configured = Boolean(env.APP_ORIGIN?.trim())
  const environment = production ? 'production' : (env.NODE_ENV || 'development')

  if (production && !configured) {
    return { origin: null, reason: 'app_origin_missing', configured, environment }
  }

  const candidate = configured ? env.APP_ORIGIN : env.FRONTEND_ORIGIN
  if (!candidate) {
    return { origin: null, reason: 'development_origin_missing', configured, environment }
  }

  const validated = validateOrigin(candidate, production)
  return { origin: validated.origin || null, reason: validated.reason || null, configured, environment }
}

export function logCheckoutOriginStatus(env = process.env) {
  const result = resolveCanonicalCheckoutOrigin(env)
  console.info('[Startup] Paddle checkout origin configuration', {
    environment: result.environment,
    appOriginConfigured: result.configured,
    valid: Boolean(result.origin),
    reason: result.reason,
  })
}
