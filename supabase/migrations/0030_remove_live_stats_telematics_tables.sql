-- Cleanup migration: remove deprecated Live Stats telematics tables.
-- The Live Stats menu/page remain in the UI as a placeholder.

DROP TABLE IF EXISTS public.pending_shop_work_orders;
DROP TABLE IF EXISTS public.active_fault_codes;
DROP TABLE IF EXISTS public.asset_tire_snapshots;
DROP TABLE IF EXISTS public.asset_telematics_snapshots;
