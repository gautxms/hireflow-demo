import test from 'node:test'
import assert from 'node:assert/strict'
import { logResultsRenderError, normalizeErrorFingerprint } from './resultsErrorBoundaryTelemetry.js'

test('normalizeErrorFingerprint normalizes whitespace and casing', () => {
  const fingerprint = normalizeErrorFingerprint({
    error: { name: 'TypeError', message: ' Cannot read   value ' },
    errorInfo: { componentStack: '\n at Foo\n   at Bar ' },
  })

  assert.equal(fingerprint, 'typeerror|cannot read value|at foo at bar')
})

test('logResultsRenderError emits structured telemetry when child throws', () => {
  const telemetryEvents = []
  const originalWindow = globalThis.window
  const mockWindow = originalWindow || {}
  const originalDispatch = mockWindow.dispatchEvent
  mockWindow.dispatchEvent = (event) => {
    telemetryEvents.push(event.detail)
    return true
  }
  globalThis.window = mockWindow

  const originalCustomEvent = globalThis.CustomEvent
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }

  const originalConsoleError = console.error
  let loggedContext = null
  console.error = (...args) => {
    if (String(args[0]).includes('AnalysisDetail results render error')) loggedContext = args[1]
  }

  const renderError = new Error('Child render explosion')
  logResultsRenderError({
    analysisId: 'analysis-123',
    candidateCount: 4,
    normalizationStats: { inputCount: 5, droppedCount: 1 },
    candidateFieldTypeSummary: [{ index: 0, id: 'c-1', matchScoreType: 'number', matchScoreScoreType: 'undefined', matchScoreReasonType: 'undefined', experienceType: 'string' }],
    error: renderError,
    errorInfo: { componentStack: '\n at ThrowingChild' },
  })

  assert.equal(telemetryEvents.length, 1)
  assert.equal(telemetryEvents[0].route, 'AnalysisDetail')
  assert.equal(telemetryEvents[0].analysisId, 'analysis-123')
  assert.equal(telemetryEvents[0].candidateCount, 4)
  assert.deepEqual(telemetryEvents[0].normalizationStats, { inputCount: 5, droppedCount: 1 })
  assert.equal(telemetryEvents[0].candidateFieldTypeSummary[0].id, 'c-1')
  assert.equal(telemetryEvents[0].candidateFieldTypeSummary[0].matchScoreType, 'number')
  assert.equal(telemetryEvents[0].errorMessage, 'Child render explosion')
  assert.equal(telemetryEvents[0].componentStack, '\n at ThrowingChild')
  assert.equal(
    telemetryEvents[0].normalizedErrorFingerprint,
    'error|child render explosion|at throwingchild',
  )
  assert.ok(loggedContext)

  mockWindow.dispatchEvent = originalDispatch
  console.error = originalConsoleError
  globalThis.CustomEvent = originalCustomEvent
  if (!originalWindow) delete globalThis.window
  else globalThis.window = originalWindow
})
