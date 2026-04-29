import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveBoundaryStateFromError } from './appErrorBoundaryState.js'

const inProgressSession = { jobId: 'job-1', parseStatus: 'processing' }

test('error boundary state enables fallback rendering when child throws', () => {
  const error = new Error('boom')
  const boundaryState = deriveBoundaryStateFromError(error, inProgressSession)

  assert.equal(boundaryState.hasError, true)
  assert.equal(boundaryState.error, error)
  assert.equal(boundaryState.resumeAvailable, true)
})
