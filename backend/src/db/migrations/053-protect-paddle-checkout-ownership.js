function normalizeUsersIdType(typeName) {
  const normalized = String(typeName || '').trim().toLowerCase()

  if (normalized === 'uuid') return 'uuid'
  if (normalized === 'integer' || normalized === 'int4') return 'integer'
  if (normalized === 'bigint' || normalized === 'int8') return 'bigint'

  throw new Error(`[Migration 053] Unsupported users.id type: ${typeName}`)
}

async function getUsersIdType(client) {
  const result = await client.query(`
    SELECT format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = 'users'
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
  `)

  if (result.rows.length === 0) {
    throw new Error('[Migration 053] users.id column not found')
  }

  return normalizeUsersIdType(result.rows[0].data_type)
}

function sanitizeProviderId(value) {
  const text = String(value || '')
  if (text.length <= 10) return text
  return `${text.slice(0, 4)}...${text.slice(-6)}`
}

export async function auditPaddleOwnership(client) {
  const summaryResult = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL)::integer AS customer_rows,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL)::integer AS subscription_rows,
      COUNT(*) FILTER (WHERE paddle_customer_id IS NULL)::integer AS null_customer_ids,
      COUNT(*) FILTER (WHERE paddle_subscription_id IS NULL)::integer AS null_subscription_ids,
      COUNT(*) FILTER (WHERE paddle_customer_id IS NOT NULL AND BTRIM(paddle_customer_id) = '')::integer AS empty_customer_ids,
      COUNT(*) FILTER (WHERE paddle_subscription_id IS NOT NULL AND BTRIM(paddle_subscription_id) = '')::integer AS empty_subscription_ids,
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL
          AND BTRIM(paddle_customer_id) !~ '^ctm_[a-z0-9]+$'
      )::integer AS malformed_customer_ids,
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL
          AND BTRIM(paddle_subscription_id) !~ '^sub_[a-z0-9]+$'
      )::integer AS malformed_subscription_ids,
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production')) NOT IN ('production', 'sandbox')
      )::integer AS invalid_environments
    FROM users
  `)

  const duplicateCustomers = await client.query(`
    SELECT
      COALESCE(NULLIF(LOWER(BTRIM(paddle_environment)), ''), 'production') AS environment,
      BTRIM(paddle_customer_id) AS provider_id,
      ARRAY_AGG(id ORDER BY id) AS user_ids
    FROM users
    WHERE NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY 1, 2
  `)

  const duplicateSubscriptions = await client.query(`
    SELECT
      COALESCE(NULLIF(LOWER(BTRIM(paddle_environment)), ''), 'production') AS environment,
      BTRIM(paddle_subscription_id) AS provider_id,
      ARRAY_AGG(id ORDER BY id) AS user_ids
    FROM users
    WHERE NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY 1, 2
  `)

  const projectionConflicts = await client.query(`
    SELECT
      subscription.paddle_subscription_id AS provider_id,
      subscription.user_id AS projection_user_id,
      user_account.id AS users_owner_id,
      COALESCE(NULLIF(LOWER(BTRIM(subscription.paddle_environment)), ''), 'production') AS projection_environment,
      COALESCE(NULLIF(LOWER(BTRIM(user_account.paddle_environment)), ''), 'production') AS users_environment
    FROM subscriptions subscription
    JOIN users user_account
      ON user_account.paddle_subscription_id = subscription.paddle_subscription_id
     AND COALESCE(NULLIF(LOWER(BTRIM(user_account.paddle_environment)), ''), 'production')
         = COALESCE(NULLIF(LOWER(BTRIM(subscription.paddle_environment)), ''), 'production')
    WHERE subscription.user_id IS NOT NULL
      AND (
        subscription.user_id IS DISTINCT FROM user_account.id
        OR COALESCE(NULLIF(LOWER(BTRIM(subscription.paddle_environment)), ''), 'production')
           IS DISTINCT FROM COALESCE(NULLIF(LOWER(BTRIM(user_account.paddle_environment)), ''), 'production')
      )
    ORDER BY subscription.paddle_subscription_id
  `)

  const invalidEnvironmentRows = await client.query(`
    SELECT id, paddle_environment
    FROM users
    WHERE LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production')) NOT IN ('production', 'sandbox')
    ORDER BY id
  `)

  const invalidProjectionEnvironmentRows = await client.query(`
    SELECT id, user_id, paddle_environment
    FROM subscriptions
    WHERE LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production')) NOT IN ('production', 'sandbox')
    ORDER BY id
  `)

  const summary = summaryResult.rows[0] || {}
  const conflicts = [
    ...duplicateCustomers.rows.map((row) => ({
      type: 'duplicate_customer',
      environment: row.environment,
      providerId: sanitizeProviderId(row.provider_id),
      userIds: row.user_ids,
    })),
    ...duplicateSubscriptions.rows.map((row) => ({
      type: 'duplicate_subscription',
      environment: row.environment,
      providerId: sanitizeProviderId(row.provider_id),
      userIds: row.user_ids,
    })),
    ...projectionConflicts.rows.map((row) => ({
      type: 'projection_owner_mismatch',
      providerId: sanitizeProviderId(row.provider_id),
      projectionUserId: row.projection_user_id,
      usersOwnerId: row.users_owner_id,
      projectionEnvironment: row.projection_environment,
      usersEnvironment: row.users_environment,
    })),
    ...invalidEnvironmentRows.rows.map((row) => ({
      type: 'invalid_environment',
      userId: row.id,
      environment: String(row.paddle_environment || '').trim().toLowerCase() || null,
    })),
    ...invalidProjectionEnvironmentRows.rows.map((row) => ({
      type: 'invalid_projection_environment',
      projectionId: row.id,
      userId: row.user_id,
      environment: String(row.paddle_environment || '').trim().toLowerCase() || null,
    })),
  ]

  return {
    ...summary,
    duplicate_customer_ids: duplicateCustomers.rowCount,
    duplicate_subscription_ids: duplicateSubscriptions.rowCount,
    conflicting_projection_owners: projectionConflicts.rowCount,
    conflicts,
  }
}

export async function up(client) {
  const usersIdType = await getUsersIdType(client)
  const audit = await auditPaddleOwnership(client)

  console.info('[Migration 053] Paddle ownership audit', {
    customerRows: audit.customer_rows,
    subscriptionRows: audit.subscription_rows,
    duplicateCustomerIds: audit.duplicate_customer_ids,
    duplicateSubscriptionIds: audit.duplicate_subscription_ids,
    conflictingProjectionOwners: audit.conflicting_projection_owners,
    nullCustomerIds: audit.null_customer_ids,
    nullSubscriptionIds: audit.null_subscription_ids,
    emptyCustomerIds: audit.empty_customer_ids,
    emptySubscriptionIds: audit.empty_subscription_ids,
    malformedCustomerIds: audit.malformed_customer_ids,
    malformedSubscriptionIds: audit.malformed_subscription_ids,
    invalidEnvironments: audit.invalid_environments,
  })

  if (audit.conflicts.length > 0) {
    throw new Error(`[Migration 053] Paddle ownership conflicts require controlled remediation: ${JSON.stringify(audit.conflicts)}`)
  }

  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')

  await client.query(`
    UPDATE users
    SET paddle_environment = LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production'))
    WHERE paddle_environment IS DISTINCT FROM LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production'))
  `)

  await client.query(`
    UPDATE subscriptions
    SET paddle_environment = LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production'))
    WHERE paddle_environment IS DISTINCT FROM LOWER(COALESCE(NULLIF(BTRIM(paddle_environment), ''), 'production'))
  `)

  await client.query(`
    ALTER TABLE subscriptions
      ALTER COLUMN paddle_environment SET DEFAULT 'production',
      ALTER COLUMN paddle_environment SET NOT NULL
  `)

  await client.query(`
    ALTER TABLE subscriptions
      DROP CONSTRAINT IF EXISTS subscriptions_paddle_subscription_id_key
  `)

  await client.query('DROP INDEX IF EXISTS idx_subscriptions_paddle_subscription_id_unique')

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_paddle_environment_subscription_unique
      ON subscriptions (paddle_environment, paddle_subscription_id)
  `)

  await client.query(`
    CREATE TABLE IF NOT EXISTS paddle_checkout_reservations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      user_id ${usersIdType} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paddle_environment TEXT NOT NULL CHECK (paddle_environment IN ('production', 'sandbox')),
      requested_plan TEXT NOT NULL,
      stored_plan TEXT NOT NULL,
      price_id TEXT NOT NULL,
      trial_eligible BOOLEAN NOT NULL,
      checkout_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'ready', 'completed', 'failed', 'conflict')),
      paddle_transaction_id TEXT,
      paddle_customer_id TEXT,
      checkout_url TEXT,
      provider_status TEXT,
      failure_code TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paddle_checkout_one_open_per_user_environment
      ON paddle_checkout_reservations (user_id, paddle_environment)
      WHERE status IN ('creating', 'ready')
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_paddle_checkout_transaction_environment_unique
      ON paddle_checkout_reservations (paddle_environment, paddle_transaction_id)
      WHERE NULLIF(BTRIM(paddle_transaction_id), '') IS NOT NULL
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_paddle_checkout_user_created
      ON paddle_checkout_reservations (user_id, created_at DESC)
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_paddle_customer_environment_unique
      ON users (
        COALESCE(NULLIF(LOWER(BTRIM(paddle_environment)), ''), 'production'),
        BTRIM(paddle_customer_id)
      )
      WHERE NULLIF(BTRIM(paddle_customer_id), '') IS NOT NULL
  `)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_paddle_subscription_environment_unique
      ON users (
        COALESCE(NULLIF(LOWER(BTRIM(paddle_environment)), ''), 'production'),
        BTRIM(paddle_subscription_id)
      )
      WHERE NULLIF(BTRIM(paddle_subscription_id), '') IS NOT NULL
  `)
}
