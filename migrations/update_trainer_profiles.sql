ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE trainer_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
