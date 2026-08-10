import { pool } from '../db/client.js'

export async function markCheckoutReservationCompleted({
  db = pool,
  reservationToken,
  userId,
  environment,
  transactionId,
  customerId = null,
}) {
  const normalizedToken = String(reservationToken || '').trim()
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedToken)
    || !userId
    || !['production', 'sandbox'].includes(environment)
    || !/^txn_[a-z0-9]+$/i.test(String(transactionId || ''))
  ) return { rowCount: 0, rows: [] }

  return db.query(
    `UPDATE paddle_checkout_reservations
     SET status = 'completed',
         paddle_transaction_id = COALESCE(paddle_transaction_id, $4),
         paddle_customer_id = COALESCE(paddle_customer_id, $5),
         checkout_url = NULL,
         provider_status = 'completed',
         failure_code = NULL,
         updated_at = NOW()
     WHERE reservation_token = $1::uuid
       AND user_id = $2
       AND paddle_environment = $3
       AND status IN ('creating', 'ready', 'completed')
       AND (paddle_transaction_id IS NULL OR paddle_transaction_id = $4)
     RETURNING id`,
    [normalizedToken, userId, environment, transactionId, customerId],
  )
}
