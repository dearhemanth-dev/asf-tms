alter table public."Users"
  add column if not exists phone_number text;

insert into public."Users" ("UserName", "Password", "UserType", full_name, phone_number)
values ('hkmaintenance', 'p', 'maintenance', 'HK Maintenance', '+17147828319')
on conflict ("UserName") do update
set
  "UserType" = excluded."UserType",
  full_name = coalesce(public."Users".full_name, excluded.full_name),
  phone_number = excluded.phone_number;
