ALTER TABLE slip_jobs ADD COLUMN found_kplus INTEGER;
ALTER TABLE slip_jobs ADD COLUMN found_settlement INTEGER;
ALTER TABLE slip_jobs ADD COLUMN matched_amount TEXT;
ALTER TABLE slip_jobs ADD COLUMN detected_amounts TEXT;
ALTER TABLE slip_jobs ADD COLUMN decision_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_slip_jobs_region_created
  ON slip_jobs(region, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at);
