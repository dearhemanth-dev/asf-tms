ALTER TABLE public.repairs_expense_headers
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric,
  ADD COLUMN IF NOT EXISTS discount_amount numeric;
