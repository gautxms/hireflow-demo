import { pool } from '../db/client.js'
import { resolvePaddleConfig } from '../config/paddle.js'
import { getConfiguredPaddleEnvironments } from './paddleBillingReadiness.js'
import { reconcilePaddleSubscriptionState } from './paddleSubscriptionReconciliation.js'

export const PADDLE_RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000
export const PADDLE_RECONCILIATION_SUCCESS_COOLDOWN_MINUTES = 6 * 60
export const PADDLE_RECONCILIATION_FAILURE_COOLDOWN_MINUTES = 15
export const PADDLE_RECONCILIATION_BATCH_SIZE = 20
export const PADDLE_RECONCILIATION_REQUEST_TIMEOUT_MS = 10_000

// This lock is scoped only to automatic subscription reconciliation. Holding a
// session-level advisory lock prevents overlapping Railway instances from
// running the same bounded sweep without holding a transaction or row lock
// while Paddle is called.
export const PADDLE_RECONCILIATION_ADVISORY_LOCK_ID = 734_219_071

const ELIGIBLE_LOCAL_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'payment_failed',
  'paused',
  'canceled',
  'cancelled',
]

function safeProviderId(value) {
  const text = String(value || '')
  if (text.length <= 12) return text || null
  return `${text.slice(0, 4)}...${text.slice(-6)}`
}

function errorCode(error) {
  return error?.code || error?.name || 'UNKNOWN_ERROR'
}

function candidateLogContext(user, extra = {}) {
  return {
    userId: user?.id || null,
    environment: user?.paddle_environment || null,
    providerCustomerId: safeProviderId(user?.paddle_customer_id),
    providerSubscriptionId: safeProviderId(user?.paddle_subscription_id),
    ...extra,
  }
}

export async function fetchPaddleSubscriptionForReconciliation({
  user,
  paddle,
  fetchImpl = fetch,
  timeoutMs = PADDLE_RECONCILIATION_REQUEST_TIMEOUT_MS,
}) {
  if (!paddle?.apiKey) {
    const error = new Error('Paddle API key is unavailable for automatic reconciliation')
    error.code = 'PADDLE_RECONCILIATION_CONFIG_MISSING'
    throw error
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref?.()

  try {
    const response = await fetchImpl(
      `${paddle.apiBaseUrl}/subscriptions/${encodeURIComponent(user.paddle_subscription_id)}`,
      {
        headers: {
          Authorization: `Bearer ${paddle.apiKey}`,
          'Content-Type': 'application/json',
          'Paddle-Version': paddle.apiVersion,
        },
        signal: controller.signal,
      },
    )
    const payload = await response.json().catch(() => ({}))

    if (response.status === 404) {
      const error = new Error('Linked Paddle subscription was not found')
      error.code = 'PADDLE_SUBSCRIPTION_NOT_FOUND'
      error.status = 404
      throw error
    }

    if (!response.ok) {
      const error = new Error('Paddle subscription reconciliation request failed')
      error.code = `PADDLE_RECONCILIATION_HTTP_${response.status}`
      error.status = response.status
      throw error
    }

    const subscription = payload?.data || payload
    if (!subscription?.id) {
      const error = new Error('Paddle subscription response is incomplete')
      error.code = 'PADDLE_RECONCILIATION_RESPONSE_INVALID'
      throw error
    }
    return subscription
  } catch (error) {
    if (error?.name === 'AbortError') {
      error.code = 'PADDLE_RECONCILIATION_TIMEOUT'
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function markAttempt(lockClient, user) {
  const result = await lockClient.query(
    `UPDATE users
     SET last_paddle_reconciliation_attempt_at = NOW()
     WHERE id = $1
       AND paddle_subscription_id = $2
       AND paddle_customer_id = $3
       AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $4
     RETURNING last_paddle_reconciliation_attempt_at`,
    [user.id, user.paddle_subscription_id, user.paddle_customer_id, user.paddle_environment],
  )
  return result.rows[0]?.last_paddle_reconciliation_attempt_at || null
}

async function markSuccess(lockClient, user, attemptAt) {
  await lockClient.query(
    `UPDATE users
     SET last_paddle_reconciled_at = NOW()
     WHERE id = $1
       AND paddle_subscription_id = $2
       AND paddle_customer_id = $3
       AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = $4
       AND last_paddle_reconciliation_attempt_at IS NOT DISTINCT FROM $5::timestamptz`,
    [user.id, user.paddle_subscription_id, user.paddle_customer_id, user.paddle_environment, attemptAt],
  )
}

function candidateQuery() {
  return `SELECT id, subscription_status, subscription_plan, current_period_end,
                 subscription_renewal_date, next_billing_date, cancellation_effective_at,
                 cancellation_reason, paddle_customer_id, paddle_subscription_id,
                 COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') AS paddle_environment,
                 last_paddle_event_at, trial_ends_at, trial_consumed_at,
                 last_paddle_reconciliation_attempt_at, last_paddle_reconciled_at
          FROM users
          WHERE deleted_at IS NULL
            AND NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL
            AND NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL
            AND COALESCE(NULLIF(LOWER(paddle_environment), ''), 'production') = ANY($1::text[])
            AND LOWER(COALESCE(subscription_status, '')) = ANY($2::text[])
            AND (
              last_paddle_reconciliation_attempt_at IS NULL
              OR (
                (
                  last_paddle_reconciled_at IS NULL
                  OR last_paddle_reconciliation_attempt_at > last_paddle_reconciled_at
                )
                AND last_paddle_reconciliation_attempt_at
                    <= NOW() - ($3::integer * INTERVAL '1 minute')
              )
              OR last_paddle_reconciliation_attempt_at
                   <= NOW() - ($4::integer * INTERVAL '1 minute')
            )
          ORDER BY last_paddle_reconciliation_attempt_at ASC NULLS FIRST, id
          LIMIT $5`
}

export async function runAutomaticPaddleSubscriptionReconciliation(dependencies = {}) {
  const db = dependencies.db || pool
  const env = dependencies.env || process.env
  const environments = dependencies.environments || getConfiguredPaddleEnvironments(env)
  const batchSize = dependencies.batchSize || PADDLE_RECONCILIATION_BATCH_SIZE
  const loadSubscription = dependencies.loadSubscription || fetchPaddleSubscriptionForReconciliation
  const reconcile = dependencies.reconcile || reconcilePaddleSubscriptionState
  const resolveConfig = dependencies.resolveConfig || ((environment) => resolvePaddleConfig(env, environment))
  const summary = {
    selected: 0,
    attempted: 0,
    updated: 0,
    already_current: 0,
    failed: 0,
    skipped: 0,
    overlap_skipped: false,
  }

  if (environments.length === 0) return summary

  const lockClient = await db.connect()
  let lockAcquired = false
  try {
    const lock = await lockClient.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [PADDLE_RECONCILIATION_ADVISORY_LOCK_ID],
    )
    lockAcquired = lock.rows[0]?.acquired === true
    if (!lockAcquired) {
      summary.overlap_skipped = true
      console.info('[Paddle subscription reconciliation] automatic run skipped because another instance owns the lock')
      return summary
    }

    const candidates = await lockClient.query(
      candidateQuery(),
      [
        environments,
        ELIGIBLE_LOCAL_STATUSES,
        PADDLE_RECONCILIATION_FAILURE_COOLDOWN_MINUTES,
        PADDLE_RECONCILIATION_SUCCESS_COOLDOWN_MINUTES,
        Math.min(Math.max(Number(batchSize) || PADDLE_RECONCILIATION_BATCH_SIZE, 1), 100),
      ],
    )
    summary.selected = candidates.rowCount
    console.info('[Paddle subscription reconciliation] automatic run started', {
      environments,
      batchSize,
      selected: summary.selected,
      maximumConcurrency: 1,
    })

    for (const user of candidates.rows) {
      const attemptAt = await markAttempt(lockClient, user)
      if (!attemptAt) {
        summary.skipped += 1
        continue
      }
      summary.attempted += 1

      try {
        const paddle = resolveConfig(user.paddle_environment)
        const paddlePayload = await loadSubscription({ user, paddle })
        const result = await reconcile({
          user,
          paddlePayload,
          paddle,
          allowProviderConfirmedRecovery: true,
          db,
          source: 'automatic_scheduler',
        })

        if (result.reason === 'updated' || result.reason === 'already_current') {
          await markSuccess(lockClient, user, attemptAt)
          summary[result.reason] += 1
          continue
        }

        if (result.reason === 'concurrent_state_change' || result.reason === 'stale_provider_snapshot') {
          summary.skipped += 1
          continue
        }

        summary.failed += 1
        console.warn('[Paddle subscription reconciliation] automatic candidate was not applied', candidateLogContext(user, {
          providerStatus: result.snapshot?.providerStatus || null,
          reason: result.reason,
        }))
      } catch (error) {
        summary.failed += 1
        console.error('[Paddle subscription reconciliation] automatic candidate failed', candidateLogContext(user, {
          errorCode: errorCode(error),
          providerStatus: error?.status || null,
        }))
      }
    }

    console.info('[Paddle subscription reconciliation] automatic run completed', summary)
    return summary
  } finally {
    if (lockAcquired) {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1)',
        [PADDLE_RECONCILIATION_ADVISORY_LOCK_ID],
      ).catch((error) => {
        console.error('[Paddle subscription reconciliation] failed to release automatic-run lock', {
          errorCode: errorCode(error),
        })
      })
    }
    lockClient.release()
  }
}

export async function startAutomaticPaddleSubscriptionReconciliation(env = process.env, dependencies = {}) {
  const environments = dependencies.environments || getConfiguredPaddleEnvironments(env)
  if (environments.length === 0) {
    console.info('[Paddle subscription reconciliation] automatic worker not required')
    return null
  }

  const db = dependencies.db || pool
  const schedule = dependencies.setInterval || setInterval
  const runWorker = dependencies.runWorker || runAutomaticPaddleSubscriptionReconciliation
  await db.query(
    `SELECT last_paddle_reconciliation_attempt_at, last_paddle_reconciled_at
     FROM users LIMIT 1`,
  )

  let running = false
  const run = async () => {
    if (running) return null
    running = true
    try {
      return await runWorker({ ...dependencies, db, env, environments })
    } catch (error) {
      console.error('[Paddle subscription reconciliation] automatic run failed', {
        errorCode: errorCode(error),
      })
      return null
    } finally {
      running = false
    }
  }

  const timer = schedule(() => void run(), PADDLE_RECONCILIATION_INTERVAL_MS)
  timer.unref?.()
  void run()
  console.info('[Paddle subscription reconciliation] automatic worker scheduled', {
    intervalMs: PADDLE_RECONCILIATION_INTERVAL_MS,
    batchSize: PADDLE_RECONCILIATION_BATCH_SIZE,
    maximumConcurrency: 1,
    environments,
  })
  return timer
}
