# ASF TMS

ASF Transportation Management System built with Next.js and Supabase.

## Stack

- Next.js (App Router)
- TypeScript
- Supabase (Postgres)
- Vercel deployment

## Current Authentication Model

Login uses database table `public."Users"` (not Supabase Auth).

- Username/password are validated against `Users`.
- Session is tracked with app cookies (`asf_login`, `asf_role`) and sessionStorage.
- Legacy `profiles` table has been removed.

## Seed Users (current)

Default password for seeded users is `p`:

- gsmanager
- gsaccounts
- gsmaitenance
- gsdispatch
- rbmanager
- rbaccounts
- rbmaintenance
- rbdispatch
- skmaintenance
- skaccounts

## Local Development

1. Install dependencies

```bash
npm install
```

2. Configure environment in `.env.local`

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Start development server

```bash
npm run dev
```

4. Open app

- http://localhost:3000

## Database Migrations

Supabase migrations are in `supabase/migrations`.

Apply migrations to linked project:

```bash
npx supabase db push --linked --yes
```

Recent important migrations:

- `0010_remove_profiles.sql` moved identity ownership to `Users` and removed `profiles`.
- `0011_cleanup_legacy_auth_seed_users.sql` removed old Supabase Auth seed users.

## Deploy

From the `asf-tms` directory, deploy to Vercel:

```bash
npm run deploy:prod
```

Preview deployment:

```bash
npm run deploy:preview
```
