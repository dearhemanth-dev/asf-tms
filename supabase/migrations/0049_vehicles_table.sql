-- Vehicles table: Stores vehicle metadata including fuel tank capacity
-- VIN lookup enables calculation of fuel consumption from tank level changes
-- Supports multiple ELD providers (Samsara, Geotab, Verizon, etc.)

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Vehicle Identifiers
  truck_unit_number TEXT NOT NULL,
  vin TEXT UNIQUE NOT NULL,
  
  -- Manufacturer Data
  make TEXT,
  model TEXT,
  model_year INTEGER,
  
  -- Fuel System Specs
  fuel_tank_capacity_gallons NUMERIC(8,2) NOT NULL,
  fuel_tank_capacity_liters NUMERIC(8,2),
  
  -- ELD Provider Integration
  data_source TEXT DEFAULT 'manual', -- 'samsara', 'geotab', 'verizon', 'manual', etc.
  source_vehicle_id TEXT, -- External provider's vehicle ID
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Constraints
  UNIQUE(tenant_id, truck_unit_number),
  CONSTRAINT fuel_tank_capacity_positive CHECK (fuel_tank_capacity_gallons > 0),
  CONSTRAINT valid_model_year CHECK (model_year IS NULL OR model_year >= 1950)
);

-- Index for lookups by truck unit and VIN
CREATE INDEX idx_vehicles_tenant_truck_unit ON vehicles(tenant_id, truck_unit_number);
CREATE INDEX idx_vehicles_vin ON vehicles(vin);
CREATE INDEX idx_vehicles_data_source ON vehicles(data_source);

-- Link analytics events to vehicles for fuel consumption calculations
-- This enables: fuel_level_2h_ago vs fuel_level_now × tank_capacity = consumed
ALTER TABLE driver_analytics_events 
ADD COLUMN vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE INDEX idx_events_vehicle_id ON driver_analytics_events(vehicle_id);

-- Audit trigger for updated_at (inline function)
CREATE OR REPLACE FUNCTION update_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_vehicles_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION update_vehicles_updated_at();

-- VIN Decoder Reference
-- Use external VIN decoder API (NHTSA, Samsara VIN endpoint) to populate:
-- - make, model, model_year
-- - fuel_tank_capacity_gallons (from vehicle spec database)
--
-- Example fuel tank capacities (common trucking models):
-- Peterbilt 579: 150 gal
-- Kenworth T680: 150 gal  
-- Volvo VNL: 125 gal
-- Freightliner Cascadia: 120 gal
--
-- For MVP: Manually seed common truck models
-- For production: Integrate with vehicle spec API (Samsara VIN endpoint, NHTSA VIN decoder)
