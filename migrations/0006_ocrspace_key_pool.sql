ALTER TABLE slip_jobs ADD COLUMN ocrspace_key_region TEXT
  CHECK(ocrspace_key_region IS NULL OR ocrspace_key_region IN (
    'north',
    'central',
    'isan',
    'south',
    'bangkok'
  ));

CREATE INDEX IF NOT EXISTS idx_slip_jobs_ocrspace_key_region
  ON slip_jobs(ocrspace_key_region, created_at DESC);
