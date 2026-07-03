import jwt from 'jsonwebtoken'

const shouldLogAuthDebug = process.env.NODE_ENV !== 'production' || process.env.AUTH_DEBUG_LOGS === 'true'

function logAuthDebug(message, metadata) {
  if (shouldLogAuthDebug) {
    console.debug(message, metadata)
  }
}

export function requireAuth(req, res, next) {
  logAuthDebug('[Auth Middleware] Checking authorization')
  
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    logAuthDebug('[Auth Middleware] No token found')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    logAuthDebug('[Auth Middleware] Token verified')
    next()
  } catch (error) {
    logAuthDebug('[Auth Middleware] Token verification failed', { errorName: error?.name || 'UNKNOWN_ERROR' })
    return res.status(401).json({ error: 'Invalid token' })
  }
}
