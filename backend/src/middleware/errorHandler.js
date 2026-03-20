import { reportError } from '../services/errorTracking.js'

export function notFoundHandler(req, res) {
  return res.status(404).json({ error: 'Not found' })
}

export async function errorHandler(error, req, res, _next) {
  const statusCode = Number(error?.statusCode || error?.status || 500)

  try {
    const { errorId } = await reportError({
      error,
      req,
      statusCode,
      source: 'express.error_middleware',
    })

    const userMessage = statusCode >= 500
      ? 'An unexpected error occurred. Please contact support with the error ID.'
      : error?.message || 'Request failed'

    return res.status(statusCode).json({
      error: userMessage,
      errorId,
    })
  } catch (reportingError) {
    console.error('[ErrorHandler] Failed to report error', reportingError)

    return res.status(500).json({
      error: 'An unexpected error occurred. Please contact support.',
    })
  }
}
