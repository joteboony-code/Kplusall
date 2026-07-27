ALTER TABLE user_jobs ADD COLUMN line_sender_id TEXT;
ALTER TABLE user_jobs ADD COLUMN line_conversation_id TEXT;
ALTER TABLE user_jobs ADD COLUMN line_source_type TEXT;
ALTER TABLE user_jobs ADD COLUMN final_result TEXT;
ALTER TABLE user_jobs ADD COLUMN result_claimed_at TEXT;
ALTER TABLE user_jobs ADD COLUMN result_claim_token TEXT;
ALTER TABLE user_jobs ADD COLUMN result_sent_at TEXT;

UPDATE user_jobs
SET line_sender_id = line_user_id,
    line_conversation_id = line_user_id,
    line_source_type = 'user',
    final_result = CASE WHEN status = 'passed' THEN 'passed' ELSE NULL END,
    result_claimed_at = NULL,
    result_claim_token = NULL,
    result_sent_at = pass_sent_at
WHERE line_sender_id IS NULL
   OR line_conversation_id IS NULL
   OR line_source_type IS NULL;

ALTER TABLE slip_jobs ADD COLUMN line_reply_token TEXT;
ALTER TABLE slip_jobs ADD COLUMN line_quote_token TEXT;
ALTER TABLE slip_jobs ADD COLUMN webhook_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_user_jobs_scoped_active
  ON user_jobs(
    region,
    line_conversation_id,
    line_sender_id,
    expires_at DESC,
    reference_set_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_user_jobs_result_delivery
  ON user_jobs(result_sent_at, result_claimed_at);
