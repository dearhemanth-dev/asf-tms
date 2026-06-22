create extension if not exists "pgcrypto";

-- Seed tenant and users (wrapped in exception handler for compatibility)
do $$
declare
  asf_tenant_id uuid;
  user_id uuid;
  seeded_email text;
  seeded_name text;
  seeded_role app_role;
  hashed_pw text;
begin
  insert into public.tenants (name, code)
  values ('ASF Logistics', 'ASF-MVP')
  on conflict (code) do update
    set name = excluded.name
  returning id into asf_tenant_id;

  for seeded_email, seeded_name, seeded_role in
    values
      ('gsmanager@asf.local', 'GS Manager', 'management'::app_role),
      ('gsaccounts@asf.local', 'GS Accounts', 'accounts'::app_role),
      ('gsdispatch@asf.local', 'GS Dispatch', 'dispatch'::app_role),
      ('gsdriver@asf.local', 'GS Driver', 'driver'::app_role)
  loop
    select id into user_id from auth.users where email = seeded_email;

    if user_id is null then
      user_id := gen_random_uuid();

      -- Try to hash with bcrypt, fallback to plaintext hash if pgcrypto fails
      begin
        hashed_pw := crypt('p', gen_salt('bf'));
      exception when undefined_function then
        -- Fallback: use a pre-hashed bcrypt hash of 'p' for demo purposes
        hashed_pw := '$2a$06$VwJLI3kSqD5t6eYLvBOLZuC0rWRKPKwDlPg.VsRnJNEQqr1TRfP9C';
      end;

      insert into auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      )
      values (
        user_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        seeded_email,
        hashed_pw,
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('full_name', seeded_name),
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      insert into auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        user_id,
        jsonb_build_object('sub', user_id::text, 'email', seeded_email),
        'email',
        seeded_email,
        now(),
        now(),
        now()
      );
    end if;

    insert into public.profiles (id, tenant_id, full_name, role)
    values (user_id, asf_tenant_id, seeded_name, seeded_role)
    on conflict (id) do update
      set tenant_id = excluded.tenant_id,
          full_name = excluded.full_name,
          role = excluded.role,
          updated_at = now();
  end loop;
end;
$$;
