alter table public.assets
  add column if not exists allowed_outside_home_state text not null default 'no';

update public.assets
set allowed_outside_home_state = 'no'
where allowed_outside_home_state is null;

alter table public.assets
  drop constraint if exists assets_allowed_outside_home_state_check;

alter table public.assets
  add constraint assets_allowed_outside_home_state_check
  check (allowed_outside_home_state in ('yes', 'no'));
