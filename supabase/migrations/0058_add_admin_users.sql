do $$
declare
  default_tenant_id uuid;
  hk_tenant_id uuid;
  gs_tenant_id uuid;
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

  select tenant_id into hk_tenant_id
  from public."Users"
  where "UserName" in ('hkmanager', 'hkmaintenance')
    and tenant_id is not null
  order by created_at asc
  limit 1;

  select tenant_id into gs_tenant_id
  from public."Users"
  where "UserName" in ('gsmanager', 'gsmaintenance')
    and tenant_id is not null
  order by created_at asc
  limit 1;

  hk_tenant_id := coalesce(hk_tenant_id, default_tenant_id);
  gs_tenant_id := coalesce(gs_tenant_id, default_tenant_id);

  if exists (
    select 1
    from pg_constraint
    where conname = 'users_usertype_check'
      and conrelid = 'public."Users"'::regclass
  ) then
    alter table public."Users" drop constraint users_usertype_check;
  end if;

  alter table public."Users"
    add constraint users_usertype_check
    check ("UserType" in ('admin', 'management', 'accounts', 'maintenance', 'dispatch'));

  insert into public."Users" ("UserName", "Password", "UserType", full_name, tenant_id)
  values
    ('hkadmin', 'p', 'admin', 'HK Admin', hk_tenant_id),
    ('gsadmin', 'p', 'admin', 'GS Admin', gs_tenant_id)
  on conflict ("UserName") do update
  set
    "Password" = excluded."Password",
    "UserType" = excluded."UserType",
    full_name = coalesce(public."Users".full_name, excluded.full_name),
    tenant_id = coalesce(public."Users".tenant_id, excluded.tenant_id);
end;
$$;