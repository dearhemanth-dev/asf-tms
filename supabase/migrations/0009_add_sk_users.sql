insert into public."Users" ("UserName", "Password", "UserType")
values
  ('skmaintenance', 'p', 'maintenance'),
  ('skaccounts', 'p', 'accounts')
on conflict ("UserName") do update
  set "Password" = excluded."Password",
      "UserType" = excluded."UserType";