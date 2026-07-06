-- Migration: Add GPS coordinates to driver_analytics_events
-- Purpose: Enable precise geographic tracking of all events
-- Supports: Real telematics integration, geospatial queries, route analysis, map visualizations

ALTER TABLE driver_analytics_events
ADD COLUMN latitude NUMERIC(10, 6),
ADD COLUMN longitude NUMERIC(10, 6);

-- Index for common geospatial analysis and sorting
CREATE INDEX IF NOT EXISTS idx_analytics_events_coords 
  ON driver_analytics_events(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Add comments for future maintainers
COMMENT ON COLUMN driver_analytics_events.latitude IS 'GPS latitude coordinate (WGS84, decimal degrees). Captures exact location where event occurred.';
COMMENT ON COLUMN driver_analytics_events.longitude IS 'GPS longitude coordinate (WGS84, decimal degrees). Captures exact location where event occurred.';
