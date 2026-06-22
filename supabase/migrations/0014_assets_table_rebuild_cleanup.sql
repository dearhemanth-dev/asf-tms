-- Rebuild assets table to clean legacy drift and set physical column order.
-- organization_name is placed immediately after asset_no.

create table public.assets_rebuild (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  asset_no text not null,
  organization_name text,
  asset_unit_number text not null,
  asset_type text not null default 'truck',
  vin text,
  year text,
  make text,
  model text,
  license_plate text,
  ownership_type text not null default 'company',
  allowed_outside_home_state text not null default 'yes',
  status text not null default 'active',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_allowed_outside_home_state_check
    check (allowed_outside_home_state in ('yes', 'no')),
  constraint unique_asset_no_per_tenant unique (tenant_id, asset_no),
  constraint unique_asset_unit_number_per_tenant unique (tenant_id, asset_unit_number)
);

insert into public.assets_rebuild (
  id,
  tenant_id,
  asset_no,
  organization_name,
  asset_unit_number,
  asset_type,
  vin,
  year,
  make,
  model,
  license_plate,
  ownership_type,
  allowed_outside_home_state,
  status,
  notes,
  created_by,
  created_at,
  updated_at
)
select
  (to_jsonb(a)->>'id')::uuid as id,
  (to_jsonb(a)->>'tenant_id')::uuid as tenant_id,
  coalesce(
    nullif(trim(to_jsonb(a)->>'asset_no'), ''),
    nullif(trim(to_jsonb(a)->>'asset_unit_number'), ''),
    'UNKNOWN'
  ) as asset_no,
  nullif(trim(to_jsonb(a)->>'organization_name'), '') as organization_name,
  coalesce(
    nullif(trim(to_jsonb(a)->>'asset_unit_number'), ''),
    nullif(trim(to_jsonb(a)->>'asset_no'), ''),
    'UNKNOWN'
  ) as asset_unit_number,
  coalesce(nullif(trim(to_jsonb(a)->>'asset_type'), ''), 'truck') as asset_type,
  nullif(trim(to_jsonb(a)->>'vin'), '') as vin,
  case
    when nullif(trim(to_jsonb(a)->>'year'), '') is null then null
    else to_jsonb(a)->>'year'
  end as year,
  nullif(trim(to_jsonb(a)->>'make'), '') as make,
  nullif(trim(to_jsonb(a)->>'model'), '') as model,
  nullif(trim(to_jsonb(a)->>'license_plate'), '') as license_plate,
  coalesce(nullif(trim(to_jsonb(a)->>'ownership_type'), ''), 'company') as ownership_type,
  coalesce(nullif(trim(to_jsonb(a)->>'allowed_outside_home_state'), ''), 'yes') as allowed_outside_home_state,
  coalesce(nullif(trim(to_jsonb(a)->>'status'), ''), 'active') as status,
  nullif(trim(to_jsonb(a)->>'notes'), '') as notes,
  nullif(trim(to_jsonb(a)->>'created_by'), '')::uuid as created_by,
  coalesce(nullif(to_jsonb(a)->>'created_at', '')::timestamptz, now()) as created_at,
  coalesce(
    nullif(to_jsonb(a)->>'updated_at', '')::timestamptz,
    nullif(to_jsonb(a)->>'created_at', '')::timestamptz,
    now()
  ) as updated_at
from public.assets a;

alter table public.assets rename to assets_legacy_pre_0014;
alter table public.assets_rebuild rename to assets;

drop table public.assets_legacy_pre_0014;

create index if not exists idx_assets_tenant_id on public.assets (tenant_id);
create index if not exists idx_assets_asset_no on public.assets (asset_no);
create index if not exists idx_assets_asset_unit_number on public.assets (asset_unit_number);
create index if not exists idx_assets_organization_name on public.assets (organization_name);

create or replace function public.set_asset_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at
before update on public.assets
for each row
execute function public.set_asset_updated_at();

-- Keep both asset_no and asset_unit_number in sync for legacy/new app paths.
create or replace function public.sync_asset_number_aliases()
returns trigger
language plpgsql
as $$
begin
  if new.asset_no is null or btrim(new.asset_no) = '' then
    new.asset_no := new.asset_unit_number;
  end if;

  if new.asset_unit_number is null or btrim(new.asset_unit_number) = '' then
    new.asset_unit_number := new.asset_no;
  end if;

  if new.asset_no is null or btrim(new.asset_no) = '' then
    raise exception 'asset_no / asset_unit_number cannot both be empty';
  end if;

  if new.asset_unit_number is null or btrim(new.asset_unit_number) = '' then
    raise exception 'asset_no / asset_unit_number cannot both be empty';
  end if;

  return new;
end;
$$;

drop trigger if exists assets_sync_number_aliases on public.assets;
create trigger assets_sync_number_aliases
before insert or update on public.assets
for each row
execute function public.sync_asset_number_aliases();

alter table public.assets disable row level security;
