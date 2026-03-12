import jwt from 'jsonwebtoken'

export function requireAuth(req, res, next) {
  console.log('[Auth Middleware] Checking authorization for:', req.path)
  
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    console.error('[Auth Middleware] No token found')
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    console.log('[Auth Middleware] Token verified for userId:', decoded.userId)
    next()
  } catch (error) {
    console.error('[Auth Middleware] Token verification failed:', error.message)
    return res.status(401).json({ error: 'Invalid token' })
  }
}
