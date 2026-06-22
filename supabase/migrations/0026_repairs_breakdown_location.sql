ALTER TABLE public.repairs_expense_headers
  ADD COLUMN IF NOT EXISTS breakdown_location text;