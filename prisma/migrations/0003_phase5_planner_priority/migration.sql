ALTER TABLE study_tasks
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE study_tasks
  DROP CONSTRAINT IF EXISTS study_tasks_priority_check;

ALTER TABLE study_tasks
  ADD CONSTRAINT study_tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high'));
