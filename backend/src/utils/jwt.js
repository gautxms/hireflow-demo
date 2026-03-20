import jwt from 'jsonwebtoken'

export function signToken(user) {
  const userId = typeof user === 'object' ? user.id : user
  const userPayload = typeof user === 'object'
    ? {
      id: user.id,
      email: user.email,
      company: user.company || '',
      phone: user.phone || '',
      subscription_status: user.subscription_status || 'inactive',
      created_at: user.created_at || null,
      deleted_at: user.deleted_at || null,
      deletion_scheduled_for: user.deletion_scheduled_for || null,
    }
    : null

  return jwt.sign(
    { userId, user: userPayload },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  )
}
