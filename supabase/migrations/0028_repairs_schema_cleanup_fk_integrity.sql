-- Cleanup and harden normalized repairs schema.
-- Goal: keep exactly two operational tables:
--   1) repairs_expense_headers
--   2) repairs_expense_line_items

-- Ensure line-item tenant_id always matches its parent header tenant_id.
UPDATE public.repairs_expense_line_items li
SET tenant_id = h.tenant_id
FROM public.repairs_expense_headers h
WHERE li.header_id = h.id
  AND li.tenant_id IS DISTINCT FROM h.tenant_id;

-- Required for composite FK target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expense_headers_tenant_id_id
ON public.repairs_expense_headers (tenant_id, id);

-- Enforce tenant-aware parent/child integrity.
ALTER TABLE public.repairs_expense_line_items
  DROP CONSTRAINT IF EXISTS repairs_expense_line_items_tenant_header_fk;

ALTER TABLE public.repairs_expense_line_items
  ADD CONSTRAINT repairs_expense_line_items_tenant_header_fk
  FOREIGN KEY (tenant_id, header_id)
  REFERENCES public.repairs_expense_headers (tenant_id, id)
  ON DELETE CASCADE;

-- Prevent duplicate line numbers per header when line_no is present.
CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_expense_line_items_header_lineno_unique
ON public.repairs_expense_line_items (header_id, line_no)
WHERE line_no IS NOT NULL;

-- Basic quality guardrails.
ALTER TABLE public.repairs_expense_line_items
  DROP CONSTRAINT IF EXISTS repairs_expense_line_items_description_not_blank;

ALTER TABLE public.repairs_expense_line_items
  ADD CONSTRAINT repairs_expense_line_items_description_not_blank
  CHECK (btrim(description) <> '');

-- Retire legacy monolithic table after confirming historical rows were backfilled.
DO $$
DECLARE
  legacy_count bigint := 0;
  backfilled_count bigint := 0;
BEGIN
  IF to_regclass('public.repairs_expenses') IS NOT NULL THEN
    SELECT COUNT(*) INTO legacy_count FROM public.repairs_expenses;
    SELECT COUNT(*) INTO backfilled_count
    FROM public.repairs_expense_headers
    WHERE legacy_expense_id IS NOT NULL;

    IF backfilled_count < legacy_count THEN
      RAISE EXCEPTION
        'Cannot drop legacy table public.repairs_expenses: only %/% rows backfilled into headers.',
        backfilled_count,
        legacy_count;
    END IF;

    DROP TABLE public.repairs_expenses;
  END IF;
END $$;
