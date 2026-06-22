-- Store parsed line items extracted from repair invoice PDFs.
ALTER TABLE public.repairs_expenses
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb;
