-- Preserve imported decimal precision by removing fixed numeric scales.
-- This prevents values from being padded/rounded to fixed decimal places.

ALTER TABLE public.fuel_expenses
  ALTER COLUMN total_amount_due TYPE numeric,
  ALTER COLUMN fees_fuel_oil_products TYPE numeric,
  ALTER COLUMN diesel_gallons TYPE numeric,
  ALTER COLUMN diesel_price_per_gallon TYPE numeric,
  ALTER COLUMN diesel_cost TYPE numeric,
  ALTER COLUMN def_gallons TYPE numeric,
  ALTER COLUMN def_price_per_gallon TYPE numeric,
  ALTER COLUMN def_cost TYPE numeric,
  ALTER COLUMN reefer_gallons TYPE numeric,
  ALTER COLUMN reefer_price_per_gallon TYPE numeric,
  ALTER COLUMN reefer_fuel_cost TYPE numeric,
  ALTER COLUMN quarts_of_oil TYPE numeric,
  ALTER COLUMN total_oil_cost TYPE numeric,
  ALTER COLUMN additional_product_amount TYPE numeric,
  ALTER COLUMN cash_advance_amount TYPE numeric,
  ALTER COLUMN cash_advance_charges TYPE numeric,
  ALTER COLUMN rebate_amount TYPE numeric,
  ALTER COLUMN total_amount_due_comdata TYPE numeric;
