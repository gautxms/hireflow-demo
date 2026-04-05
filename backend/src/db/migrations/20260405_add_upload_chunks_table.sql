CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  mime_type TEXT,
  total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
  uploaded_chunks INTEGER[] NOT NULL DEFAULT '{}',
  s3_prefix TEXT NOT NULL,
  assembled_s3_key TEXT,
  assembled_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'completed', 'rejected', 'failed', 'expired')),
  scan_status TEXT,
  scan_result JSONB,
  resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL,
  parse_job_id TEXT,
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_chunks_user_status
  ON upload_chunks (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upload_chunks_expires_at
  ON upload_chunks (expires_at);

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS scan_status TEXT,
  ADD COLUMN IF NOT EXISTS scan_result JSONB,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT;
