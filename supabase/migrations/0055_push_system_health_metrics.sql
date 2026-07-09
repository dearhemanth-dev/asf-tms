-- Push System Health Metrics Table
-- 5-minute bucketed metrics for system health visibility
-- Enables: Real-time dashboards showing delivery success rate, latency, webhook health

create table push_system_health_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric_period timestamp with time zone not null, -- 5-min bucket window (e.g., 2026-07-07 12:00:00)
  
  -- Volume metrics
  alerts_received int not null default 0,
  alerts_queued int not null default 0,
  alerts_sent int not null default 0,
  alerts_delivered int not null default 0,
  alerts_failed int not null default 0,
  
  -- Success rate
  delivery_success_rate numeric not null default 0, -- percentage: 0-100
  
  -- Latency metrics (milliseconds)
  latency_p50_ms int, -- median
  latency_p95_ms int, -- 95th percentile
  latency_p99_ms int, -- 99th percentile
  
  -- Webhook health
  webhook_last_event_at timestamp with time zone,
  webhook_is_stale boolean not null default false, -- true if no events >5min
  
  -- Backfill health
  backfill_last_run_at timestamp with time zone,
  backfill_status text, -- 'success', 'partial_failure', 'failure'
  
  -- Enrollment health
  device_enrollment_count int not null default 0,
  device_verified_count int not null default 0,
  
  created_at timestamp with time zone not null default now()
);

create unique index push_system_health_metrics_tenant_period on push_system_health_metrics(tenant_id, metric_period);
create index push_system_health_metrics_tenant_created on push_system_health_metrics(tenant_id, created_at desc);

-- RLS Policy: Maintenance users can view health metrics for their tenant
alter table push_system_health_metrics enable row level security;

create policy "Maintenance can view tenant health metrics"
  on push_system_health_metrics for select
  using (
    exists (
      select 1 from public."Users" u
      where u.id = auth.uid()::uuid
        and u."UserType" = 'maintenance'
        and u.tenant_id = push_system_health_metrics.tenant_id
    )
  );

comment on table push_system_health_metrics is 'Aggregated system health snapshots (5-min buckets). Used for ops dashboards and SLA tracking.';
