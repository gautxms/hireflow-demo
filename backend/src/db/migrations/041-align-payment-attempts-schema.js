export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id SERIAL PRIMARY KEY
    )
  `)

  await pool.query(`
    ALTER TABLE payment_attempts
      ADD COLUMN IF NOT EXISTS transaction_id TEXT,
      ADD COLUMN IF NOT EXISTS user_id INTEGER,
      ADD COLUMN IF NOT EXISTS customer_email TEXT,
      ADD COLUMN IF NOT EXISTS amount NUMERIC,
      ADD COLUMN IF NOT EXISTS currency TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'failed',
      ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_error TEXT,
      ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'payment_attempts'
          AND column_name = 'paddle_transaction_id'
      ) THEN
        UPDATE payment_attempts
        SET transaction_id = paddle_transaction_id
        WHERE transaction_id IS NULL
          AND paddle_transaction_id IS NOT NULL;
      END IF;
    END $$
  `)

  await pool.query(`
    UPDATE payment_attempts
    SET status = COALESCE(status, 'failed'),
        retry_count = COALESCE(retry_count, 0),
        payload = COALESCE(payload, '{}'::jsonb),
        metadata = COALESCE(metadata, '{}'::jsonb),
        created_at = COALESCE(created_at, NOW()),
        updated_at = COALESCE(updated_at, NOW())
  `)

  await pool.query(`
    UPDATE payment_attempts target
    SET transaction_id = NULL,
        updated_at = NOW(),
        metadata = COALESCE(target.metadata, '{}'::jsonb) || jsonb_build_object(
          'alignment_duplicate_transaction_id', target.transaction_id
        )
    WHERE target.transaction_id IS NOT NULL
      AND target.ctid <> (
        SELECT MIN(keeper.ctid)
        FROM payment_attempts keeper
        WHERE keeper.transaction_id = target.transaction_id
      )
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'idx_payment_attempts_transaction_id_unique'
      ) THEN
        CREATE UNIQUE INDEX idx_payment_attempts_transaction_id_unique
          ON payment_attempts (transaction_id)
          WHERE transaction_id IS NOT NULL;
      END IF;
    END $$
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_status_next_retry_at
      ON payment_attempts (status, next_retry_at)
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id
      ON payment_attempts (user_id)
  `)
}
