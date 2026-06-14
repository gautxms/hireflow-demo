const SCORING_CONTRACT_VERSION = 'shadow_v1'

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10
}

function resolveMatchScore(candidate = {}) {
  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    return normalizeOptionalNumber(candidate.matchScore.score)
  }

  return normalizeOptionalNumber(candidate?.matchScore)
}

function resolveModelAuthoredOutOfTen(candidate = {}) {
  if (candidate?.matchScore && typeof candidate.matchScore === 'object' && !Array.isArray(candidate.matchScore)) {
    return normalizeOptionalNumber(candidate.matchScore.score_out_of_ten)
  }

  return null
}

function resolveResultsScore(candidate = {}) {
  const matchScore = resolveMatchScore(candidate)
  if (matchScore !== null) {
    return { value: matchScore, source: 'matchScore.score' }
  }

  const candidateScore = normalizeOptionalNumber(candidate?.score)
  if (candidateScore !== null) {
    return { value: candidateScore, source: 'candidate.score' }
  }

  return { value: null, source: 'missing' }
}

function resolveDirectoryProfileScore(candidate = {}, metadata = {}) {
  const profileScore = normalizeOptionalNumber(candidate?.profileScore)
  if (profileScore !== null) return { value: profileScore, source: 'profileScore' }

  const profileSnakeScore = normalizeOptionalNumber(candidate?.profile_score)
  if (profileSnakeScore !== null) return { value: profileSnakeScore, source: 'profile_score' }

  const metadataScore = normalizeOptionalNumber(metadata?.profileScore)
  if (metadataScore !== null) return { value: metadataScore, source: 'metadata.profileScore' }

  return { value: null, source: 'missing' }
}

function differs(left, right) {
  return left !== null && right !== null && left !== right
}

export function buildScoreContractShadowDiagnostic(candidate = {}, metadata = {}) {
  const candidateScore = normalizeOptionalNumber(candidate?.score)
  const matchScore = resolveMatchScore(candidate)
  const modelAuthoredOutOfTen = resolveModelAuthoredOutOfTen(candidate)
  const appDerivedOutOfTen = matchScore === null ? null : roundToOneDecimal(matchScore / 10)
  const fitScore = normalizeOptionalNumber(
    candidate?.fit_assessment?.overall_fit_score
    ?? candidate?.fitAssessment?.overallFitScore,
  )
  const directoryProfile = resolveDirectoryProfileScore(candidate, metadata)
  const profileScore = directoryProfile.value
  const resultsResolution = resolveResultsScore(candidate)

  return {
    scoring_contract_version: SCORING_CONTRACT_VERSION,
    candidate_score: candidateScore,
    match_score: matchScore,
    model_authored_score_out_of_ten: modelAuthoredOutOfTen,
    app_derived_score_out_of_ten: appDerivedOutOfTen,
    fit_score: fitScore,
    profile_score: profileScore,
    current_results_score_resolution: resultsResolution.source,
    current_directory_profile_score_resolution: directoryProfile.source,
    candidate_score_differs_from_match_score: differs(candidateScore, matchScore),
    fit_score_differs_from_match_score: differs(fitScore, matchScore),
    model_out_of_ten_differs_from_app_derived: differs(modelAuthoredOutOfTen, appDerivedOutOfTen),
    role_fit_score_missing: matchScore === null,
    profile_score_used_as_fallback: matchScore === null && profileScore !== null,
  }
}

function parseAllowlist(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isAllowedByList(value, rawAllowlist) {
  const allowlist = parseAllowlist(rawAllowlist)
  if (allowlist.length === 0) return true
  if (value === null || value === undefined || value === '') return false
  return allowlist.includes(String(value))
}

function isAllowedBySampleRate(rawRate, random = Math.random) {
  if (rawRate === undefined || rawRate === null || rawRate === '') return true
  const rate = Number(rawRate)
  if (!Number.isFinite(rate)) return false
  if (rate <= 0) return false
  if (rate >= 1) return true
  return random() < rate
}

export function isScoreContractShadowEnabled(metadata = {}, env = process.env, random = Math.random) {
  if (String(env.SCORING_CONTRACT_V1_SHADOW || 'false').toLowerCase() !== 'true') {
    return false
  }

  return isAllowedByList(metadata.userId, env.SCORING_CONTRACT_V1_SHADOW_ALLOWED_USER_IDS)
    && isAllowedByList(metadata.analysisId, env.SCORING_CONTRACT_V1_SHADOW_ALLOWED_ANALYSIS_IDS)
    && isAllowedBySampleRate(env.SCORING_CONTRACT_V1_SHADOW_SAMPLE_RATE, random)
}

export function emitScoreContractShadowDiagnostic(candidate, metadata = {}, { logger = console, env = process.env, random = Math.random } = {}) {
  if (!isScoreContractShadowEnabled(metadata, env, random)) {
    return null
  }

  const diagnostic = buildScoreContractShadowDiagnostic(candidate, metadata)
  logger.info('[ScoringContractShadow] score contract diagnostic', diagnostic)
  return diagnostic
}
