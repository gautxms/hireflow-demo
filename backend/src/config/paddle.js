const DEFAULT_PADDLE_API_BASE_URL = 'https://api.paddle.com'
const DEFAULT_PADDLE_ENVIRONMENT = 'production'

function normalizeEnvironment(envValue) {
  const normalized = String(envValue || DEFAULT_PADDLE_ENVIRONMENT).toLowerCase()
  return normalized === 'sandbox' ? 'sandbox' : 'production'
}

function firstDefined(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}

export function resolvePaddleConfig(env = process.env) {
  const environment = normalizeEnvironment(env.PADDLE_ENVIRONMENT)
  const isSandbox = environment === 'sandbox'

  const apiBaseUrl = firstDefined(
    isSandbox ? env.PADDLE_SANDBOX_API_BASE_URL : undefined,
    env.PADDLE_API_BASE_URL,
    DEFAULT_PADDLE_API_BASE_URL,
  )

  return {
    environment,
    apiBaseUrl,
    apiVersion: env.PADDLE_API_VERSION || '1',
    apiKey: firstDefined(isSandbox ? env.PADDLE_SANDBOX_API_KEY : undefined, env.PADDLE_API_KEY),
    clientToken: firstDefined(isSandbox ? env.PADDLE_SANDBOX_CLIENT_TOKEN : undefined, env.PADDLE_CLIENT_TOKEN),
    webhookSecret: firstDefined(isSandbox ? env.PADDLE_SANDBOX_WEBHOOK_SECRET : undefined, env.PADDLE_WEBHOOK_SECRET),
    priceIdsByPlan: {
      monthly: firstDefined(isSandbox ? env.PADDLE_SANDBOX_MONTHLY_PRICE_ID : undefined, env.PADDLE_MONTHLY_PRICE_ID),
      annual: firstDefined(isSandbox ? env.PADDLE_SANDBOX_ANNUAL_PRICE_ID : undefined, env.PADDLE_ANNUAL_PRICE_ID),
    },
  }
}
