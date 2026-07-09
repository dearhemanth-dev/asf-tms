-- Push Alert Delivery Log Table
-- Audit trail for every push notification delivery attempt
-- Enables: "Why didn't user X get alert Y?" debugging with exact timestamps and reasons

create table push_alert_delivery_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  alert_id uuid not null references public.maintenance_alerts(id) on delete cascade,
  device_id text not null,
  user_id uuid not null references public."Users"(id) on delete cascade,
  
  -- Delivery status and lifecycle
  status text not null default 'pending'::text check (status in ('pending', 'sent', 'delivered', 'failed')),
  failure_reason text, -- 'rate_limited', 'device_offline', 'token_expired', 'retry_exhausted', etc
  
  -- Timestamps for latency tracking
  received_at timestamp with time zone not null, -- When alert arrived from webhook/backfill
  queued_at timestamp with time zone not null default now(), -- When we queued for delivery
  sent_at timestamp with time zone, -- When we actually sent push
  delivered_at timestamp with time zone, -- When device confirmed receipt
  final_status_at timestamp with time zone not null default now(),
  
  -- Retry tracking
  retry_count int not null default 0,
  last_retry_at timestamp with time zone,
  
  -- Debugging: full error object
  error_details jsonb,
  
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index push_alert_delivery_log_tenant_user_created on push_alert_delivery_log(tenant_id, user_id, created_at desc);
create index push_alert_delivery_log_alert_id on push_alert_delivery_log(alert_id);
create index push_alert_delivery_log_status_final on push_alert_delivery_log(status, final_status_at desc);
create index push_alert_delivery_log_device_id on push_alert_delivery_log(device_id, created_at desc);
create index push_alert_delivery_log_failed_delivery on push_alert_delivery_log(status, failure_reason) where status = 'failed'::text;

-- RLS Policy: Users can see their own delivery history
alter table push_alert_delivery_log enable row level security;

create policy "Users can view their own delivery history"
  on push_alert_delivery_log for select
  using (
    auth.uid()::uuid = user_id
  );

create policy "Maintenance can view tenant delivery logs"
  on push_alert_delivery_log for select
  using (
    exists (
      select 1 from public."Users" u
      where u.id = auth.uid()::uuid
        and u."UserType" = 'maintenance'
        and u.tenant_id = push_alert_delivery_log.tenant_id
    )
  );

comment on table push_alert_delivery_log is 'Complete audit trail of push delivery attempts with retry history and failure reasons. Enables ops to debug why users missed alerts.';
