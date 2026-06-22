import crypto from 'node:crypto'

const SCORING_CONTRACT_VERSION = 'shadow_v1'
const AI_SCORING_CONTRACT_V2_VERSION = 'v2_shadow'

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function fingerprint(value) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return null
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
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

function resolveSafeMetadata(candidate = {}, metadata = {}) {
  return {
    user_id: normalizeOptionalString(metadata.userId ?? metadata.user_id),
    analysis_id: normalizeOptionalString(metadata.analysisId ?? metadata.analysis_id),
    resume_id: normalizeOptionalString(metadata.resumeId ?? metadata.resume_id ?? candidate?.resumeId ?? candidate?.resume_id),
    provider: normalizeOptionalString(metadata.provider ?? candidate?.provider),
    model: normalizeOptionalString(metadata.model ?? candidate?.model),
    prompt_version: normalizeOptionalString(metadata.promptVersion ?? metadata.prompt_version ?? candidate?.promptVersion ?? candidate?.prompt_version),
  }
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
  const safeMetadata = resolveSafeMetadata(candidate, metadata)

  return {
    ...safeMetadata,
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

function resolveVisibleScore(candidate = {}) {
  const matchScore = resolveMatchScore(candidate)
  if (matchScore !== null) return matchScore

  const fitAssessmentScore = normalizeOptionalNumber(
    candidate?.fit_assessment?.overall_fit_score
    ?? candidate?.fitAssessment?.overallFitScore,
  )
  if (fitAssessmentScore !== null) return fitAssessmentScore

  return normalizeOptionalNumber(candidate?.score)
}

function resolveV2WeightedTotalScore(candidate = {}) {
  return normalizeOptionalNumber(candidate?.ai_scoring_contract_v2?.weighted_total_score_recomputed)
}

function resolveV2AiWeightedTotalScore(candidate = {}) {
  return normalizeOptionalNumber(candidate?.ai_scoring_contract_v2?.weighted_total_score)
}

function resolveVisibleFitScore(candidate = {}) {
  return normalizeOptionalNumber(candidate?.fit_assessment?.overall_fit_score ?? candidate?.fitAssessment?.overallFitScore)
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value
  return Boolean(value)
}

function resolveDeltaDirection({ visibleScore, v2Score, delta }) {
  if (v2Score === null || visibleScore === null || delta === null) return 'unknown'
  if (delta > 0) return 'v2_higher'
  if (delta < 0) return 'v2_lower'
  return 'same'
}

function resolveDeltaBucket(absoluteScoreDelta) {
  if (absoluteScoreDelta === null) return null
  if (absoluteScoreDelta <= 2) return '0_to_2'
  if (absoluteScoreDelta <= 5) return '2_to_5'
  if (absoluteScoreDelta <= 10) return '5_to_10'
  return '10_plus'
}

function buildSkipReason({ visibleScore, v2Score }) {
  if (visibleScore === null) return 'missing_visible_score'
  if (v2Score === null) return 'missing_v2_score'
  return null
}

export function buildAiScoringContractV2ScoreDeltaDiagnostic({
  candidate = {},
  parseDiagnostics = {},
  fileExtension = null,
  metadata = {},
} = {}) {
  const visibleScore = resolveVisibleScore(candidate)
  const visibleMatchScore = resolveMatchScore(candidate)
  const visibleFitScore = resolveVisibleFitScore(candidate)
  const v2Score = resolveV2WeightedTotalScore(candidate)
  const v2WeightedTotalFromAi = resolveV2AiWeightedTotalScore(candidate)
  const hasBothScores = visibleScore !== null && v2Score !== null
  const scoreDelta = hasBothScores ? roundToOneDecimal(v2Score - visibleScore) : null
  const absoluteScoreDelta = hasBothScores ? roundToOneDecimal(Math.abs(scoreDelta)) : null
  const contract = candidate?.ai_scoring_contract_v2 && typeof candidate.ai_scoring_contract_v2 === 'object' && !Array.isArray(candidate.ai_scoring_contract_v2)
    ? candidate.ai_scoring_contract_v2
    : null
  const skipReason = buildSkipReason({ visibleScore, v2Score })

  return {
    event_type: skipReason ? 'skip' : 'delta',
    skip_reason: skipReason,
    analysis_id: normalizeOptionalString(metadata.analysisId ?? metadata.analysis_id),
    resume_id: normalizeOptionalString(metadata.resumeId ?? metadata.resume_id ?? candidate?.resumeId ?? candidate?.resume_id),
    parse_job_id: normalizeOptionalString(metadata.parseJobId ?? metadata.parse_job_id),
    candidate_id: normalizeOptionalString(metadata.candidateId ?? metadata.candidate_id ?? candidate?.id ?? candidate?.candidateId ?? candidate?.candidate_id),
    original_filename_fingerprint: fingerprint(metadata.originalFilename ?? metadata.original_filename ?? parseDiagnostics?.originalFilename ?? parseDiagnostics?.original_filename ?? candidate?.originalFilename ?? candidate?.original_filename ?? candidate?.filename),
    file_extension: normalizeOptionalString(fileExtension ?? parseDiagnostics?.extension ?? parseDiagnostics?.sourceFormat),
    extraction_method: normalizeOptionalString(parseDiagnostics?.extractionMethod ?? parseDiagnostics?.extraction_method),
    normalized_text_fingerprint: normalizeOptionalString(parseDiagnostics?.normalizedTextFingerprint ?? parseDiagnostics?.normalized_text_fingerprint),
    normalizedTextCharCount: normalizeOptionalNumber(parseDiagnostics?.normalizedTextCharCount),
    visible_score: visibleScore,
    visible_fit_score: visibleFitScore,
    visible_match_score: visibleMatchScore,
    v2_weighted_total_score_recomputed: v2Score,
    v2_weighted_total_score_from_ai: v2WeightedTotalFromAi,
    score_delta: scoreDelta,
    absolute_score_delta: absoluteScoreDelta,
    delta_bucket: resolveDeltaBucket(absoluteScoreDelta),
    delta_direction: resolveDeltaDirection({ visibleScore, v2Score, delta: scoreDelta }),
    score_delta_direction: resolveDeltaDirection({ visibleScore, v2Score, delta: scoreDelta }),
    score_delta_flagged: absoluteScoreDelta !== null && absoluteScoreDelta >= 7,
    score_confidence: normalizeOptionalString(contract?.score_confidence),
    scoring_anomalies: Array.isArray(contract?.scoring_anomalies) ? contract.scoring_anomalies.map(normalizeOptionalString).filter(Boolean).slice(0, 10) : [],
    has_job_description_context: normalizeBoolean(contract?.has_job_description_context ?? metadata.hasJobDescriptionContext ?? metadata.has_job_description_context),
    scoring_contract_version: normalizeOptionalString(contract?.scoring_contract_version) || AI_SCORING_CONTRACT_V2_VERSION,
    provider: normalizeOptionalString(metadata.provider ?? candidate?.provider),
    model: normalizeOptionalString(metadata.model ?? candidate?.model),
    prompt_version: normalizeOptionalString(metadata.promptVersion ?? metadata.prompt_version ?? candidate?.promptVersion ?? candidate?.prompt_version),
    compact_mode: metadata.compactMode ?? metadata.compact_mode ?? null,
    v2_shadow_present: Boolean(contract),
  }
}

export function emitAiScoringContractV2ScoreDeltaDiagnostic({
  candidate = {},
  parseDiagnostics = {},
  fileExtension = null,
  metadata = {},
  logger = console,
} = {}) {
  const diagnostic = buildAiScoringContractV2ScoreDeltaDiagnostic({ candidate, parseDiagnostics, fileExtension, metadata })
  try {
    if (diagnostic?.skip_reason) {
      logger.info?.('[AiScoringContractV2] visible_vs_shadow_score_delta_skipped', diagnostic)
      return diagnostic
    }
    logger.info?.('[AiScoringContractV2] visible_vs_shadow_score_delta', diagnostic)
  } catch (_) {
    // Diagnostics must never affect analysis completion.
  }
  return diagnostic
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
