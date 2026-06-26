-- Maintenance alerts: stores real-time events from Samsara webhooks
-- Populated by POST /api/webhooks/samsara
-- Read by maintenance role in-app alert feed

CREATE TABLE IF NOT EXISTS public.maintenance_alerts (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text          NOT NULL,

  -- Samsara event metadata
  event_type       text          NOT NULL,   -- e.g. "FaultCode", "DVIRSubmitted", "SafetyEvent"
  event_id         text,                     -- Samsara's own event ID (for dedup)
  occurred_at      timestamptz   NOT NULL,   -- event time from Samsara payload
  received_at      timestamptz   NOT NULL DEFAULT now(),

  -- Vehicle + driver
  vehicle_id       text,
  vehicle_name     text,
  driver_id        text,
  driver_name      text,

  -- Alert content
  severity         text          NOT NULL DEFAULT 'info',   -- 'critical', 'warning', 'info'
  title            text          NOT NULL,
  description      text,

  -- Lifecycle
  status           text          NOT NULL DEFAULT 'open',   -- 'open', 'acknowledged', 'resolved'
  acknowledged_by  text,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,

  -- Raw payload kept for debugging / future use
  raw_payload      jsonb,

  CONSTRAINT maintenance_alerts_severity_check
    CHECK (severity IN ('critical', 'warning', 'info')),
  CONSTRAINT maintenance_alerts_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved'))
);

-- Dedup: ignore duplicate Samsara event IDs per tenant
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_alerts_event_id_tenant_idx
  ON public.maintenance_alerts (tenant_id, event_id)
  WHERE event_id IS NOT NULL;

-- Fast queries for open alerts per tenant, newest first
CREATE INDEX IF NOT EXISTS maintenance_alerts_tenant_status_idx
  ON public.maintenance_alerts (tenant_id, status, occurred_at DESC);

-- RLS: only same-tenant users can read/write
ALTER TABLE public.maintenance_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can read own alerts"
  ON public.maintenance_alerts FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY "Service role can insert alerts"
  ON public.maintenance_alerts FOR INSERT
  WITH CHECK (true);  -- webhook uses service role key
