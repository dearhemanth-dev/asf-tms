-- Add driver_name column to driver_analytics_snapshots for display without joins
ALTER TABLE driver_analytics_snapshots
  ADD COLUMN IF NOT EXISTS driver_name TEXT;
