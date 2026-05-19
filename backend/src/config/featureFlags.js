const DEFAULT_ROLLOUT_PERCENT = 100

function parsePercent(value, fallback = DEFAULT_ROLLOUT_PERCENT) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric <= 0) return 0
  if (numeric >= 100) return 100
  return Math.floor(numeric)
}

function hashToBucket(identity) {
  const input = String(identity || '').trim()
  if (!input) return 0
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003
  }
  return Math.abs(hash % 100)
}

function isEnabledForRollout(identity, percent) {
  if (percent >= 100) return true
  if (percent <= 0) return false
  return hashToBucket(identity) < percent
}

const FEATURE_FLAGS = {
  enable_placeholder_retry: parsePercent(process.env.FF_ENABLE_PLACEHOLDER_RETRY_ROLLOUT, DEFAULT_ROLLOUT_PERCENT),
  enable_extended_resume_signals: parsePercent(process.env.FF_ENABLE_EXTENDED_RESUME_SIGNALS_ROLLOUT, DEFAULT_ROLLOUT_PERCENT),
  enable_validation_sample_logging: parsePercent(process.env.FF_ENABLE_VALIDATION_SAMPLE_LOGGING_ROLLOUT, DEFAULT_ROLLOUT_PERCENT),
}

export function getRolloutPercent(flagName) {
  return parsePercent(FEATURE_FLAGS[flagName], DEFAULT_ROLLOUT_PERCENT)
}

export function isFeatureEnabled(flagName, identity) {
  const percent = getRolloutPercent(flagName)
  return isEnabledForRollout(identity, percent)
}

export function getRolloutConfig(identity) {
  return {
    enable_placeholder_retry: isFeatureEnabled('enable_placeholder_retry', identity),
    enable_extended_resume_signals: isFeatureEnabled('enable_extended_resume_signals', identity),
    enable_validation_sample_logging: isFeatureEnabled('enable_validation_sample_logging', identity),
    rolloutPercents: {
      enable_placeholder_retry: getRolloutPercent('enable_placeholder_retry'),
      enable_extended_resume_signals: getRolloutPercent('enable_extended_resume_signals'),
      enable_validation_sample_logging: getRolloutPercent('enable_validation_sample_logging'),
    },
  }
}
