-- Rebuild drivers table to replace full_name with first_name and add last_name
-- placed physically next to first_name.

create table public.drivers_rebuild (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  first_name text not null,
  last_name text,
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
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.drivers_rebuild (
  id,
  tenant_id,
  first_name,
  last_name,
  street_address,
  city,
  state_province,
  postal_code,
  country,
  phone,
  email,
  assigned_truck_unit_number,
  license_number,
  cdl_class,
  status,
  notes,
  created_by,
  created_at,
  updated_at
)
select
  (to_jsonb(d)->>'id')::uuid as id,
  (to_jsonb(d)->>'tenant_id')::uuid as tenant_id,
  coalesce(
    nullif(trim(to_jsonb(d)->>'first_name'), ''),
    nullif(split_part(coalesce(nullif(trim(to_jsonb(d)->>'full_name'), ''), 'UNKNOWN'), ' ', 1), ''),
    'UNKNOWN'
  ) as first_name,
  coalesce(
    nullif(trim(to_jsonb(d)->>'last_name'), ''),
    nullif(trim(regexp_replace(coalesce(nullif(trim(to_jsonb(d)->>'full_name'), ''), ''), '^\\S+\\s*', '')), '')
  ) as last_name,
  nullif(trim(to_jsonb(d)->>'street_address'), '') as street_address,
  nullif(trim(to_jsonb(d)->>'city'), '') as city,
  nullif(trim(to_jsonb(d)->>'state_province'), '') as state_province,
  nullif(trim(to_jsonb(d)->>'postal_code'), '') as postal_code,
  nullif(trim(to_jsonb(d)->>'country'), '') as country,
  nullif(trim(to_jsonb(d)->>'phone'), '') as phone,
  nullif(trim(to_jsonb(d)->>'email'), '') as email,
  nullif(trim(to_jsonb(d)->>'assigned_truck_unit_number'), '') as assigned_truck_unit_number,
  coalesce(
    nullif(trim(to_jsonb(d)->>'license_number'), ''),
    nullif(trim(to_jsonb(d)->>'license_no'), '')
  ) as license_number,
  coalesce(nullif(trim(to_jsonb(d)->>'cdl_class'), ''), 'A') as cdl_class,
  coalesce(nullif(trim(to_jsonb(d)->>'status'), ''), 'active') as status,
  nullif(trim(to_jsonb(d)->>'notes'), '') as notes,
  nullif(trim(to_jsonb(d)->>'created_by'), '')::uuid as created_by,
  coalesce(
    nullif(to_jsonb(d)->>'created_at', '')::timestamptz,
    now()
  ) as created_at,
  coalesce(
    nullif(to_jsonb(d)->>'updated_at', '')::timestamptz,
    nullif(to_jsonb(d)->>'created_at', '')::timestamptz,
    now()
  ) as updated_at
from public.drivers d;

alter table public.drivers rename to drivers_legacy_pre_0017;
alter table public.drivers_rebuild rename to drivers;

drop table public.drivers_legacy_pre_0017;

create index if not exists drivers_tenant_id_idx on public.drivers (tenant_id);
create index if not exists drivers_name_idx on public.drivers (first_name, last_name);

-- Reattach default/update triggers to rebuilt table.
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

-- Keep behavior aligned with current environment.
alter table public.drivers disable row level security;
