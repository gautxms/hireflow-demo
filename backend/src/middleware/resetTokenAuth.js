import { getValidResetTokenRecord } from '../services/resetTokenService.js'

function getTokenFromRequest(req) {
  if (typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim()
  }

  if (typeof req.body?.token === 'string' && req.body.token.trim()) {
    return req.body.token.trim()
  }

  return ''
}

export function resetTokenAuth(options = {}) {
  const { allowValidFalseResponse = false } = options

  return async function resetTokenAuthMiddleware(req, res, next) {
    const token = getTokenFromRequest(req)

    if (!token) {
      if (allowValidFalseResponse) {
        return res.json({ valid: false })
      }

      return res.status(400).json({ error: 'Reset token is required.' })
    }

    try {
      const resetTokenRecord = await getValidResetTokenRecord(token)

      if (!resetTokenRecord) {
        if (allowValidFalseResponse) {
          return res.json({ valid: false })
        }

        return res.status(401).json({ error: 'Reset token is invalid or expired.' })
      }

      req.resetTokenRecord = resetTokenRecord
      return next()
    } catch (error) {
      console.error('[AUTH] Reset token verification failed:', error)

      if (allowValidFalseResponse) {
        return res.json({ valid: false })
      }

      return res.status(500).json({ error: 'Unable to verify reset token.' })
    }
  }
}
