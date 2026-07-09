-- Push Device Enrollments Table
-- Tracks which devices are enrolled to receive push notifications
-- Critical for verifying users actually have working device setup

create table push_device_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public."Users"(id) on delete cascade,
  device_id text not null, -- Browser push subscription endpoint fingerprint
  device_os text not null, -- 'ios', 'android', 'web'
  browser text, -- 'safari', 'chrome', 'firefox', etc
  status text not null default 'pending'::text check (status in ('pending', 'verified', 'unverified', 'revoked')),
  enrolled_at timestamp with time zone not null default now(),
  verified_at timestamp with time zone,
  last_verification_attempt_at timestamp with time zone,
  verification_attempts int not null default 0,
  last_test_alert_id uuid,
  user_agent text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  
  -- Prevent duplicate enrollments for same device on same tenant
  unique(tenant_id, user_id, device_id)
);

create index push_device_enrollments_tenant_user on push_device_enrollments(tenant_id, user_id);
create index push_device_enrollments_tenant_status on push_device_enrollments(tenant_id, status);
create index push_device_enrollments_verified_at on push_device_enrollments(verified_at, status);

-- RLS Policy: Users can see their own enrollments
alter table push_device_enrollments enable row level security;

create policy "Users can view their own device enrollments"
  on push_device_enrollments for select
  using (
    auth.uid()::uuid in (
      select id from public."Users" where id = user_id
    )
  );

create policy "Users can insert their own device enrollments"
  on push_device_enrollments for insert
  with check (
    auth.uid()::uuid in (
      select id from public."Users" where id = user_id
    )
  );

create policy "Users can update their own device enrollments"
  on push_device_enrollments for update
  using (
    auth.uid()::uuid in (
      select id from public."Users" where id = user_id
    )
  );

-- Maintenance role can view all enrollments in their tenant
create policy "Maintenance can view tenant device enrollments"
  on push_device_enrollments for select
  using (
    exists (
      select 1 from public."Users" u
      where u.id = auth.uid()::uuid
        and u."UserType" = 'maintenance'
        and u.tenant_id = push_device_enrollments.tenant_id
    )
  );

comment on table push_device_enrollments is 'Device enrollment registry with verification status. Critical for scale: tracks which users have verified device setup.';
