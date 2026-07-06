-- Clear all old demo seeded events to make room for fresh GPS-enabled events
DELETE FROM driver_analytics_events 
WHERE data_source = 'demo_seed';

-- Clear old snapshots too
DELETE FROM driver_analytics_snapshots 
WHERE data_source = 'demo_seed';
