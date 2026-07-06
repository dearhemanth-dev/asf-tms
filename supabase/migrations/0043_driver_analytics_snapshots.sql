-- Driver Analytics Snapshots: Daily aggregated metrics for reporting
-- One row per driver per day; foundation for 7/30/90-day reporting

CREATE TABLE IF NOT EXISTS driver_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  truck_unit_number VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,

  -- Pillar 1: Safety (35%) — Harsh events + speeding
  harsh_braking_count INT DEFAULT 0,
  harsh_accel_count INT DEFAULT 0,
  harsh_corner_count INT DEFAULT 0,
  speeding_violations INT DEFAULT 0,
  speeding_minutes INT DEFAULT 0,

  -- Pillar 2: Idling (20%)
  engine_minutes NUMERIC DEFAULT 0,
  idling_minutes NUMERIC DEFAULT 0,
  idling_ratio NUMERIC DEFAULT 0, -- idling_minutes / engine_minutes (0.0-1.0)

  -- Pillar 3: Fuel (15%)
  avg_fuel_level NUMERIC,
  fuel_consumed_liters NUMERIC,
  fuel_economy_mpg NUMERIC, -- calculated: miles / liters
  low_fuel_events INT DEFAULT 0, -- times fuel dropped to ≤15%

  -- Pillar 4: DVIR/Compliance (15%) — Placeholder for HOS/DVIR
  dvir_defects_count INT DEFAULT 0,
  maintenance_alerts_count INT DEFAULT 0,
  -- Future: duty_status_violations, odometer_jumps (HOS data)

  -- Pillar 5: Maintenance (15%)
  fault_codes_count INT DEFAULT 0,
  high_temp_events INT DEFAULT 0, -- coolant ≥105°C
  low_oil_events INT DEFAULT 0, -- oil pressure <110 kPa
  high_rpm_events INT DEFAULT 0, -- rpm >2500
  high_load_events INT DEFAULT 0, -- load >92%

  -- Metadata
  data_source VARCHAR(20) DEFAULT 'samsara', -- samsara, manual, hybrid
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Prevent duplicate entries per driver per day
  UNIQUE(tenant_id, driver_id, snapshot_date)
);

-- Note: FK constraints are deferred to a future migration to avoid dependency on evolving auth schema.
-- This keeps the analytics layer independent and safe for iterative development.

CREATE INDEX idx_analytics_tenant_date ON driver_analytics_snapshots(tenant_id, snapshot_date DESC);
CREATE INDEX idx_analytics_driver_date ON driver_analytics_snapshots(driver_id, snapshot_date DESC);

-- Note: Row-level security policies will be added in a future migration after FK constraints.
-- This keeps schema simple for initial data layer validation.

-- Comment for documentation
COMMENT ON TABLE driver_analytics_snapshots IS 
  'Daily driver performance metrics aggregated from Samsara. Foundation for DPI scoring and historical trending across 7/30/90-day windows.';
COMMENT ON COLUMN driver_analytics_snapshots.idling_ratio IS
  'Normalized ratio (0.0-1.0) for penalty calculation. Values > 1.0 indicate exceptional idling that reduces score.';
COMMENT ON COLUMN driver_analytics_snapshots.fuel_economy_mpg IS
  'Calculated from fuel_consumed_liters and odometer; null if insufficient data.';
