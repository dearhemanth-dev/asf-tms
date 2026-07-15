-- Foundation table for SPN/FMI knowledge lookups used by webhook and cron pipelines.
CREATE TABLE IF NOT EXISTS public.fault_knowledge_base (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,

  -- J1939 fault identity pair used for deterministic machine lookup.
  spn integer NOT NULL,
  fmi integer NOT NULL,

  -- Human-maintenance context used to translate telematics into mechanic actions.
  affected_system text NOT NULL,
  mechanic_speak text NOT NULL,
  mechanic_repair_steps text NOT NULL,
  operational_danger text NOT NULL,

  -- Canonical automation command consumed by dispatch workflows.
  default_dispatch_action text NOT NULL,

  -- Provenance classification for confidence and governance.
  source_type text NOT NULL DEFAULT 'OEM_MANUAL',

  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  last_updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT uq_fault_knowledge_base_tenant_spn_fmi UNIQUE (tenant_id, spn, fmi),
  CONSTRAINT chk_fault_knowledge_base_source_type
    CHECK (source_type IN ('OEM_MANUAL', 'VERIFIED_FIX', 'AI_GENERATED')),
  CONSTRAINT chk_fault_knowledge_base_spn_nonnegative CHECK (spn >= 0),
  CONSTRAINT chk_fault_knowledge_base_fmi_range CHECK (fmi BETWEEN 0 AND 31),
  CONSTRAINT chk_fault_knowledge_base_affected_system_nonempty CHECK (btrim(affected_system) <> ''),
  CONSTRAINT chk_fault_knowledge_base_mechanic_speak_nonempty CHECK (btrim(mechanic_speak) <> ''),
  CONSTRAINT chk_fault_knowledge_base_repair_steps_nonempty CHECK (btrim(mechanic_repair_steps) <> ''),
  CONSTRAINT chk_fault_knowledge_base_operational_danger_nonempty CHECK (btrim(operational_danger) <> ''),
  CONSTRAINT chk_fault_knowledge_base_dispatch_action_nonempty CHECK (btrim(default_dispatch_action) <> '')
);

-- Optimized raw lookup path for SPN/FMI scans when tenant scope is resolved upstream.
CREATE INDEX IF NOT EXISTS idx_fault_knowledge_base_spn_fmi
  ON public.fault_knowledge_base (spn, fmi);

-- Optional planner aid for tenant-scoped browsing/grouping by subsystem.
CREATE INDEX IF NOT EXISTS idx_fault_knowledge_base_tenant_affected_system
  ON public.fault_knowledge_base (tenant_id, affected_system);

CREATE OR REPLACE FUNCTION public.fault_knowledge_base_set_last_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fault_knowledge_base_set_last_updated_at ON public.fault_knowledge_base;
CREATE TRIGGER fault_knowledge_base_set_last_updated_at
BEFORE UPDATE ON public.fault_knowledge_base
FOR EACH ROW
EXECUTE FUNCTION public.fault_knowledge_base_set_last_updated_at();

ALTER TABLE public.fault_knowledge_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fault_knowledge_base_tenant_read" ON public.fault_knowledge_base;
DROP POLICY IF EXISTS "fault_knowledge_base_tenant_write" ON public.fault_knowledge_base;

CREATE POLICY "fault_knowledge_base_tenant_read" ON public.fault_knowledge_base
  FOR SELECT USING (true);

CREATE POLICY "fault_knowledge_base_tenant_write" ON public.fault_knowledge_base
  FOR ALL USING (true);
