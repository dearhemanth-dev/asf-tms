alter table public.assets
  add column if not exists organization_name text;

create index if not exists idx_assets_organization_name
  on public.assets (organization_name);
