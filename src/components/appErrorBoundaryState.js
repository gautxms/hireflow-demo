import { isSessionRecoverable } from './resumeAnalysisSession.js'

export function deriveBoundaryStateFromError(error, session, latestResult = null) {
  const hasRecoverableResult = Array.isArray(latestResult?.candidates) && latestResult.candidates.length > 0
  return {
    hasError: true,
    error,
    resumeAvailable: isSessionRecoverable(session) || hasRecoverableResult,
  }
}
