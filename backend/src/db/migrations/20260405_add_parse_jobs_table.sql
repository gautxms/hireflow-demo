CREATE TABLE IF NOT EXISTS parse_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT UNIQUE NOT NULL,
  resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS idx_parse_jobs_status ON parse_jobs(status);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_resume_id ON parse_jobs(resume_id);
CREATE INDEX IF NOT EXISTS idx_parse_jobs_user_id ON parse_jobs(user_id);
