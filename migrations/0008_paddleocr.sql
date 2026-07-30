ALTER TABLE slip_jobs ADD COLUMN paddle_job_id TEXT;
ALTER TABLE slip_jobs ADD COLUMN paddle_poll_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_slip_jobs_paddle_pending
  ON slip_jobs(status, updated_at)
  WHERE status = 'paddle_pending';
