-- Extend maintenance alerts for richer Samsara event capture
alter table public.maintenance_alerts
  add column if not exists canonical_event_type text,
  add column if not exists organization_external_id text,
  add column if not exists webhook_version text,
  add column if not exists fault_code text,
  add column if not exists fault_description text,
  add column if not exists speed_mph numeric,
  add column if not exists speed_limit_mph numeric,
  add column if not exists dvir_defect_count integer,
  add column if not exists predictive_alert_code text;

create index if not exists maintenance_alerts_tenant_eventtype_time_idx
  on public.maintenance_alerts (tenant_id, event_type, occurred_at desc);

create index if not exists maintenance_alerts_received_time_idx
  on public.maintenance_alerts (received_at desc);

create index if not exists maintenance_alerts_tenant_canonical_time_idx
  on public.maintenance_alerts (tenant_id, canonical_event_type, occurred_at desc);

-- Request-level ingest telemetry for webhook monitor
create table if not exists public.webhook_ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  provider text not null default 'samsara',
  endpoint text not null default '/api/webhooks/samsara',
  received_at timestamptz not null default now(),
  signature_valid boolean not null,
  http_status integer not null,
  received_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  event_types text[] not null default '{}',
  sample_event_ids text[] not null default '{}',
  notes text,
  error_message text,
  sample_event_types text[] not null default '{}',
  request_id text,
  user_agent text,
  raw_headers jsonb
);

create index if not exists webhook_ingestion_logs_received_idx
  on public.webhook_ingestion_logs (received_at desc);

create index if not exists webhook_ingestion_logs_tenant_received_idx
  on public.webhook_ingestion_logs (tenant_id, received_at desc);

create index if not exists webhook_ingestion_logs_sig_idx
  on public.webhook_ingestion_logs (signature_valid, received_at desc);

alter table public.webhook_ingestion_logs enable row level security;

create policy "Tenant users can read own webhook ingest logs"
  on public.webhook_ingestion_logs for select
  using (tenant_id = current_setting('app.tenant_id', true));

create policy "Service role can insert webhook ingest logs"
  on public.webhook_ingestion_logs for insert
  with check (true);