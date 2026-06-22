alter table public.organizations
  add column if not exists samsara_api_key text,
  add column if not exists fuelguru_fleet_id text;
