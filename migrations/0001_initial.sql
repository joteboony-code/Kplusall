CREATE TABLE IF NOT EXISTS region_config (
  region TEXT PRIMARY KEY CHECK(region IN ('north','central','isan','south','bangkok')),
  enabled INTEGER NOT NULL DEFAULT 0,
  line_channel_secret BLOB,
  line_channel_token BLOB,
  ocrspace_api_key BLOB,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_jobs (
  id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  job_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_image',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, line_user_id, job_number)
);

CREATE TABLE IF NOT EXISTS slip_jobs (
  id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  parent_job_id TEXT NOT NULL,
  line_message_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  ocr_text TEXT,
  ocr_provider TEXT,
  result TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(region, line_message_id),
  FOREIGN KEY(parent_job_id) REFERENCES user_jobs(id)
);

CREATE TABLE IF NOT EXISTS daily_usage (
  usage_date TEXT NOT NULL,
  region TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(usage_date, region, provider)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO region_config(region) VALUES
  ('north'), ('central'), ('isan'), ('south'), ('bangkok');

CREATE INDEX IF NOT EXISTS idx_user_jobs_lookup ON user_jobs(region, line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_slip_jobs_status ON slip_jobs(status, created_at DESC);
