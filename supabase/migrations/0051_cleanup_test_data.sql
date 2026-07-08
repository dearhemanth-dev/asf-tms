-- Clean slate for backfill bulletproofing development
-- Clears test alerts, push subscriptions, and audit logs
-- DEVELOPMENT ONLY: run only for hkmaintenance user testing

-- Delete all test maintenance alerts (keeps them clean for dev)
DELETE FROM public.maintenance_alerts
WHERE status = 'open' 
  AND created_at > now() - interval '30 days'
  AND title LIKE '%Test%'
  OR title LIKE '%Demo%'
  OR description LIKE '%Test%';

-- Delete old webhook ingestion logs (keep last 2 days for reference)
DELETE FROM public.webhook_ingestion_logs
WHERE received_at < now() - interval '2 days';

-- Delete push action audit logs older than 7 days (keep recent for debugging)
DELETE FROM public.maintenance_push_action_logs
WHERE created_at < now() - interval '7 days';

-- Refresh maintenance_alerts_webhook_monitor
REFRESH MATERIALIZED VIEW IF EXISTS maintenance_alerts_webhook_monitor;

-- Success: test data cleaned
SELECT 
  'Test data cleanup complete' as status,
  now() as cleaned_at;
