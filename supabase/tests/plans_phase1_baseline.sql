-- TEST ONLY. Loaded exclusively into gymvyn_plans_phase1_test by the local
-- validation script. It contains no production schema or user data.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL
);
CREATE TABLE public.trainer_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE public.trainer_templates (
  id UUID PRIMARY KEY,
  trainer_id UUID NOT NULL REFERENCES public.users(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  template_data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.diet_plan_templates (
  id UUID PRIMARY KEY,
  trainer_id UUID NOT NULL REFERENCES public.users(id),
  name TEXT NOT NULL,
  detail_level TEXT,
  calories_target INTEGER,
  protein_g NUMERIC,
  carbs_g NUMERIC,
  fat_g NUMERIC
);
CREATE TABLE public.assigned_plans (id UUID PRIMARY KEY);
CREATE TABLE public.assigned_diet_plans (id UUID PRIMARY KEY);
