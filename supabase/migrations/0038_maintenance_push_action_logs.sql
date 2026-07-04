create table if not exists public.maintenance_push_action_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  username text,
  user_role text,
  action text not null,
  status text not null default 'info',
  options jsonb not null default '{}'::jsonb,
  error_message text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_push_action_logs_tenant_time_idx
  on public.maintenance_push_action_logs (tenant_id, created_at desc);

create index if not exists maintenance_push_action_logs_username_time_idx
  on public.maintenance_push_action_logs (username, created_at desc);

alter table public.maintenance_push_action_logs enable row level security;

create policy "Tenant users can read own push action logs"
  on public.maintenance_push_action_logs for select
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);

create policy "Service role can insert push action logs"
  on public.maintenance_push_action_logs for insert
  with check (true);
