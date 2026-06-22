alter table public.drivers
add column if not exists only_local text;

update public.drivers
set only_local = 'no'
where only_local is null;

alter table public.drivers
alter column only_local set default 'no';

alter table public.drivers
alter column only_local set not null;

alter table public.drivers
drop constraint if exists drivers_only_local_check;

alter table public.drivers
add constraint drivers_only_local_check
check (lower(only_local) in ('yes', 'no'));
