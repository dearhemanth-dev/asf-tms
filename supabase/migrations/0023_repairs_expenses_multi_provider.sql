-- Make repairs expenses provider-aware and dedupe by tenant+provider+invoice.
ALTER TABLE public.repairs_expenses
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT 'Unknown',
  ADD COLUMN IF NOT EXISTS provider_type text,
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS source_document_hash text;

-- Backfill provider_name from vendor_name where available.
UPDATE public.repairs_expenses
SET provider_name = COALESCE(NULLIF(btrim(vendor_name), ''), 'Unknown')
WHERE provider_name IS NULL
   OR btrim(provider_name) = ''
   OR provider_name = 'Unknown';

DROP INDEX IF EXISTS idx_repairs_expenses_tenant_invoice_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expenses_tenant_provider_invoice_unique
ON public.repairs_expenses (
  tenant_id,
  lower(btrim(provider_name)),
  btrim(invoice_number)
)
WHERE invoice_number IS NOT NULL
  AND btrim(invoice_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expenses_tenant_provider_doc_hash_unique
ON public.repairs_expenses (
  tenant_id,
  lower(btrim(provider_name)),
  btrim(source_document_hash)
)
WHERE source_document_hash IS NOT NULL
  AND btrim(source_document_hash) <> '';

CREATE INDEX IF NOT EXISTS idx_repairs_expenses_provider_name
ON public.repairs_expenses (tenant_id, provider_name);