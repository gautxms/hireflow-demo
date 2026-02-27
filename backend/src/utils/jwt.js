import jwt from 'jsonwebtoken'

export function signToken(userId, role) {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}
