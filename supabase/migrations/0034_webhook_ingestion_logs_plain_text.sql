-- Store webhook ingestion summary fields as plain readable text.
-- 1) event_types => text
-- 2) sample_event_types => text
-- 3) sample_provider_event_ids => provider_event_id

ALTER TABLE public.webhook_ingestion_logs
  ADD COLUMN IF NOT EXISTS provider_event_id text;

DO $$
DECLARE
  event_types_udt text;
  sample_event_types_udt text;
  sample_provider_event_ids_udt text;
  sample_event_ids_udt text;
BEGIN
  SELECT c.udt_name INTO event_types_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'webhook_ingestion_logs' AND c.column_name = 'event_types';

  IF event_types_udt = '_text' THEN
    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN event_types DROP DEFAULT;

    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN event_types TYPE text
      USING array_to_string(COALESCE(event_types, '{}'::text[]), ', ');

    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN event_types SET DEFAULT '';
  END IF;

  SELECT c.udt_name INTO sample_event_types_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'webhook_ingestion_logs' AND c.column_name = 'sample_event_types';

  IF sample_event_types_udt = '_text' THEN
    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN sample_event_types DROP DEFAULT;

    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN sample_event_types TYPE text
      USING array_to_string(COALESCE(sample_event_types, '{}'::text[]), ', ');

    ALTER TABLE public.webhook_ingestion_logs
      ALTER COLUMN sample_event_types SET DEFAULT '';
  END IF;

  SELECT c.udt_name INTO sample_provider_event_ids_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'webhook_ingestion_logs' AND c.column_name = 'sample_provider_event_ids';

  IF sample_provider_event_ids_udt = '_text' THEN
    UPDATE public.webhook_ingestion_logs
    SET provider_event_id = COALESCE(provider_event_id, (sample_provider_event_ids)[1])
    WHERE provider_event_id IS NULL;

    ALTER TABLE public.webhook_ingestion_logs
      DROP COLUMN sample_provider_event_ids;
  ELSIF sample_provider_event_ids_udt = 'text' THEN
    UPDATE public.webhook_ingestion_logs
    SET provider_event_id = COALESCE(provider_event_id, NULLIF(sample_provider_event_ids, ''))
    WHERE provider_event_id IS NULL;

    ALTER TABLE public.webhook_ingestion_logs
      DROP COLUMN sample_provider_event_ids;
  END IF;

  SELECT c.udt_name INTO sample_event_ids_udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'webhook_ingestion_logs' AND c.column_name = 'sample_event_ids';

  IF sample_event_ids_udt = '_text' THEN
    UPDATE public.webhook_ingestion_logs
    SET provider_event_id = COALESCE(provider_event_id, (sample_event_ids)[1])
    WHERE provider_event_id IS NULL;

    ALTER TABLE public.webhook_ingestion_logs
      DROP COLUMN sample_event_ids;
  ELSIF sample_event_ids_udt = 'text' THEN
    UPDATE public.webhook_ingestion_logs
    SET provider_event_id = COALESCE(provider_event_id, NULLIF(sample_event_ids, ''))
    WHERE provider_event_id IS NULL;

    ALTER TABLE public.webhook_ingestion_logs
      DROP COLUMN sample_event_ids;
  END IF;
END $$;

UPDATE public.webhook_ingestion_logs
SET sample_event_types = event_types
WHERE COALESCE(sample_event_types, '') = '';
