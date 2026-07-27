ALTER TABLE user_jobs ADD COLUMN expires_at TEXT;
ALTER TABLE user_jobs ADD COLUMN reference_set_at TEXT;
ALTER TABLE user_jobs ADD COLUMN pass_claimed_at TEXT;
ALTER TABLE user_jobs ADD COLUMN pass_claim_token TEXT;
ALTER TABLE user_jobs ADD COLUMN pass_sent_at TEXT;

UPDATE user_jobs
SET expires_at = datetime(updated_at, '+30 minutes'),
    reference_set_at = updated_at
WHERE expires_at IS NULL OR reference_set_at IS NULL;

ALTER TABLE slip_jobs ADD COLUMN image_set_id TEXT;
ALTER TABLE slip_jobs ADD COLUMN image_set_index INTEGER;
ALTER TABLE slip_jobs ADD COLUMN image_set_total INTEGER;

CREATE INDEX IF NOT EXISTS idx_user_jobs_active
  ON user_jobs(region, line_user_id, expires_at DESC, reference_set_at DESC);

CREATE INDEX IF NOT EXISTS idx_slip_jobs_parent_created
  ON slip_jobs(parent_job_id, created_at DESC);
