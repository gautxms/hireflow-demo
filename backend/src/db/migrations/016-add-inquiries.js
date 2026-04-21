export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inquiry_type TEXT NOT NULL CHECK (inquiry_type IN ('contact', 'demo')),
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      reviewed_at TIMESTAMP,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inquiries_type_status_created_at ON inquiries (inquiry_type, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries (email);

    CREATE OR REPLACE FUNCTION set_inquiries_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_inquiries_updated_at ON inquiries;
    CREATE TRIGGER trg_inquiries_updated_at
      BEFORE UPDATE ON inquiries
      FOR EACH ROW
      EXECUTE FUNCTION set_inquiries_updated_at();
  `)
}
