drop table if exists public.posts cascade;
drop table if exists public.users cascade;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text default 'user',
  created_at timestamptz default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  content text,
  created_at timestamptz default now()
);

alter table public.users enable row level security;
alter table public.posts enable row level security;

create policy "Users can read own data"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can insert own data"
  on public.users for insert
  with check (auth.uid() = id);

create policy "Users can read own posts"
  on public.posts for select
  using (auth.uid() = user_id);

create policy "Users can insert own posts"
  on public.posts for insert
  with check (auth.uid() = user_id);
