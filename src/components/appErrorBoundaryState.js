import { isSessionRecoverable } from './resumeAnalysisSession.js'

export function deriveBoundaryStateFromError(error, session) {
  return {
    hasError: true,
    error,
    resumeAvailable: isSessionRecoverable(session),
  }
}
