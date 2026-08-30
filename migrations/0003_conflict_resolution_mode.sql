-- Existing records must not start sending case text to a newly enabled provider.
ALTER TABLE conflicts ADD COLUMN resolution_mode TEXT NOT NULL DEFAULT 'record_only'
  CHECK (resolution_mode IN ('record_only', 'judge'));

-- Preserve access to already-issued assessments without opting pending cases in.
UPDATE conflicts SET resolution_mode = 'judge'
WHERE EXISTS (SELECT 1 FROM verdicts WHERE verdicts.conflict_id = conflicts.id);
