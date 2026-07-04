alter table public.organizations
  add column if not exists samsara_webhook_url text,
  add column if not exists samsara_webhook_secret text;

create index if not exists organizations_samsara_webhook_url_idx
  on public.organizations (samsara_webhook_url)
  where samsara_webhook_url is not null;