-- Gymvyn user custom foods and saved meals
-- Safe to review/apply manually. Creates new tables only and does not modify existing food_logs rows.

create table if not exists public.user_custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  brand text,
  category text not null default 'custom',
  calories_per_serving numeric not null,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  fiber_g numeric not null default 0,
  serving_size numeric not null,
  serving_unit text not null,
  serving_description text,
  grams_equivalent numeric,
  ml_equivalent numeric,
  barcode text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_custom_foods_positive_serving_size check (serving_size > 0),
  constraint user_custom_foods_nonnegative_macros check (
    calories_per_serving >= 0
    and protein_g >= 0
    and carbs_g >= 0
    and fat_g >= 0
    and fiber_g >= 0
  )
);

create unique index if not exists user_custom_foods_user_normalized_name_idx
  on public.user_custom_foods (user_id, normalized_name);

create index if not exists user_custom_foods_user_id_idx
  on public.user_custom_foods (user_id);

create index if not exists user_custom_foods_user_barcode_idx
  on public.user_custom_foods (user_id, barcode)
  where barcode is not null;

create table if not exists public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  meal_type text,
  total_calories numeric not null default 0,
  total_protein_g numeric not null default 0,
  total_carbs_g numeric not null default 0,
  total_fat_g numeric not null default 0,
  total_fiber_g numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_meals_user_id_idx
  on public.saved_meals (user_id);

create index if not exists saved_meals_user_name_idx
  on public.saved_meals (user_id, lower(name));

create table if not exists public.saved_meal_items (
  id uuid primary key default gen_random_uuid(),
  saved_meal_id uuid not null references public.saved_meals(id) on delete cascade,
  food_id uuid references public.food_database(id) on delete set null,
  custom_food_id uuid references public.user_custom_foods(id) on delete set null,
  food_name text not null,
  quantity numeric not null default 1,
  serving_unit text,
  serving_description text,
  calories numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  fiber_g numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint saved_meal_items_positive_quantity check (quantity > 0),
  constraint saved_meal_items_nonnegative_macros check (
    calories >= 0
    and protein_g >= 0
    and carbs_g >= 0
    and fat_g >= 0
    and fiber_g >= 0
  )
);

create index if not exists saved_meal_items_saved_meal_id_idx
  on public.saved_meal_items (saved_meal_id, sort_order);

alter table public.user_custom_foods enable row level security;
alter table public.saved_meals enable row level security;
alter table public.saved_meal_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_custom_foods' and policyname = 'Users can select own custom foods') then
    create policy "Users can select own custom foods"
      on public.user_custom_foods
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_custom_foods' and policyname = 'Users can insert own custom foods') then
    create policy "Users can insert own custom foods"
      on public.user_custom_foods
      for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_custom_foods' and policyname = 'Users can update own custom foods') then
    create policy "Users can update own custom foods"
      on public.user_custom_foods
      for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_custom_foods' and policyname = 'Users can delete own custom foods') then
    create policy "Users can delete own custom foods"
      on public.user_custom_foods
      for delete
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meals' and policyname = 'Users can select own saved meals') then
    create policy "Users can select own saved meals"
      on public.saved_meals
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meals' and policyname = 'Users can insert own saved meals') then
    create policy "Users can insert own saved meals"
      on public.saved_meals
      for insert
      to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meals' and policyname = 'Users can update own saved meals') then
    create policy "Users can update own saved meals"
      on public.saved_meals
      for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meals' and policyname = 'Users can delete own saved meals') then
    create policy "Users can delete own saved meals"
      on public.saved_meals
      for delete
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meal_items' and policyname = 'Users can select own saved meal items') then
    create policy "Users can select own saved meal items"
      on public.saved_meal_items
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.saved_meals sm
          where sm.id = saved_meal_items.saved_meal_id
            and sm.user_id = (select auth.uid())
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meal_items' and policyname = 'Users can insert own saved meal items') then
    create policy "Users can insert own saved meal items"
      on public.saved_meal_items
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.saved_meals sm
          where sm.id = saved_meal_items.saved_meal_id
            and sm.user_id = (select auth.uid())
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meal_items' and policyname = 'Users can update own saved meal items') then
    create policy "Users can update own saved meal items"
      on public.saved_meal_items
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.saved_meals sm
          where sm.id = saved_meal_items.saved_meal_id
            and sm.user_id = (select auth.uid())
        )
      )
      with check (
        exists (
          select 1
          from public.saved_meals sm
          where sm.id = saved_meal_items.saved_meal_id
            and sm.user_id = (select auth.uid())
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_meal_items' and policyname = 'Users can delete own saved meal items') then
    create policy "Users can delete own saved meal items"
      on public.saved_meal_items
      for delete
      to authenticated
      using (
        exists (
          select 1
          from public.saved_meals sm
          where sm.id = saved_meal_items.saved_meal_id
            and sm.user_id = (select auth.uid())
        )
      );
  end if;
end $$;
