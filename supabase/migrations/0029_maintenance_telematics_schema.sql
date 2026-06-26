-- ============================================================
-- Migration: Maintenance Telematics & Work-Order Schema
-- NOTE: Historical migration. This schema was intentionally removed by
--       0030_remove_live_stats_telematics_tables.sql.
--       Keep this file for migration history integrity only.
-- Tables:
--   asset_telematics_snapshots  (consolidated metrics JSONB)
--   asset_tire_snapshots        (per-wheel JSONB array)
--   active_fault_codes          (open DTC registry)
--   pending_shop_work_orders    (automated action queue)
-- ============================================================

-- Core Historical Telematics Log
-- Consolidates all 24 normalised numeric/state stats into one JSONB field.
CREATE TABLE IF NOT EXISTS public.asset_telematics_snapshots (
    id             BIGSERIAL                   PRIMARY KEY,
    asset_no       TEXT                        NOT NULL,
    tenant_id      UUID                        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    snapshot_time  TIMESTAMPTZ                 NOT NULL,
    engine_state   VARCHAR(30)                 NOT NULL DEFAULT 'Unknown',
    telemetry      JSONB                       NOT NULL DEFAULT '{}',
    -- normalised fields stored inline in JSONB, e.g.:
    -- {"coolant_temp_f": 168.8, "oil_pressure_psi": 31.9, "fuel_gal": 55.2,
    --  "odometer_mi": 143200.5, "engine_hours": 23450.0, "engine_rpm": 1450,
    --  "engine_load_pct": 42, "battery_v": 13.8, "def_level_pct": 78,
    --  "idle_hours": 1120.3, "fuel_rate_gal_hr": 1.4, "total_fuel_gal": 8900.1,
    --  "idle_fuel_gal": 520.0, "coolant_level_pct": 100, "baro_psi": 14.5,
    --  "ecu_speed_mph": 0, "fuel_pct": 62, "obd_fuel_gal": 8850.5,
    --  "aux_input_1": null, "brakes_status": "ok"}
    created_at     TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    CONSTRAINT uq_asset_telematics_snapshot UNIQUE (tenant_id, asset_no, snapshot_time)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_jsonb
    ON public.asset_telematics_snapshots USING gin (telemetry);
CREATE INDEX IF NOT EXISTS idx_telematics_asset_time
    ON public.asset_telematics_snapshots (tenant_id, asset_no, snapshot_time DESC);

-- Core Historical Tire Log
-- Consolidates all 18 wheel positions into a structured JSONB array per snapshot.
CREATE TABLE IF NOT EXISTS public.asset_tire_snapshots (
    id             BIGSERIAL                   PRIMARY KEY,
    asset_no       TEXT                        NOT NULL,
    tenant_id      UUID                        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    snapshot_time  TIMESTAMPTZ                 NOT NULL,
    wheels         JSONB                       NOT NULL DEFAULT '[]',
    -- Format: [{"pos": 0, "psi": 102.5, "temp_f": 89.2, "lining_pct": 85}, ...]
    created_at     TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    CONSTRAINT uq_asset_tire_snapshot UNIQUE (tenant_id, asset_no, snapshot_time)
);

CREATE INDEX IF NOT EXISTS idx_tire_jsonb
    ON public.asset_tire_snapshots USING gin (wheels);
CREATE INDEX IF NOT EXISTS idx_tire_asset_time
    ON public.asset_tire_snapshots (tenant_id, asset_no, snapshot_time DESC);

-- Active Fault State Registry
-- Tracks open/closed DTCs via metadata payload. Uses upsert semantics.
CREATE TABLE IF NOT EXISTS public.active_fault_codes (
    id             BIGSERIAL                   PRIMARY KEY,
    asset_no       TEXT                        NOT NULL,
    tenant_id      UUID                        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    spn_id         INT                         NOT NULL,
    fmi_id         INT                         NOT NULL,
    meta           JSONB                       NOT NULL DEFAULT '{}',
    -- Format: {"spn_description": "...", "fmi_description": "...",
    --          "occurrence_count": 1, "lights": {"stop": true, "emissions": false}}
    is_resolved    BOOLEAN                     NOT NULL DEFAULT FALSE,
    first_seen     TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    last_seen      TIMESTAMPTZ                 NOT NULL DEFAULT now(),
    CONSTRAINT uq_active_fault UNIQUE (tenant_id, asset_no, spn_id, fmi_id, is_resolved)
);

CREATE INDEX IF NOT EXISTS idx_active_faults_asset
    ON public.active_fault_codes (tenant_id, asset_no, is_resolved);

-- Automated Action Queue
-- Populated automatically by the worker on fault, thermal, or DVIR triggers.
CREATE TABLE IF NOT EXISTS public.pending_shop_work_orders (
    id               BIGSERIAL                 PRIMARY KEY,
    asset_no         TEXT                      NOT NULL,
    tenant_id        UUID                      NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    source_type      VARCHAR(60)               NOT NULL,
    -- 'TELEMATICS_FAULT' | 'DRIVER_DVIR' | 'SCHEDULED_PM' | 'PREDICTIVE_THERMAL'
    description      TEXT                      NOT NULL,
    trigger_details  JSONB,
    priority         VARCHAR(20)               NOT NULL DEFAULT 'normal',
    -- 'critical' | 'high' | 'normal' | 'low'
    created_at       TIMESTAMPTZ               NOT NULL DEFAULT now(),
    is_completed     BOOLEAN                   NOT NULL DEFAULT FALSE,
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_orders_asset
    ON public.pending_shop_work_orders (tenant_id, asset_no, is_completed, created_at DESC);

-- RLS: allow maintenance + management roles to read/write these tables
ALTER TABLE public.asset_telematics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_tire_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_fault_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_shop_work_orders   ENABLE ROW LEVEL SECURITY;

-- Read policies (maintenance + management + service_role)
CREATE POLICY "telematics_read" ON public.asset_telematics_snapshots
  FOR SELECT USING (true);

CREATE POLICY "tire_read" ON public.asset_tire_snapshots
  FOR SELECT USING (true);

CREATE POLICY "fault_read" ON public.active_fault_codes
  FOR SELECT USING (true);

CREATE POLICY "workorder_read" ON public.pending_shop_work_orders
  FOR SELECT USING (true);

-- Write policies: service_role / worker bypass RLS; anon blocked
CREATE POLICY "telematics_write" ON public.asset_telematics_snapshots
  FOR INSERT WITH CHECK (true);

CREATE POLICY "tire_write" ON public.asset_tire_snapshots
  FOR INSERT WITH CHECK (true);

CREATE POLICY "fault_write" ON public.active_fault_codes
  FOR ALL WITH CHECK (true);

CREATE POLICY "workorder_write" ON public.pending_shop_work_orders
  FOR INSERT WITH CHECK (true);

CREATE POLICY "workorder_update" ON public.pending_shop_work_orders
  FOR UPDATE USING (true);
