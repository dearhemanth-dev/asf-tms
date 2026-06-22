-- Normalize repairs invoices into header + line item tables.
CREATE TABLE IF NOT EXISTS public.repairs_expense_headers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  legacy_expense_id uuid UNIQUE,
  provider_name text NOT NULL DEFAULT 'Unknown',
  provider_state text,
  provider_country text,
  provider_type text,
  provider_account_id text,
  source_document_hash text,
  invoice_number text,
  invoice_date date,
  payment_due_date date,
  po_so_number text,
  bill_to_company text,
  vendor_name text,
  unit_number text,
  vin text,
  breakdown_number text,
  breakdown_time text,
  repair_category text,
  notes text,
  description text,
  labor_amount numeric,
  parts_amount numeric,
  tax_amount numeric,
  invoice_total numeric,
  amount_due numeric,
  total_amount numeric,
  currency text NOT NULL DEFAULT 'USD',
  source_file_name text,
  raw_text_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.repairs_expense_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  header_id uuid NOT NULL REFERENCES public.repairs_expense_headers (id) ON DELETE CASCADE,
  line_no integer,
  description text NOT NULL,
  quantity numeric,
  unit_price numeric,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repairs_expense_headers_tenant_date
ON public.repairs_expense_headers (tenant_id, invoice_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_repairs_expense_headers_tenant_unit
ON public.repairs_expense_headers (tenant_id, unit_number);

CREATE INDEX IF NOT EXISTS idx_repairs_expense_headers_provider
ON public.repairs_expense_headers (tenant_id, provider_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expense_headers_tenant_provider_invoice_unique
ON public.repairs_expense_headers (
  tenant_id,
  lower(btrim(provider_name)),
  btrim(invoice_number)
)
WHERE invoice_number IS NOT NULL
  AND btrim(invoice_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expense_headers_tenant_provider_doc_hash_unique
ON public.repairs_expense_headers (
  tenant_id,
  lower(btrim(provider_name)),
  btrim(source_document_hash)
)
WHERE source_document_hash IS NOT NULL
  AND btrim(source_document_hash) <> '';

CREATE INDEX IF NOT EXISTS idx_repairs_expense_line_items_tenant_header
ON public.repairs_expense_line_items (tenant_id, header_id, line_no);

ALTER TABLE public.repairs_expense_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repairs_expense_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repairs_expense_headers_tenant_read" ON public.repairs_expense_headers;
DROP POLICY IF EXISTS "repairs_expense_headers_tenant_write" ON public.repairs_expense_headers;
DROP POLICY IF EXISTS "repairs_expense_line_items_tenant_read" ON public.repairs_expense_line_items;
DROP POLICY IF EXISTS "repairs_expense_line_items_tenant_write" ON public.repairs_expense_line_items;

CREATE POLICY "repairs_expense_headers_tenant_read" ON public.repairs_expense_headers
  FOR SELECT USING (true);

CREATE POLICY "repairs_expense_headers_tenant_write" ON public.repairs_expense_headers
  FOR ALL USING (true);

CREATE POLICY "repairs_expense_line_items_tenant_read" ON public.repairs_expense_line_items
  FOR SELECT USING (true);

CREATE POLICY "repairs_expense_line_items_tenant_write" ON public.repairs_expense_line_items
  FOR ALL USING (true);

-- Backfill headers from legacy repairs_expenses table if present.
INSERT INTO public.repairs_expense_headers (
  legacy_expense_id,
  tenant_id,
  provider_name,
  provider_state,
  provider_country,
  provider_type,
  provider_account_id,
  source_document_hash,
  invoice_number,
  invoice_date,
  payment_due_date,
  po_so_number,
  bill_to_company,
  vendor_name,
  unit_number,
  vin,
  repair_category,
  notes,
  description,
  labor_amount,
  parts_amount,
  tax_amount,
  invoice_total,
  amount_due,
  total_amount,
  currency,
  source_file_name,
  raw_text_excerpt,
  created_at
)
SELECT
  re.id,
  re.tenant_id,
  COALESCE(NULLIF(btrim(re.provider_name), ''), 'Unknown'),
  re.provider_state,
  re.provider_country,
  re.provider_type,
  re.provider_account_id,
  re.source_document_hash,
  re.invoice_number,
  re.invoice_date,
  re.payment_due_date,
  re.po_so_number,
  re.bill_to_company,
  re.vendor_name,
  re.unit_number,
  re.vin,
  re.repair_category,
  re.notes,
  re.description,
  re.labor_amount,
  re.parts_amount,
  re.tax_amount,
  re.invoice_total,
  re.amount_due,
  re.total_amount,
  COALESCE(NULLIF(btrim(re.currency), ''), 'USD'),
  re.source_file_name,
  re.raw_text_excerpt,
  re.created_at
FROM public.repairs_expenses re
LEFT JOIN public.repairs_expense_headers h
  ON h.legacy_expense_id = re.id
WHERE h.id IS NULL;

-- Backfill line items from legacy jsonb array.
INSERT INTO public.repairs_expense_line_items (
  tenant_id,
  header_id,
  line_no,
  description,
  quantity,
  unit_price,
  amount
)
SELECT
  h.tenant_id,
  h.id,
  j.ordinality::integer,
  left(btrim(COALESCE(j.item ->> 'description', '')), 200),
  CASE
    WHEN COALESCE(j.item ->> 'quantity', '') ~ '^-?\\d+(\\.\\d+)?$' THEN (j.item ->> 'quantity')::numeric
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(j.item ->> 'unit_price', '') ~ '^-?\\d+(\\.\\d+)?$' THEN (j.item ->> 'unit_price')::numeric
    ELSE NULL
  END,
  (j.item ->> 'amount')::numeric
FROM public.repairs_expenses re
JOIN public.repairs_expense_headers h
  ON h.legacy_expense_id = re.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(re.line_items, '[]'::jsonb)) WITH ORDINALITY AS j(item, ordinality)
WHERE btrim(COALESCE(j.item ->> 'description', '')) <> ''
  AND COALESCE(j.item ->> 'amount', '') ~ '^-?\\d+(\\.\\d+)?$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.repairs_expense_line_items li
    WHERE li.header_id = h.id
      AND li.line_no = j.ordinality::integer
  );