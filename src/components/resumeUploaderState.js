export const ANALYZE_WITHOUT_JOB_DESCRIPTION_LABEL = 'Analyze without Job Description'

export function toOptionalJobDescriptionId(selectedJobDescriptionId) {
  const normalized = String(selectedJobDescriptionId || '').trim()
  return normalized || undefined
}

export function buildChunkInitPayload({ filename, fileSize, mimeType, selectedJobDescriptionId, analysisId }) {
  const payload = {
    filename,
    fileSize,
    mimeType,
  }

  const optionalJobDescriptionId = toOptionalJobDescriptionId(selectedJobDescriptionId)
  if (optionalJobDescriptionId) {
    payload.jobDescriptionId = optionalJobDescriptionId
  }
  const optionalAnalysisId = String(analysisId || '').trim()
  if (optionalAnalysisId) {
    payload.analysisId = optionalAnalysisId
  }

  return payload
}

export function resolveSelectedJobDescriptionId(currentSelection, eligibleJobDescriptions) {
  const selected = String(currentSelection || '').trim()
  if (!selected) {
    return ''
  }

  const eligible = Array.isArray(eligibleJobDescriptions) ? eligibleJobDescriptions : []
  return eligible.some((item) => item.id === selected) ? selected : ''
}
