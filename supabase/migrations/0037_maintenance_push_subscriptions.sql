create table if not exists maintenance_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  username text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists maintenance_push_subscriptions_tenant_idx
  on maintenance_push_subscriptions (tenant_id);

create index if not exists maintenance_push_subscriptions_username_idx
  on maintenance_push_subscriptions (username);

create or replace function maintenance_push_subscriptions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists maintenance_push_subscriptions_set_updated_at
  on maintenance_push_subscriptions;

create trigger maintenance_push_subscriptions_set_updated_at
before update on maintenance_push_subscriptions
for each row
execute function maintenance_push_subscriptions_set_updated_at();
