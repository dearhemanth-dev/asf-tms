-- Push Verification Challenges Table
-- Tracks in-flight device verification attempts (test alert flows)
-- Lifecycle: user enrolls phone → challenge created → test alert sent → user confirms → challenge marked confirmed → device verified

create table push_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public."Users"(id) on delete cascade,
  device_id text not null,
  
  -- Unique token user must confirm to complete verification
  challenge_token text not null unique,
  
  -- Reference to the test alert we sent
  challenge_alert_id uuid references maintenance_alerts(id) on delete set null,
  
  -- Status of verification attempt
  status text not null default 'pending'::text check (status in ('pending', 'confirmed', 'expired', 'failed')),
  
  -- Timestamps
  created_at timestamp with time zone not null default now(),
  confirmed_at timestamp with time zone,
  expires_at timestamp with time zone not null, -- Default: 10 minutes from creation
  
  updated_at timestamp with time zone not null default now()
);

create index push_verification_challenges_token on push_verification_challenges(challenge_token);
create index push_verification_challenges_device_status on push_verification_challenges(device_id, status);
create index push_verification_challenges_expires_at on push_verification_challenges(expires_at);
create index push_verification_challenges_user_id on push_verification_challenges(user_id, created_at desc);

-- RLS Policy: Users can view/confirm their own challenges
alter table push_verification_challenges enable row level security;

create policy "Users can view their own verification challenges"
  on push_verification_challenges for select
  using (
    auth.uid()::uuid = user_id
  );

create policy "Users can update their own verification challenges"
  on push_verification_challenges for update
  using (
    auth.uid()::uuid = user_id
  );

create policy "Service can insert verification challenges"
  on push_verification_challenges for insert
  with check (true); -- Service role creates these via API

comment on table push_verification_challenges is 'In-flight device verification state. User confirms receipt of test alert by clicking challenge token in notification.';
