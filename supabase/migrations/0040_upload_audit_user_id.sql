-- Record the user who uploaded imported records.

ALTER TABLE public.repairs_expense_headers
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid;

ALTER TABLE public.repairs_expense_line_items
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid;

ALTER TABLE public.fuel_expenses
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_repairs_expense_headers_uploaded_by_user_id
ON public.repairs_expense_headers (uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_repairs_expense_line_items_uploaded_by_user_id
ON public.repairs_expense_line_items (uploaded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_fuel_expenses_uploaded_by_user_id
ON public.fuel_expenses (uploaded_by_user_id);