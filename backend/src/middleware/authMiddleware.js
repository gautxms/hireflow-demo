import jwt from 'jsonwebtoken'

export function requireAuth(req, res, next) {
  const bearerToken = req.headers.authorization?.split(' ')[1]
  const token = bearerToken || req.cookies?.token

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
