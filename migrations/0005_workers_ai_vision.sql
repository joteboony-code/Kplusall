ALTER TABLE slip_jobs ADD COLUMN ocrspace_found_kplus INTEGER;
ALTER TABLE slip_jobs ADD COLUMN ocrspace_found_settlement INTEGER;
ALTER TABLE slip_jobs ADD COLUMN ocrspace_detected_amounts TEXT;
ALTER TABLE slip_jobs ADD COLUMN ai_provider TEXT;
ALTER TABLE slip_jobs ADD COLUMN ai_response TEXT;
ALTER TABLE slip_jobs ADD COLUMN ai_found_kplus INTEGER;
ALTER TABLE slip_jobs ADD COLUMN ai_found_settlement INTEGER;
ALTER TABLE slip_jobs ADD COLUMN ai_detected_amounts TEXT;
ALTER TABLE slip_jobs ADD COLUMN ai_confident INTEGER;

UPDATE slip_jobs
SET ocrspace_found_kplus = found_kplus,
    ocrspace_found_settlement = found_settlement,
    ocrspace_detected_amounts = detected_amounts
WHERE ocr_provider = 'ocrspace';
