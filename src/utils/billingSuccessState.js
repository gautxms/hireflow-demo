const PADDLE_TRANSACTION_PATTERN = /^txn_[a-z0-9]+$/i
const CHECKOUT_RESERVATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORTED_PLANS = new Set(['monthly', 'annual', 'starter_monthly', 'starter_annual', 'growth_monthly', 'growth_annual', 'pro_monthly', 'pro_annual', 'test-monthly'])

export const PADDLE_LAST_TRANSACTION_STORAGE_KEY = 'paddle_last_transaction'

function validTransactionId(value) {
  const normalized = String(value || '').trim()
  return PADDLE_TRANSACTION_PATTERN.test(normalized) ? normalized : ''
}

function validReservationId(value) {
  const normalized = String(value || '').trim()
  return CHECKOUT_RESERVATION_PATTERN.test(normalized) ? normalized : ''
}

function validPlan(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return SUPPORTED_PLANS.has(normalized) ? normalized : ''
}

export function completedCheckoutNavigation(payload = {}) {
  const transactionId = validTransactionId(payload.transactionId)
  const checkoutReservationId = validReservationId(payload.checkoutReservationId)
  const plan = validPlan(payload.plan)
  if (payload.code !== 'checkout_completed' || !transactionId || !checkoutReservationId || !plan) return null

  const params = new URLSearchParams({
    transaction: transactionId,
    checkout: checkoutReservationId,
    plan,
  })
  return {
    path: `/billing/success?${params}`,
    state: { transactionId, checkoutReservationId, plan },
  }
}

export function verifiedCheckoutNavigation(payload = {}, appOrigin) {
  const transactionId = validTransactionId(payload.transactionId)
  const checkoutReservationId = validReservationId(payload.checkoutReservationId)
  const plan = validPlan(payload.plan)
  if (!transactionId || !checkoutReservationId || !plan || typeof payload.successUrl !== 'string') return null

  try {
    const origin = new URL(appOrigin).origin
    const url = new URL(payload.successUrl)
    if (url.origin !== origin || url.pathname !== '/billing/success' || url.hash
      || [...url.searchParams.keys()].sort().join(',') !== 'checkout,plan,transaction'
      || url.searchParams.get('transaction') !== transactionId
      || url.searchParams.get('checkout') !== checkoutReservationId
      || url.searchParams.get('plan') !== plan) return null
    return {
      url: url.toString(),
      path: `${url.pathname}${url.search}`,
      state: { transactionId, checkoutReservationId, plan },
    }
  } catch {
    return null
  }
}

export function resolveBillingSuccessState({
  historyState = {},
  search = '',
  storage = null,
} = {}) {
  const safeHistoryState = historyState && typeof historyState === 'object' ? historyState : {}
  const params = new URLSearchParams(search)
  const storedTransactionId = storage?.getItem?.(PADDLE_LAST_TRANSACTION_STORAGE_KEY) || ''

  return {
    transactionId: validTransactionId(params.get('transaction'))
      || validTransactionId(safeHistoryState.transactionId)
      || validTransactionId(storedTransactionId),
    checkoutReservationId: validReservationId(params.get('checkout'))
      || validReservationId(safeHistoryState.checkoutReservationId),
    plan: validPlan(params.get('plan')) || validPlan(safeHistoryState.plan),
    message: typeof safeHistoryState.message === 'string' ? safeHistoryState.message : '',
  }
}
