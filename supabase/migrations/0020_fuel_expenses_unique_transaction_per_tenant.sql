-- Enforce one transaction number per tenant to block duplicate fuel imports at DB level.
-- Ignore null/blank transaction numbers so legacy/invalid rows do not collide.

CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_expenses_tenant_transaction_unique
ON public.fuel_expenses (tenant_id, (btrim(transaction_number)))
WHERE transaction_number IS NOT NULL
  AND btrim(transaction_number) <> '';
