-- Comdata fuel expense records imported from Excel
CREATE TABLE IF NOT EXISTS public.fuel_expenses (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id               text,
  transaction_date          date,
  transaction_time          text,
  transaction_number        text,
  comchek_card_number       text,
  driver_name               text,
  unit_number               text,
  truck_stop_code           text,
  service_center_chain_code text,
  truck_stop_name           text,
  truck_stop_city           text,
  truck_stop_state          text,
  truck_stop_invoice_number text,
  total_amount_due          numeric(14, 4),
  fees_fuel_oil_products    numeric(14, 4),
  diesel_gallons            numeric(14, 4),
  diesel_price_per_gallon   numeric(14, 6),
  diesel_cost               numeric(14, 4),
  def_gallons               numeric(14, 4),
  def_price_per_gallon      numeric(14, 6),
  def_cost                  numeric(14, 4),
  reefer_gallons            numeric(14, 4),
  reefer_price_per_gallon   numeric(14, 6),
  reefer_fuel_cost          numeric(14, 4),
  quarts_of_oil             numeric(14, 4),
  total_oil_cost            numeric(14, 4),
  additional_product_amount numeric(14, 4),
  cash_advance_amount       numeric(14, 4),
  cash_advance_charges      numeric(14, 4),
  rebate_amount             numeric(14, 4),
  total_amount_due_comdata  numeric(14, 4),
  date_of_original          date,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_expenses_tenant_id         ON public.fuel_expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fuel_expenses_transaction_date  ON public.fuel_expenses (transaction_date);
CREATE INDEX IF NOT EXISTS idx_fuel_expenses_unit_number       ON public.fuel_expenses (unit_number);
CREATE INDEX IF NOT EXISTS idx_fuel_expenses_transaction_number ON public.fuel_expenses (transaction_number);

ALTER TABLE public.fuel_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_expenses_tenant_read"  ON public.fuel_expenses;
DROP POLICY IF EXISTS "fuel_expenses_tenant_write" ON public.fuel_expenses;

CREATE POLICY "fuel_expenses_tenant_read" ON public.fuel_expenses
  FOR SELECT USING (true);

CREATE POLICY "fuel_expenses_tenant_write" ON public.fuel_expenses
  FOR ALL USING (true);
