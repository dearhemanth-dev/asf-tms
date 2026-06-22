create table if not exists public."Users" (
  id uuid primary key default gen_random_uuid(),
  "UserName" text not null unique,
  "Password" text not null,
  "UserType" text not null,
  created_at timestamptz not null default now(),
  constraint users_usertype_check check ("UserType" in ('management', 'accounts', 'maintenance', 'dispatch'))
);

alter table public."Users" disable row level security;

insert into public."Users" ("UserName", "Password", "UserType")
values
  ('gsmanager', 'p', 'management'),
  ('gsaccounts', 'p', 'accounts'),
  ('gsmaitenance', 'p', 'maintenance'),
  ('gsdispatch', 'p', 'dispatch'),
  ('rbmanager', 'p', 'management'),
  ('rbaccounts', 'p', 'accounts'),
  ('rbmaintenance', 'p', 'maintenance'),
  ('rbdispatch', 'p', 'dispatch')
on conflict ("UserName") do update
  set "Password" = excluded."Password",
      "UserType" = excluded."UserType";

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

  if cp.id is not null then
    new.tenant_id := cp.tenant_id;
    new.created_by := cp.id;
  elsif new.tenant_id is null then
    select id into new.tenant_id
    from public.tenants
    order by created_at asc
    limit 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

alter table public.organizations disable row level security;
