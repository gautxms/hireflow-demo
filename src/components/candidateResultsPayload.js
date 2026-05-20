import { normalizeCandidateResultsContract } from '../utils/normalizeCandidateResultsContract.js'

function normalizeCandidate(candidate = {}, index = 0) {
  return normalizeCandidateResultsContract(candidate, { index })
}

export function normalizeCandidateResultsPayload(payload) {
  if (Array.isArray(payload)) {
    return { candidates: payload.map((candidate, index) => normalizeCandidate(candidate, index)), parseMeta: {}, isInvalid: false }
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.candidates)) {
    return {
      candidates: payload.candidates.map((candidate, index) => normalizeCandidate(candidate, index)),
      parseMeta: payload.parseMeta && typeof payload.parseMeta === 'object' ? payload.parseMeta : {},
      isInvalid: false,
    }
  }

  return { candidates: [], parseMeta: {}, isInvalid: payload != null }
}