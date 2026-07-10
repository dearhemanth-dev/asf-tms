-- Replace strict per-tenant transaction number uniqueness with a safer composite key.
-- This allows legitimate reused transaction numbers across different dates/invoices,
-- while still preventing exact re-import duplicates.

DROP INDEX IF EXISTS public.idx_fuel_expenses_tenant_transaction_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_expenses_tenant_transaction_composite_unique
ON public.fuel_expenses (
  tenant_id,
  (btrim(transaction_number)),
  transaction_date,
  (coalesce(nullif(btrim(truck_stop_invoice_number), ''), '__NONE__'))
)
WHERE transaction_number IS NOT NULL
  AND btrim(transaction_number) <> ''
  AND transaction_date IS NOT NULL;
