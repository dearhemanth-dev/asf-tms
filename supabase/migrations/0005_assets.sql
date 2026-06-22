-- Create Assets table
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_unit_number TEXT NOT NULL,
  asset_type TEXT DEFAULT 'truck',
  vin TEXT,
  year TEXT,
  make TEXT,
  model TEXT,
  license_plate TEXT,
  ownership_type TEXT DEFAULT 'company',
  mileage TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_asset_per_tenant UNIQUE (tenant_id, asset_unit_number)
);

-- Add missing columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'asset_unit_number') THEN
    ALTER TABLE assets ADD COLUMN asset_unit_number TEXT NOT NULL DEFAULT 'UNKNOWN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'asset_type') THEN
    ALTER TABLE assets ADD COLUMN asset_type TEXT DEFAULT 'truck';
  END IF;
END $$;

-- Create indexes (if not exists)
CREATE INDEX IF NOT EXISTS idx_assets_tenant_id ON assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_unit_number ON assets(asset_unit_number);

-- Enable RLS
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- RLS policy: Tenant members can read assets in their tenant
DROP POLICY IF EXISTS "assets_read_policy" ON assets;
CREATE POLICY "assets_read_policy" ON assets
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- RLS policy: Tenant admins (management, accounts) can insert/update/delete
DROP POLICY IF EXISTS "assets_write_policy" ON assets;
CREATE POLICY "assets_write_policy" ON assets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
    AND
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('management', 'accounts')
  );

DROP POLICY IF EXISTS "assets_update_policy" ON assets;
CREATE POLICY "assets_update_policy" ON assets
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
    AND
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('management', 'accounts')
  );

DROP POLICY IF EXISTS "assets_delete_policy" ON assets;
CREATE POLICY "assets_delete_policy" ON assets
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
    AND
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('management', 'accounts')
  );

-- Trigger to set tenant_id and created_by from current_profile()
CREATE OR REPLACE FUNCTION set_asset_defaults()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id, id INTO NEW.tenant_id, NEW.created_by
  FROM profiles WHERE id = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_set_defaults
BEFORE INSERT ON assets
FOR EACH ROW
EXECUTE FUNCTION set_asset_defaults();

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION set_asset_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assets_set_updated_at
BEFORE UPDATE ON assets
FOR EACH ROW
EXECUTE FUNCTION set_asset_updated_at();
