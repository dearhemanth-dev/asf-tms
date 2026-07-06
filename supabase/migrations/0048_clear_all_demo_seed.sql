-- Clear all demo seed events for clean reseed
DELETE FROM driver_analytics_events WHERE data_source = 'demo_seed';
DELETE FROM driver_analytics_snapshots WHERE data_source = 'demo_seed';
