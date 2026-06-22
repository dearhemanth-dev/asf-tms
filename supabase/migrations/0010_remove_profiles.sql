alter table public."Users"
  add column if not exists full_name text,
  add column if not exists tenant_id uuid references public.tenants (id) on delete set null;

do $$
declare
  default_tenant_id uuid;
begin
  select id into default_tenant_id
  from public.tenants
  order by created_at asc
  limit 1;

  if default_tenant_id is null then
    insert into public.tenants (name, code)
    values ('ASF Logistics', 'ASF-MVP')
    on conflict (code) do update
      set name = excluded.name
    returning id into default_tenant_id;
  end if;

  update public."Users"
  set tenant_id = coalesce(tenant_id, default_tenant_id),
      full_name = coalesce(
        full_name,
        case "UserName"
          when 'gsmanager' then 'GS Manager'
          when 'gsaccounts' then 'GS Accounts'
          when 'gsmaitenance' then 'GS Maintenance'
          when 'gsdispatch' then 'GS Dispatch'
          when 'rbmanager' then 'RB Manager'
          when 'rbaccounts' then 'RB Accounts'
          when 'rbmaintenance' then 'RB Maintenance'
          when 'rbdispatch' then 'RB Dispatch'
          when 'skmaintenance' then 'SK Maintenance'
          when 'skaccounts' then 'SK Accounts'
          else initcap(replace("UserName", '_', ' '))
        end
      );
end;
$$;

do $$
declare
  fk_record record;
begin
  for fk_record in
    select tc.table_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'profiles'
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      fk_record.table_name,
      fk_record.constraint_name
    );
  end loop;
end;
$$;

create or replace function public.set_organizations_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    select id into new.tenant_id
    from public.tenants
    order by created_at asc
    limit 1;
  end if;

  new.created_by := null;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_drivers_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    select id into new.tenant_id
    from public.tenants
    order by created_at asc
    limit 1;
  end if;

  new.created_by := null;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_asset_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    select id into new.tenant_id
    from public.tenants
    order by created_at asc
    limit 1;
  end if;

  new.created_by := null;
  return new;
end;
$$;

alter table public.tenants disable row level security;
alter table public.drivers disable row level security;
alter table public.mechanics disable row level security;
alter table public.assets disable row level security;
alter table public.user_onboarding_requests disable row level security;
alter table public.organizations disable row level security;

drop function if exists public.current_profile() cascade;
drop table if exists public.profiles cascade;