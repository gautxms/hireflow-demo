import { Router } from 'express'
import { logTelemetryToDatabase } from '../db/client.js'

const router = Router()

function normalizeTelemetryPayload(payload = {}) {
  const analysisId = String(payload.analysisId || '').trim()
  return {
    ...payload,
    analysisId,
    candidateCount: Number(payload.candidateCount || 0),
    componentStack: String(payload.componentStack || ''),
    normalizedErrorFingerprint: String(payload.normalizedErrorFingerprint || ''),
  }
}

router.post('/client', async (req, res) => {
  const payload = normalizeTelemetryPayload(req.body || {})

  try {
    await logTelemetryToDatabase('frontend', payload)
    return res.status(202).json({ ok: true })
  } catch (error) {
    console.error('[Telemetry] Failed to persist client telemetry event', {
      message: error?.message || String(error),
      eventType: payload?.eventType || null,
      analysisId: payload?.analysisId || null,
    })
    return res.status(500).json({ error: 'Failed to persist telemetry' })
  }
})

export default router
