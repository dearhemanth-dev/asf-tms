-- Cleanup legacy Supabase Auth seed users now that app login is Users-table based.
delete from auth.users
where email in (
  'gsmanager@asf.local',
  'gsaccounts@asf.local',
  'gsdispatch@asf.local',
  'gsdriver@asf.local'
);
