-- Add organization_id to assets and backfill from organization_name per tenant.

alter table if exists public.assets
  add column if not exists organization_id uuid;

update public.assets as a
set organization_id = (
  select o.id
  from public.organizations as o
  where o.tenant_id = a.tenant_id
    and o.organization_name = a.organization_name
  order by o.created_at asc nulls last, o.id asc
  limit 1
)
where a.organization_id is null
  and a.organization_name is not null
  and btrim(a.organization_name) <> '';

create index if not exists idx_assets_organization_id
  on public.assets (organization_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_organization_id_fkey'
  ) then
    alter table public.assets
      add constraint assets_organization_id_fkey
      foreign key (organization_id)
      references public.organizations (id)
      on delete set null;
  end if;
end;
$$;