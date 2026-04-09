CREATE TABLE IF NOT EXISTS job_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  requirements TEXT,
  skills JSONB,
  experience_years INTEGER,
  location TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  file_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_descriptions_user_id ON job_descriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_status ON job_descriptions(status);

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resumes_job_description_id ON resumes(job_description_id);
