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
  set tenant_id = coalesce(tenant_id, default_tenant_id)
  where "UserName" = 'hkmaintenance';
end;
$$;
