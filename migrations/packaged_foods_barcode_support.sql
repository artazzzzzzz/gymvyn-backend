-- Gymvyn packaged foods and barcode support
-- Safe to review/apply manually. Does not rewrite or delete existing food_logs rows.

create table if not exists public.packaged_foods (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  normalized_name text not null,
  brand text,
  category text default 'packaged',
  image_url text,
  serving_size numeric,
  serving_unit text,
  serving_description text,
  grams_equivalent numeric,
  ml_equivalent numeric,
  calories_per_serving numeric,
  protein_g numeric default 0,
  carbs_g numeric default 0,
  fat_g numeric default 0,
  fiber_g numeric default 0,
  sugar_g numeric,
  sodium_mg numeric,
  saturated_fat_g numeric,
  ingredients text,
  allergens text[],
  countries text[],
  source text not null default 'openfoodfacts',
  source_product_id text,
  source_url text,
  quality_status text default 'needs_review',
  confidence_score numeric default 0.5,
  rejection_reasons text[],
  last_verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint packaged_foods_nonnegative_macros check (
    coalesce(calories_per_serving, 0) >= 0
    and coalesce(protein_g, 0) >= 0
    and coalesce(carbs_g, 0) >= 0
    and coalesce(fat_g, 0) >= 0
    and coalesce(fiber_g, 0) >= 0
  ),
  constraint packaged_foods_quality_status check (
    quality_status in ('verified', 'needs_review', 'rejected')
  )
);

create unique index if not exists packaged_foods_barcode_idx
  on public.packaged_foods (barcode)
  where barcode is not null;

create index if not exists packaged_foods_normalized_name_idx
  on public.packaged_foods (normalized_name);

create index if not exists packaged_foods_brand_idx
  on public.packaged_foods (brand)
  where brand is not null;

create index if not exists packaged_foods_source_idx
  on public.packaged_foods (source);

create index if not exists packaged_foods_quality_status_idx
  on public.packaged_foods (quality_status);

create index if not exists packaged_foods_countries_idx
  on public.packaged_foods using gin (countries);

alter table public.food_logs
  add column if not exists packaged_food_id uuid references public.packaged_foods(id) on delete set null,
  add column if not exists custom_food_id uuid references public.user_custom_foods(id) on delete set null;

create index if not exists food_logs_packaged_food_id_idx
  on public.food_logs (packaged_food_id)
  where packaged_food_id is not null;

create index if not exists food_logs_custom_food_id_idx
  on public.food_logs (custom_food_id)
  where custom_food_id is not null;

create table if not exists public.user_packaged_food_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  packaged_food_id uuid not null references public.packaged_foods(id) on delete cascade,
  corrected_fields jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists user_packaged_food_corrections_user_id_idx
  on public.user_packaged_food_corrections (user_id);

create index if not exists user_packaged_food_corrections_packaged_food_id_idx
  on public.user_packaged_food_corrections (packaged_food_id);

alter table public.packaged_foods enable row level security;
alter table public.user_packaged_food_corrections enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'packaged_foods' and policyname = 'Authenticated users can read packaged foods') then
    create policy "Authenticated users can read packaged foods"
      on public.packaged_foods
      for select
      to authenticated
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_packaged_food_corrections' and policyname = 'Users can select own packaged food corrections') then
    create policy "Users can select own packaged food corrections"
      on public.user_packaged_food_corrections
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_packaged_food_corrections' and policyname = 'Users can insert own packaged food corrections') then
    create policy "Users can insert own packaged food corrections"
      on public.user_packaged_food_corrections
      for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_packaged_food_corrections' and policyname = 'Users can update own packaged food corrections') then
    create policy "Users can update own packaged food corrections"
      on public.user_packaged_food_corrections
      for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;
