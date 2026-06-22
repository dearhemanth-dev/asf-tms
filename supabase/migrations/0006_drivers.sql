create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  street_address text,
  city text,
  state_province text,
  postal_code text,
  country text,
  phone text,
  email text,
  assigned_truck_unit_number text,
  license_number text,
  cdl_class text not null default 'A',
  status text not null default 'active',
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drivers_tenant_id_idx on public.drivers (tenant_id);
create index if not exists drivers_name_idx on public.drivers (full_name);

create or replace function public.set_drivers_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cp public.profiles;
begin
  cp := public.current_profile();

  if cp.id is null then
    raise exception 'No current profile found';
  end if;

  new.tenant_id := cp.tenant_id;
  new.created_by := cp.id;
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists drivers_set_defaults on public.drivers;
create trigger drivers_set_defaults
before insert on public.drivers
for each row
execute function public.set_drivers_defaults();

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at
before update on public.drivers
for each row
execute function public.set_updated_at();

alter table public.drivers enable row level security;

drop policy if exists "tenant members can read drivers" on public.drivers;
create policy "tenant members can read drivers"
on public.drivers
for select
using (tenant_id = (select tenant_id from public.current_profile()));

drop policy if exists "tenant admins can write drivers" on public.drivers;
create policy "tenant admins can write drivers"
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
