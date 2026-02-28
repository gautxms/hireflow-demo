import { TOKEN_TYPES, verifyToken } from '../utils/jwt.js'

const TEMP_TOKEN_ALLOWED_PATHS = new Set([
  '/api/stripe/create-subscription',
  '/api/subscription/status',
])

function isTempTokenAllowedForPath(pathname) {
  return TEMP_TOKEN_ALLOWED_PATHS.has(pathname)
}

export function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = verifyToken(token)
    const tokenType = decoded.tokenType || TOKEN_TYPES.FULL
    const pathname = req.originalUrl.split('?')[0]

    // Temp tokens are payment-gating credentials from signup.
    // They are intentionally scoped to billing/setup endpoints only.
    if (tokenType === TOKEN_TYPES.TEMP && !isTempTokenAllowedForPath(pathname)) {
      return res.status(403).json({ error: 'Temp token cannot access this route' })
    }

    req.userId = decoded.userId
    req.auth = { tokenType }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
