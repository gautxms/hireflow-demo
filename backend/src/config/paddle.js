const DEFAULT_PADDLE_API_BASE_URL = 'https://api.paddle.com'
const DEFAULT_PADDLE_ENVIRONMENT = 'production'

function normalizeEnvironment(envValue) {
  const normalized = String(envValue || DEFAULT_PADDLE_ENVIRONMENT).toLowerCase()
  return normalized === 'sandbox' ? 'sandbox' : 'production'
}

function firstDefined(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}

function parseCommaSeparatedIds(value) {
  if (typeof value !== 'string') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function resolvePaddleConfig(env = process.env) {
  const environment = normalizeEnvironment(env.PADDLE_ENVIRONMENT)
  const isSandbox = environment === 'sandbox'
  const isProduction = environment === 'production'

  const apiBaseUrl = firstDefined(
    isSandbox ? env.PADDLE_SANDBOX_API_BASE_URL : env.PADDLE_PRODUCTION_API_BASE_URL,
    env.PADDLE_API_BASE_URL,
    DEFAULT_PADDLE_API_BASE_URL,
  )

  const isTestCheckoutEnabled = env.PADDLE_ENABLE_TEST_CHECKOUT === 'true'
  const isTestUpgradeEnabled = env.PADDLE_ENABLE_TEST_UPGRADE === 'true'

  const priceIdsByPlan = {
    monthly: firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_MONTHLY_PRICE_ID : env.PADDLE_PRODUCTION_MONTHLY_PRICE_ID,
      isProduction ? env.PADDLE_MONTHLY_PRICE_ID : undefined,
    ),
    annual: firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_ANNUAL_PRICE_ID : env.PADDLE_PRODUCTION_ANNUAL_PRICE_ID,
      isProduction ? env.PADDLE_ANNUAL_PRICE_ID : undefined,
    ),
  }

  if (isTestCheckoutEnabled) {
    priceIdsByPlan['test-monthly'] = firstDefined(env.PADDLE_TEST_MONTHLY_PRICE_ID)
  }

  const legacyPriceIdsByPlan = {
    monthly: parseCommaSeparatedIds(firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_MONTHLY_LEGACY_PRICE_IDS : env.PADDLE_PRODUCTION_MONTHLY_LEGACY_PRICE_IDS,
    )),
    annual: parseCommaSeparatedIds(firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_ANNUAL_LEGACY_PRICE_IDS : env.PADDLE_PRODUCTION_ANNUAL_LEGACY_PRICE_IDS,
    )),
  }

  return {
    environment,
    apiBaseUrl,
    apiVersion: env.PADDLE_API_VERSION || '1',
    apiKey: firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_API_KEY : env.PADDLE_PRODUCTION_API_KEY,
      isProduction ? env.PADDLE_API_KEY : undefined,
    ),
    clientToken: firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_CLIENT_TOKEN : env.PADDLE_PRODUCTION_CLIENT_TOKEN,
      isProduction ? env.PADDLE_CLIENT_TOKEN : undefined,
    ),
    webhookSecret: firstDefined(
      isSandbox ? env.PADDLE_SANDBOX_WEBHOOK_SECRET : env.PADDLE_PRODUCTION_WEBHOOK_SECRET,
      isProduction ? env.PADDLE_WEBHOOK_SECRET : undefined,
    ),
    priceIdsByPlan,
    legacyPriceIdsByPlan,
    testCheckout: {
      enabled: isTestCheckoutEnabled,
      key: firstDefined(env.PADDLE_TEST_CHECKOUT_KEY),
    },
    testUpgrade: {
      enabled: isTestUpgradeEnabled,
      key: firstDefined(env.PADDLE_TEST_UPGRADE_KEY),
      annualPriceId: firstDefined(env.PADDLE_TEST_ANNUAL_PRICE_ID),
      monthlyPriceId: firstDefined(env.PADDLE_TEST_MONTHLY_PRICE_ID),
    },
  }
}
