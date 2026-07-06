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

  insert into public."Users" ("UserName", "Password", "UserType", full_name, tenant_id)
  values ('hkmanager', 'p', 'management', 'HK Manager', default_tenant_id)
  on conflict ("UserName") do update
  set
    "UserType" = excluded."UserType",
    full_name   = coalesce(public."Users".full_name, excluded.full_name),
    tenant_id   = coalesce(public."Users".tenant_id, excluded.tenant_id);
end;
$$;
