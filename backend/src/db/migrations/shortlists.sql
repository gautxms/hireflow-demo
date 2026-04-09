CREATE TABLE IF NOT EXISTS shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shortlists_user_id
  ON shortlists (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shortlist_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortlist_id UUID NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  resume_id UUID NOT NULL REFERENCES resumes(id),
  notes TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (shortlist_id, resume_id)
);

CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_shortlist_id
  ON shortlist_candidates (shortlist_id, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_shortlist_candidates_rating
  ON shortlist_candidates (rating DESC NULLS LAST);
