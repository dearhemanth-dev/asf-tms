create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organization_name text not null,
  mc_number text,
  usdot_number text,
  street_address text,
  city text,
  state_province text,
  postal_code text,
  country text,
  manager_name text,
  phone text,
  email text,
  website text,
  ein text,
  scac text,
  notes text,
  status text not null default 'active',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organizations_tenant_id_idx on public.organizations (tenant_id);
create index if not exists organizations_name_idx on public.organizations (organization_name);

create unique index if not exists organizations_tenant_mc_unique
  on public.organizations (tenant_id, mc_number)
  where mc_number is not null;

create unique index if not exists organizations_tenant_usdot_unique
  on public.organizations (tenant_id, usdot_number)
  where usdot_number is not null;

create or replace function public.set_organizations_defaults()
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

drop trigger if exists organizations_set_defaults on public.organizations;
create trigger organizations_set_defaults
before insert on public.organizations
for each row
execute function public.set_organizations_defaults();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

alter table public.organizations enable row level security;

drop policy if exists "tenant members can read organizations" on public.organizations;
create policy "tenant members can read organizations"
on public.organizations
for select
using (tenant_id = (select tenant_id from public.current_profile()));

drop policy if exists "tenant admins can write organizations" on public.organizations;
create policy "tenant admins can write organizations"
on public.organizations
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);
