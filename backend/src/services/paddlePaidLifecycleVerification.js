const CHECKOUT_RESERVATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function customDataFromPayload(payload = {}) {
  return payload?.data?.custom_data || payload?.custom_data || {}
}

function dataFromPayload(payload = {}) {
  return payload?.data || payload || {}
}

export function transactionPriceIds(transaction = {}) {
  return (transaction.items || [])
    .map((item) => item?.price_id || item?.price?.id)
    .filter(Boolean)
}

export function transactionMatchesCheckoutReservation(transaction = {}, reservation = {}, user = {}) {
  const customData = transaction.custom_data || {}
  const transactionUserId = customData.userId ?? customData.user_id
  const reservationToken = customData.checkoutReservationId ?? customData.checkout_reservation_id

  return String(transactionUserId || '') === String(user.id || '')
    && String(reservationToken || '') === String(reservation.reservation_token || '')
    && customData.paddleEnvironment === reservation.paddle_environment
    && customData.requestedPlan === reservation.requested_plan
    && customData.plan === reservation.stored_plan
    && customData.checkoutMode === reservation.checkout_mode
    && customData.trialEligible === reservation.trial_eligible
    && transactionPriceIds(transaction).includes(reservation.price_id)
    && (!user.paddle_customer_id || transaction.customer_id === user.paddle_customer_id)
}

export async function verifyNewPaidLifecycleCheckoutEvidence({
  db,
  user,
  payload,
  environment,
  plan,
  priceId,
  customerId,
  transactionId = null,
}) {
  const data = dataFromPayload(payload)
  const customData = customDataFromPayload(payload)
  const reservationToken = customData.checkoutReservationId ?? customData.checkout_reservation_id
  const normalizedTransactionId = String(transactionId || '').trim() || null

  if (
    !db?.query
    || !user?.id
    || !CHECKOUT_RESERVATION_PATTERN.test(String(reservationToken || ''))
    || !['sandbox', 'production'].includes(environment)
    || !plan
    || !priceId
    || !customerId
    || !['paid_returning', 'test'].includes(customData.checkoutMode)
    || customData.trialEligible !== false
  ) {
    return { verified: false, reason: 'new_paid_lifecycle_evidence_incomplete' }
  }

  const result = await db.query(
    `SELECT id, reservation_token, user_id, paddle_environment, requested_plan, stored_plan,
            price_id, trial_eligible, checkout_mode, status, paddle_transaction_id,
            paddle_customer_id
     FROM paddle_checkout_reservations
     WHERE reservation_token = $1::uuid
       AND user_id = $2
       AND paddle_environment = $3
       AND stored_plan = $4
       AND price_id = $5
       AND checkout_mode = $6
       AND trial_eligible = FALSE
       AND status IN ('ready', 'completed')
       AND paddle_customer_id = $7
       AND paddle_transaction_id IS NOT NULL
       AND ($8::text IS NULL OR paddle_transaction_id = $8)
     LIMIT 1`,
    [
      reservationToken,
      user.id,
      environment,
      plan,
      priceId,
      customData.checkoutMode,
      customerId,
      normalizedTransactionId,
    ],
  )
  const reservation = result.rows?.[0] || null
  if (!reservation) {
    return { verified: false, reason: 'new_paid_lifecycle_reservation_mismatch' }
  }

  const evidence = {
    ...data,
    customer_id: customerId,
    custom_data: customData,
  }
  if (!transactionMatchesCheckoutReservation(evidence, reservation, user)) {
    return { verified: false, reason: 'new_paid_lifecycle_checkout_mismatch' }
  }

  return { verified: true, reservation }
}
