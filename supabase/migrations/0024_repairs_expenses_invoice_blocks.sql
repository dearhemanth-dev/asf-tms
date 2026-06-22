-- Capture invoice blocks explicitly for structured repairs parsing.
ALTER TABLE public.repairs_expenses
  ADD COLUMN IF NOT EXISTS provider_state text,
  ADD COLUMN IF NOT EXISTS provider_country text,
  ADD COLUMN IF NOT EXISTS bill_to_company text,
  ADD COLUMN IF NOT EXISTS po_so_number text,
  ADD COLUMN IF NOT EXISTS payment_due_date date,
  ADD COLUMN IF NOT EXISTS invoice_total numeric,
  ADD COLUMN IF NOT EXISTS amount_due numeric,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS vin text;

-- Backfill notes from description when notes are missing.
UPDATE public.repairs_expenses
SET notes = description
WHERE (notes IS NULL OR btrim(notes) = '')
  AND description IS NOT NULL
  AND btrim(description) <> '';

-- Backfill amount_due/invoice_total from total_amount where possible.
UPDATE public.repairs_expenses
SET amount_due = total_amount
WHERE amount_due IS NULL
  AND total_amount IS NOT NULL;

UPDATE public.repairs_expenses
SET invoice_total = total_amount
WHERE invoice_total IS NULL
  AND total_amount IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repairs_expenses_po_so_number
ON public.repairs_expenses (tenant_id, po_so_number);

CREATE INDEX IF NOT EXISTS idx_repairs_expenses_vin
ON public.repairs_expenses (tenant_id, vin);