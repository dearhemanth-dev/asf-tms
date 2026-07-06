-- Migration: Create driver_analytics_events table for detailed event-level data
-- Purpose: Source-of-truth table capturing all individual driver events that aggregate into daily snapshots
-- Design: Provider-agnostic, fully queryable, supports multi-ELD future expansion

CREATE TABLE IF NOT EXISTS driver_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  truck_unit_number VARCHAR,
  event_date DATE NOT NULL,
  event_timestamp TIMESTAMPTZ,
  event_type VARCHAR NOT NULL,
  metric_value NUMERIC,
  event_count INT,
  duration_minutes INT,
  data_source VARCHAR NOT NULL,
  source_id VARCHAR,
  status VARCHAR DEFAULT 'confirmed',
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_driver_date 
  ON driver_analytics_events(tenant_id, driver_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_type_date 
  ON driver_analytics_events(tenant_id, event_type, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_source 
  ON driver_analytics_events(data_source, source_id);

CREATE INDEX IF NOT EXISTS idx_analytics_events_status 
  ON driver_analytics_events(status);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type 
  ON driver_analytics_events(event_type);

-- Comment on table for future maintainers
COMMENT ON TABLE driver_analytics_events IS 'Detailed driver event records backing daily snapshots. Provider-agnostic (supports Samsara, Geotab, Verizon, DVIR, manual entry). Each row explains one category of events for one driver on one date.';

COMMENT ON COLUMN driver_analytics_events.event_type IS 'Event category: harsh_brake_incident, harsh_accel_incident, harsh_corner_incident, speeding_incident, idling_episode, low_fuel_incident, dvir_defect, fault_code, high_temp_event, oil_low_event, rpm_high_event, load_high_event, fuel_consumption';

COMMENT ON COLUMN driver_analytics_events.data_source IS 'Provider: samsara | geotab | verizon | dvir | manual';

COMMENT ON COLUMN driver_analytics_events.source_id IS 'Native ID from provider (samsara_evt_123, geotab_xyz789, dvir_defect_456, etc)';

COMMENT ON COLUMN driver_analytics_events.status IS 'Data quality: confirmed | pending_review | disputed | corrected';

COMMENT ON COLUMN driver_analytics_events.details IS 'JSONB with provider-agnostic fields: severity, location, speed, component, description, weather, route_context, plus provider_metadata{} for provider-specific data';
