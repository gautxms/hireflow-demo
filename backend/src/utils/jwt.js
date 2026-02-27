import jwt from 'jsonwebtoken'

export const TOKEN_TYPES = {
  FULL: 'full',
  TEMP: 'temp',
}

export function signToken(userId) {
  return jwt.sign(
    { userId, tokenType: TOKEN_TYPES.FULL },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}

export function signTempToken(userId) {
  return jwt.sign(
    { userId, tokenType: TOKEN_TYPES.TEMP },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  )
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
