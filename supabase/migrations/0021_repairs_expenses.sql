-- Repair invoice expenses imported from PDF invoices.
CREATE TABLE IF NOT EXISTS public.repairs_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  invoice_number text,
  invoice_date date,
  vendor_name text,
  unit_number text,
  repair_category text,
  description text,
  labor_amount numeric,
  parts_amount numeric,
  tax_amount numeric,
  total_amount numeric,
  currency text NOT NULL DEFAULT 'USD',
  source_file_name text,
  raw_text_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repairs_expenses_tenant_id ON public.repairs_expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_repairs_expenses_invoice_date ON public.repairs_expenses (invoice_date);
CREATE INDEX IF NOT EXISTS idx_repairs_expenses_unit_number ON public.repairs_expenses (unit_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expenses_tenant_invoice_unique
ON public.repairs_expenses (tenant_id, (btrim(invoice_number)))
WHERE invoice_number IS NOT NULL
  AND btrim(invoice_number) <> '';

ALTER TABLE public.repairs_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repairs_expenses_tenant_read" ON public.repairs_expenses;
DROP POLICY IF EXISTS "repairs_expenses_tenant_write" ON public.repairs_expenses;

CREATE POLICY "repairs_expenses_tenant_read" ON public.repairs_expenses
  FOR SELECT USING (true);

CREATE POLICY "repairs_expenses_tenant_write" ON public.repairs_expenses
  FOR ALL USING (true);
