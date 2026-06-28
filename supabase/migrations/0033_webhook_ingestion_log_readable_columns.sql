-- Make webhook ingestion log fields clearer for operational monitoring.
-- 1) Rename sample_event_ids -> sample_provider_event_ids
-- 2) Normalize event_types entries to readable labels

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'webhook_ingestion_logs'
      AND column_name = 'sample_event_ids'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'webhook_ingestion_logs'
      AND column_name = 'sample_provider_event_ids'
  ) THEN
    ALTER TABLE public.webhook_ingestion_logs
      RENAME COLUMN sample_event_ids TO sample_provider_event_ids;
  END IF;
END $$;

UPDATE public.webhook_ingestion_logs
SET event_types = (
  SELECT COALESCE(array_agg(
    CASE lower(trim(value))
      WHEN 'enginefaulton' THEN 'Engine Fault On'
      WHEN 'faultcoderaised' THEN 'Engine Fault On'
      WHEN 'dvirsubmitted' THEN 'DVIR Submitted'
      WHEN 'dvirdefectreported' THEN 'DVIR Submitted'
      WHEN 'severespeedingstarted' THEN 'Severe Speeding Started'
      WHEN 'severespeedingended' THEN 'Severe Speeding Ended'
      WHEN 'speedingintervalcompleted' THEN 'Severe Speeding Ended'
      WHEN 'predictivemaintenancealert' THEN 'Predictive Maintenance Alert'
      ELSE regexp_replace(replace(replace(trim(value), '_', ' '), '-', ' '), '([a-z])([A-Z])', '\1 \2', 'g')
    END
  ), '{}')
  FROM unnest(COALESCE(event_types, '{}'::text[])) AS value
)
WHERE event_types IS NOT NULL;
