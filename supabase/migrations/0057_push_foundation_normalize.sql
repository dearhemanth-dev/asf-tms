-- Migration 0057: Normalize and fix push notification foundation
--
-- Problems fixed:
-- 1. DROP push_device_enrollments (0053) — duplicates maintenance_push_subscriptions
--    but was missing the crypto keys (p256dh, auth) needed to actually send pushes.
--    Extend maintenance_push_subscriptions with verification columns instead.
-- 2. Fix push_alert_delivery_log.device_id (text, no FK) → subscription_id (uuid FK)
-- 3. Redesign push_system_health_metrics:
--    - Remove derived delivery_success_rate column (compute at query time)
--    - Remove webhook/backfill columns (wrong table, different update frequency)
--    - Remove denormalized device_enrollment_count/device_verified_count
--    - Use (tenant_id, metric_period) composite PK (uuid id was unused)
--    - Add separate push_pipeline_health table for webhook + backfill status
-- 4. Fix push_verification_challenges:
--    - device_id (text, no FK) → subscription_id (uuid FK with cascade)
--    - Add partial unique index: one pending challenge per subscription
--    - Fix maintenance_alerts reference to use explicit public. schema prefix
--    - Remove dangerous insert policy (service role handles inserts)

-- ============================================================
-- STEP 1: Drop enrollment duplicate table (0053)
-- ============================================================
drop table if exists push_device_enrollments cascade;

-- ============================================================
-- STEP 2: Extend maintenance_push_subscriptions with
--         verification status columns
-- ============================================================
alter table public.maintenance_push_subscriptions
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'revoked')),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_attempts int not null default 0,
  add column if not exists last_verification_attempt_at timestamptz;

-- Index for fast lookup of verified devices per tenant
create index if not exists maintenance_push_subscriptions_tenant_status_idx
  on public.maintenance_push_subscriptions (tenant_id, status);

-- Index for user's verified devices
create index if not exists maintenance_push_subscriptions_username_status_idx
  on public.maintenance_push_subscriptions (username, status);

comment on table public.maintenance_push_subscriptions is
  'Canonical device enrollment table. Stores VAPID push subscription including p256dh and auth keys. status tracks verification lifecycle: pending→verified, expired, revoked.';

-- ============================================================
-- STEP 3: Fix push_alert_delivery_log
--         device_id text → subscription_id uuid FK
-- ============================================================

-- Drop old table and recreate with correct schema
-- (table was created in 0054 and has no production data yet)
drop table if exists push_alert_delivery_log cascade;

create table public.push_alert_delivery_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  alert_id uuid not null references public.maintenance_alerts(id) on delete cascade,
  subscription_id uuid not null references public.maintenance_push_subscriptions(id) on delete cascade,
  username text not null, -- denormalized for fast queries without JOIN

  -- Delivery status
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  -- 'sent'   = push service accepted payload (FCM/APNs/VAPID server)
  -- 'failed' = push service rejected or max retries exhausted
  -- Note: web push has no delivery receipt. 'sent' means accepted, not received on device.

  failure_reason text,
  -- 'invalid_subscription' | 'push_service_error' | 'rate_limited' | 'retry_exhausted'
  -- | 'subscription_expired' | 'payload_too_large'

  -- Timestamps
  received_at timestamptz not null,   -- when alert was ingested (from webhook/backfill)
  queued_at timestamptz not null default now(),
  sent_at timestamptz,                -- when push service accepted payload
  failed_at timestamptz,             -- when delivery definitively failed

  -- Retry tracking
  retry_count int not null default 0,
  last_retry_at timestamptz,
  next_retry_at timestamptz,          -- scheduled retry time (null = no retry pending)

  -- Raw error for debugging
  error_details jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Primary ops query: all delivery attempts for a given alert in a tenant
create index push_alert_delivery_log_tenant_alert
  on public.push_alert_delivery_log (tenant_id, alert_id);

-- User's own delivery history (sorted by recency)
create index push_alert_delivery_log_username_created
  on public.push_alert_delivery_log (tenant_id, username, created_at desc);

-- Dead letter queue: failed deliveries
create index push_alert_delivery_log_failed
  on public.push_alert_delivery_log (tenant_id, status, failed_at desc)
  where status = 'failed';

-- Pending/retry queue
create index push_alert_delivery_log_pending
  on public.push_alert_delivery_log (next_retry_at)
  where status = 'pending' and next_retry_at is not null;

-- Subscription delivery history
create index push_alert_delivery_log_subscription
  on public.push_alert_delivery_log (subscription_id, created_at desc);

alter table public.push_alert_delivery_log enable row level security;

create policy "Users can view their own delivery history"
  on public.push_alert_delivery_log for select
  using (
    username = (
      select "UserName" from public."Users" where id = auth.uid()::uuid
    )
  );

create policy "Maintenance can view tenant delivery logs"
  on public.push_alert_delivery_log for select
  using (
    tenant_id = (
      select tenant_id from public."Users"
      where id = auth.uid()::uuid
        and "UserType" = 'maintenance'
    )
  );

comment on table public.push_alert_delivery_log is
  'Audit trail of every push notification delivery attempt. One row per alert × subscription.
   Enables: "Why did user X not get alert Y?" with exact timestamps and failure reasons.
   Note: web push has no delivery receipt — status=sent means push service accepted, not that device received it.';

-- ============================================================
-- STEP 4: Redesign push_system_health_metrics
--         - Remove derived column (delivery_success_rate)
--         - Remove webhook/backfill columns (wrong table)
--         - Remove denormalized enrollment counts
--         - Use composite PK instead of unused uuid id
-- ============================================================
drop table if exists push_system_health_metrics cascade;

create table public.push_system_health_metrics (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric_period timestamptz not null,  -- 5-min bucket: date_trunc('hour', now()) + interval '5 min' * floor(extract(minute from now()) / 5)

  -- Volume counts (raw, not derived)
  alerts_queued int not null default 0,
  alerts_sent int not null default 0,
  alerts_failed int not null default 0,
  -- delivery_success_rate is NOT stored — compute as: alerts_sent * 100.0 / NULLIF(alerts_queued, 0)

  -- Latency in milliseconds (queued_at → sent_at)
  latency_p50_ms int,
  latency_p95_ms int,
  latency_p99_ms int,

  created_at timestamptz not null default now(),

  -- Composite PK: no separate uuid needed, this IS the identity
  primary key (tenant_id, metric_period)
);

create index push_system_health_metrics_period_desc
  on public.push_system_health_metrics (tenant_id, metric_period desc);

alter table public.push_system_health_metrics enable row level security;

create policy "Maintenance can view tenant health metrics"
  on public.push_system_health_metrics for select
  using (
    tenant_id = (
      select tenant_id from public."Users"
      where id = auth.uid()::uuid
        and "UserType" = 'maintenance'
    )
  );

comment on table public.push_system_health_metrics is
  'Push delivery volume and latency metrics in 5-min buckets.
   Compute success_rate at query time: alerts_sent * 100.0 / NULLIF(alerts_queued, 0).
   Webhook and backfill health live in push_pipeline_health (different update frequency).';

-- ============================================================
-- STEP 5: New push_pipeline_health table
--         Replaces webhook/backfill columns that were incorrectly
--         in push_system_health_metrics. Updated on each event.
-- ============================================================
create table public.push_pipeline_health (
  tenant_id uuid not null primary key references public.tenants(id) on delete cascade,

  -- Webhook health (updated on each webhook event received)
  webhook_last_event_at timestamptz,
  webhook_is_stale boolean not null default false,   -- true if no events in last 5 min
  webhook_events_24h int not null default 0,
  webhook_errors_24h int not null default 0,

  -- Backfill health (updated on each backfill run)
  backfill_last_run_at timestamptz,
  backfill_last_status text check (backfill_last_status in ('success', 'partial_failure', 'failure')),
  backfill_consecutive_failures int not null default 0,
  backfill_vehicles_last_run int,
  backfill_alerts_last_run int,

  updated_at timestamptz not null default now()
);

alter table public.push_pipeline_health enable row level security;

create policy "Maintenance can view pipeline health"
  on public.push_pipeline_health for select
  using (
    tenant_id = (
      select tenant_id from public."Users"
      where id = auth.uid()::uuid
        and "UserType" = 'maintenance'
    )
  );

comment on table public.push_pipeline_health is
  'One row per tenant. Current health of the data ingestion pipeline.
   Webhook fields update on each webhook event; backfill fields update on each backfill run.
   Separated from push_system_health_metrics because they change at different rates.';

-- ============================================================
-- STEP 6: Fix push_verification_challenges
--         - device_id text → subscription_id uuid FK with cascade
--         - Remove dangerous insert-for-anyone RLS policy
--         - Add partial unique: one pending challenge per subscription
--         - Fix public. prefix on maintenance_alerts reference
-- ============================================================
drop table if exists push_verification_challenges cascade;

create table public.push_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  username text not null,
  subscription_id uuid not null references public.maintenance_push_subscriptions(id) on delete cascade,

  -- Token the user must confirm to complete verification
  challenge_token text not null unique,

  -- Reference to the test alert we sent
  challenge_alert_id uuid references public.maintenance_alerts(id) on delete set null,

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'expired', 'failed')),

  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null,  -- 10 minutes from created_at

  updated_at timestamptz not null default now()
);

-- Token lookup (primary access pattern for verification confirmation)
create index push_verification_challenges_token
  on public.push_verification_challenges (challenge_token);

-- One pending challenge per subscription at a time
create unique index push_verification_challenges_one_pending
  on public.push_verification_challenges (subscription_id)
  where status = 'pending';

-- Cleanup: find expired pending challenges
create index push_verification_challenges_expires
  on public.push_verification_challenges (expires_at)
  where status = 'pending';

-- User's challenge history
create index push_verification_challenges_username
  on public.push_verification_challenges (username, created_at desc);

alter table public.push_verification_challenges enable row level security;

-- Users can read their own challenges (to confirm them)
create policy "Users can view their own verification challenges"
  on public.push_verification_challenges for select
  using (
    username = (
      select "UserName" from public."Users" where id = auth.uid()::uuid
    )
  );

-- Users can update status (confirm) their own pending challenges
create policy "Users can confirm their own challenges"
  on public.push_verification_challenges for update
  using (
    username = (
      select "UserName" from public."Users" where id = auth.uid()::uuid
    )
  )
  with check (status in ('confirmed', 'failed'));

-- NO insert policy: inserts are service-role only via API (VAPID sending logic)
-- This prevents any authenticated user from forging challenges for other users.

comment on table public.push_verification_challenges is
  'In-flight device verification challenges. Lifecycle: pending → confirmed (user tapped test alert).
   Partial unique index enforces one active challenge per subscription.
   Inserts are service-role only — no user-facing insert RLS policy.';
