CREATE TABLE IF NOT EXISTS image_set_bindings (
  region TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  image_set_id TEXT NOT NULL,
  parent_job_id TEXT NOT NULL,
  job_number TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (region, conversation_id, sender_user_id, image_set_id)
);

CREATE INDEX IF NOT EXISTS idx_image_set_bindings_expiry
  ON image_set_bindings(expires_at);

ALTER TABLE slip_jobs ADD COLUMN queue_claimed_at TEXT;
ALTER TABLE slip_jobs ADD COLUMN evidence_json TEXT;
