# SUPABASE SERVICE ROLE KEY - REQUIRED FOR BACKFILL

The backfill endpoint requires SUPABASE_SERVICE_ROLE_KEY for server-side database operations.

## How to Get It

1. Go to: https://app.supabase.com/projects
2. Select your project (ASF TMS)
3. Navigate to: Settings → API
4. Look for "Service role key" (labeled as "secret")
5. Copy the full key value

## Where to Add It

Edit `.env.local` and add:
```
SUPABASE_SERVICE_ROLE_KEY="your_key_here_paste_entire_secret"
```

## Security Note

- This key gives full database access
- NEVER commit to git
- NEVER share publicly
- Only used for server-side operations
- .env.local is already in .gitignore ✓

## After Adding

1. Save .env.local
2. Restart dev server: npm run dev
3. Test: POST http://localhost:3000/api/maintenance/backfill-test
4. Should show "Supabase Connection" as PASS

## Verification

If configured correctly, the diagnostic will show:
- "url_configured": true
- "service_role_key_configured": true
- Then continue with other tests (organizations, Samsara keys, etc.)
