import { normalizeCandidateResultsContract } from '../utils/normalizeCandidateResultsContract.js'

function normalizeCandidate(candidate = {}, index = 0) {
  try {
    if (!candidate || typeof candidate !== 'object') return null
    return normalizeCandidateResultsContract(candidate, { index })
  } catch (error) {
    console.error('[CandidateResults] Failed to normalize candidate row; skipping.', {
      candidateIndex: index,
      candidateId: candidate?.id || candidate?.resumeId || candidate?.resume_id || '',
      error: error?.message || String(error),
    })
    return null
  }
}

export function normalizeCandidateResultsPayload(payload) {
  const normalizeCandidates = (rows) => (
    (Array.isArray(rows) ? rows : [])
      .map((candidate, index) => normalizeCandidate(candidate, index))
      .filter(Boolean)
  )

  if (Array.isArray(payload)) {
    return { candidates: normalizeCandidates(payload), parseMeta: {}, isInvalid: false }
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.candidates)) {
    return {
      candidates: normalizeCandidates(payload.candidates),
      parseMeta: payload.parseMeta && typeof payload.parseMeta === 'object' ? payload.parseMeta : {},
      isInvalid: false,
    }
  }

  return { candidates: [], parseMeta: {}, isInvalid: payload != null }
}
