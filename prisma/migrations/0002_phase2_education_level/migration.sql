ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS education_level TEXT NOT NULL DEFAULT 'beginner';

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_education_level_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_education_level_check
  CHECK (education_level IN ('beginner', 'intermediate', 'advanced'));
