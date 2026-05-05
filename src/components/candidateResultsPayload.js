export function normalizeCandidateResultsPayload(payload) {
  if (Array.isArray(payload)) {
    return { candidates: payload, parseMeta: {}, isInvalid: false }
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.candidates)) {
    return {
      candidates: payload.candidates,
      parseMeta: payload.parseMeta && typeof payload.parseMeta === 'object' ? payload.parseMeta : {},
      isInvalid: false,
    }
  }

  return { candidates: [], parseMeta: {}, isInvalid: payload != null }
}
