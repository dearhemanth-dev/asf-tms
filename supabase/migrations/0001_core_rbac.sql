create extension if not exists "pgcrypto";

do $$ begin
  create type app_role as enum ('management', 'accounts', 'dispatch', 'driver');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid references public.tenants (id) on delete set null,
  full_name text not null,
  role app_role not null default 'dispatch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  phone text,
  license_no text,
  status text not null default 'active',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.mechanics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  phone text,
  skill text,
  status text not null default 'active',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_no text not null,
  asset_type text not null,
  make text,
  model text,
  year int,
  status text not null default 'active',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, asset_no)
);

create table if not exists public.user_onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  requested_role app_role not null,
  requested_by uuid references public.profiles (id),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.current_profile()
returns public.profiles
language sql
stable
as $$
  select p.*
  from public.profiles p
  where p.id = auth.uid();
$$;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.mechanics enable row level security;
alter table public.assets enable row level security;
alter table public.user_onboarding_requests enable row level security;

drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "profiles self upsert" on public.profiles;
create policy "profiles self upsert"
on public.profiles
for all
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "tenant members can read core tables" on public.drivers;
create policy "tenant members can read core tables"
on public.drivers
for select
using (
  tenant_id = (select tenant_id from public.current_profile())
);

drop policy if exists "tenant managers can write drivers" on public.drivers;
create policy "tenant managers can write drivers"
on public.drivers
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts', 'dispatch')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts', 'dispatch')
);

drop policy if exists "tenant members can read mechanics" on public.mechanics;
create policy "tenant members can read mechanics"
on public.mechanics
for select
using (
  tenant_id = (select tenant_id from public.current_profile())
);

drop policy if exists "tenant managers can write mechanics" on public.mechanics;
create policy "tenant managers can write mechanics"
on public.mechanics
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);

drop policy if exists "tenant members can read assets" on public.assets;
create policy "tenant members can read assets"
on public.assets
for select
using (
  tenant_id = (select tenant_id from public.current_profile())
);

drop policy if exists "tenant ops can write assets" on public.assets;
create policy "tenant ops can write assets"
on public.assets
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'dispatch')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'dispatch')
);

drop policy if exists "tenant management can read onboarding" on public.user_onboarding_requests;
create policy "tenant management can read onboarding"
on public.user_onboarding_requests
for select
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);

drop policy if exists "tenant management can write onboarding" on public.user_onboarding_requests;
create policy "tenant management can write onboarding"
on public.user_onboarding_requests
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);
