ALTER TABLE slip_jobs ADD COLUMN reply_token_received_at_ms INTEGER;
ALTER TABLE slip_jobs ADD COLUMN reply_token_used_at TEXT;
ALTER TABLE slip_jobs ADD COLUMN reply_token_age_ms INTEGER;
ALTER TABLE slip_jobs ADD COLUMN reply_token_source_slip_id TEXT;

CREATE INDEX IF NOT EXISTS idx_slip_jobs_latest_reply_token
  ON slip_jobs(parent_job_id, reply_token_received_at_ms DESC, created_at DESC);
