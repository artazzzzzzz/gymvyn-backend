-- Bug 12 (QA re-verification): Edit Profile sheet had no Instagram or
-- Certifications fields, and the columns didn't exist yet either.
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS instagram TEXT;
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}';
