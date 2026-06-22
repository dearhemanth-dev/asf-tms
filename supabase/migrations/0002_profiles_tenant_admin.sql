drop policy if exists "profiles tenant admin read" on public.profiles;
create policy "profiles tenant admin read"
on public.profiles
for select
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);

drop policy if exists "profiles tenant admin write" on public.profiles;
create policy "profiles tenant admin write"
on public.profiles
for all
using (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
)
with check (
  tenant_id = (select tenant_id from public.current_profile())
  and (select role from public.current_profile()) in ('management', 'accounts')
);
