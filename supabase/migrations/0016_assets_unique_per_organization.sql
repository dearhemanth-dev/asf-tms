-- Scope asset uniqueness by organization within a tenant.
-- This allows the same Asset# across different organizations in the same tenant.

alter table if exists public.assets
  drop constraint if exists unique_asset_no_per_tenant;

alter table if exists public.assets
  drop constraint if exists unique_asset_unit_number_per_tenant;

alter table if exists public.assets
  add constraint unique_asset_no_per_tenant_organization
  unique (tenant_id, organization_id, asset_no);

alter table if exists public.assets
  add constraint unique_asset_unit_number_per_tenant_organization
  unique (tenant_id, organization_id, asset_unit_number);