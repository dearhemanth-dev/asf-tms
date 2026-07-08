-- Backfill Ingestion Log Table
-- Tracks all backfill operations for audit and debugging
-- Used by /api/maintenance/backfill-bulletproof

CREATE TABLE IF NOT EXISTS public.backfill_ingestion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  triggered_by text NOT NULL,  -- username who triggered
  
  -- Operation stats
  keys_processed int NOT NULL,
  keys_succeeded int NOT NULL,
  keys_failed int NOT NULL,
  
  vehicles_found int NOT NULL,
  
  alerts_attempted int NOT NULL,
  alerts_inserted int NOT NULL,
  alerts_duplicate int NOT NULL,
  alerts_errored int NOT NULL,
  
  duration_ms int NOT NULL,
  error_count int DEFAULT 0,
  error_summary text,          -- Newline-separated error messages
  
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index: Query recent backfills by tenant
CREATE INDEX IF NOT EXISTS backfill_ingestion_log_tenant_completed_idx
  ON public.backfill_ingestion_log (tenant_id, completed_at DESC);

-- Index: Query all backfills by user
CREATE INDEX IF NOT EXISTS backfill_ingestion_log_triggered_by_idx
  ON public.backfill_ingestion_log (triggered_by, completed_at DESC);

-- Index: Query errors
CREATE INDEX IF NOT EXISTS backfill_ingestion_log_error_count_idx
  ON public.backfill_ingestion_log (error_count DESC) 
  WHERE error_count > 0;

COMMENT ON TABLE public.backfill_ingestion_log IS 
  'Audit log for Samsara backfill ingestion jobs. Tracks what was processed and any errors.';

COMMENT ON COLUMN public.backfill_ingestion_log.triggered_by IS
  'Username that triggered this backfill. Should be hkmaintenance for dev phase.';

COMMENT ON COLUMN public.backfill_ingestion_log.error_summary IS
  'Semicolon-separated error messages from this ingestion run for quick diagnosis.';
