const QUEUE_STATE_TO_CANONICAL_STATUS = {
  completed: 'complete',
  failed: 'failed',
  active: 'processing',
  waiting: 'queued',
  delayed: 'queued',
  paused: 'queued',
  stuck: 'processing',
}

const PARSE_JOB_STATE_TO_CANONICAL_STATUS = {
  complete: 'complete',
  completed: 'complete',
  failed: 'failed',
  processing: 'processing',
  active: 'processing',
  retrying: 'retrying',
  pending: 'queued',
  queued: 'queued',
}

export function mapQueueStateToCanonicalStatus(queueState) {
  if (!queueState) return null
  return QUEUE_STATE_TO_CANONICAL_STATUS[String(queueState).toLowerCase()] || null
}

export function mapParseJobStateToCanonicalStatus(parseJobState) {
  if (!parseJobState) return null
  return PARSE_JOB_STATE_TO_CANONICAL_STATUS[String(parseJobState).toLowerCase()] || null
}

export function resolveCanonicalParseStatus({ queueState = null, parseJobState = null, fallback = 'queued' } = {}) {
  return (
    mapQueueStateToCanonicalStatus(queueState)
    || mapParseJobStateToCanonicalStatus(parseJobState)
    || fallback
  )
}

export function toLegacyParseStatus(canonicalStatus, fallbackStatus) {
  if (canonicalStatus === 'complete') return 'complete'
  if (canonicalStatus === 'failed') return 'failed'
  if (canonicalStatus === 'processing' || canonicalStatus === 'retrying') return 'processing'
  return fallbackStatus
}

export function normalizeParseStatus(queueStatus, fallbackStatus) {
  const canonical = resolveCanonicalParseStatus({
    queueState: queueStatus,
    parseJobState: fallbackStatus,
    fallback: fallbackStatus,
  })

  return toLegacyParseStatus(canonical, fallbackStatus)
}
