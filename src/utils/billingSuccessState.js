const PADDLE_TRANSACTION_PATTERN = /^txn_[a-z0-9]+$/i
const CHECKOUT_RESERVATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SUPPORTED_PLANS = new Set(['monthly', 'annual', 'test-monthly'])

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

export function resolveBillingSuccessState({
  historyState = {},
  search = '',
  storage = null,
} = {}) {
  const safeHistoryState = historyState && typeof historyState === 'object' ? historyState : {}
  const params = new URLSearchParams(search)
  const storedTransactionId = storage?.getItem?.(PADDLE_LAST_TRANSACTION_STORAGE_KEY) || ''

  return {
    transactionId: validTransactionId(safeHistoryState.transactionId) || validTransactionId(storedTransactionId),
    checkoutReservationId: validReservationId(safeHistoryState.checkoutReservationId)
      || validReservationId(params.get('checkout')),
    plan: validPlan(safeHistoryState.plan) || validPlan(params.get('plan')) || 'monthly',
    message: typeof safeHistoryState.message === 'string' ? safeHistoryState.message : '',
  }
}
