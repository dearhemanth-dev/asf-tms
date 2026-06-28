import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type FuelExpenseRow = {
  unit_number: string | null;
  transaction_date: string | null;
  transaction_time: string | null;
  transaction_number: string | null;
  driver_name: string | null;
  truck_stop_name: string | null;
  truck_stop_city: string | null;
  truck_stop_state: string | null;
  total_amount_due: string | number | null;
  cash_advance_amount: string | number | null;
  diesel_gallons: string | number | null;
  diesel_price_per_gallon: string | number | null;
  diesel_cost: string | number | null;
  def_gallons: string | number | null;
  def_price_per_gallon: string | number | null;
  def_cost: string | number | null;
  reefer_gallons: string | number | null;
  reefer_price_per_gallon: string | number | null;
  reefer_fuel_cost: string | number | null;
};

type FuelTransactionLine = {
  id: string;
  transaction_number: string;
  transaction_date: string | null;
  transaction_time: string | null;
  driver_name: string | null;
  truck_stop_name: string | null;
  truck_stop_city: string | null;
  truck_stop_state: string | null;
  type: "Cash Advance" | "Diesel" | "DEF" | "Reefer" | "Other";
  price_per_gallon: number | null;
  gallons: number | null;
  total: number;
};

type FuelTypeSummary = {
  type: FuelTransactionLine["type"];
  total: number;
  transaction_count: number;
};

type FuelReportPeriod = "weekly" | "monthly";

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeUnit(rawUnit: string | null) {
  return (rawUnit ?? "UNASSIGNED").trim() || "UNASSIGNED";
}

function toFuelLines(row: FuelExpenseRow): FuelTransactionLine[] {
  const transactionNumber = (row.transaction_number ?? "").trim() || "N/A";
  const driverName = row.driver_name?.trim() || null;
  const truckStopName = row.truck_stop_name?.trim() || null;
  const truckStopCity = row.truck_stop_city?.trim() || null;
  const truckStopState = row.truck_stop_state?.trim() || null;
  const baseId = `${transactionNumber}-${row.transaction_date ?? "na"}-${row.transaction_time ?? "na"}`;
  const lines: FuelTransactionLine[] = [];

  const cashAdvance = asNumber(row.cash_advance_amount);
  const dieselGallons = asNumber(row.diesel_gallons);
  const dieselPpg = asNumber(row.diesel_price_per_gallon);
  const dieselCost = asNumber(row.diesel_cost);
  const defGallons = asNumber(row.def_gallons);
  const defPpg = asNumber(row.def_price_per_gallon);
  const defCost = asNumber(row.def_cost);
  const reeferGallons = asNumber(row.reefer_gallons);
  const reeferPpg = asNumber(row.reefer_price_per_gallon);
  const reeferCost = asNumber(row.reefer_fuel_cost);

  if (cashAdvance > 0) {
    lines.push({
      id: `${baseId}-cash`,
      transaction_number: transactionNumber,
      transaction_date: row.transaction_date,
      transaction_time: row.transaction_time,
      driver_name: driverName,
      truck_stop_name: truckStopName,
      truck_stop_city: truckStopCity,
      truck_stop_state: truckStopState,
      type: "Cash Advance",
      price_per_gallon: null,
      gallons: null,
      total: cashAdvance,
    });
  }

  if (dieselCost > 0 || dieselGallons > 0) {
    lines.push({
      id: `${baseId}-diesel`,
      transaction_number: transactionNumber,
      transaction_date: row.transaction_date,
      transaction_time: row.transaction_time,
      driver_name: driverName,
      truck_stop_name: truckStopName,
      truck_stop_city: truckStopCity,
      truck_stop_state: truckStopState,
      type: "Diesel",
      price_per_gallon: dieselPpg > 0 ? dieselPpg : null,
      gallons: dieselGallons > 0 ? dieselGallons : null,
      total: dieselCost,
    });
  }

  if (defCost > 0 || defGallons > 0) {
    lines.push({
      id: `${baseId}-def`,
      transaction_number: transactionNumber,
      transaction_date: row.transaction_date,
      transaction_time: row.transaction_time,
      driver_name: driverName,
      truck_stop_name: truckStopName,
      truck_stop_city: truckStopCity,
      truck_stop_state: truckStopState,
      type: "DEF",
      price_per_gallon: defPpg > 0 ? defPpg : null,
      gallons: defGallons > 0 ? defGallons : null,
      total: defCost,
    });
  }

  if (reeferCost > 0 || reeferGallons > 0) {
    lines.push({
      id: `${baseId}-reefer`,
      transaction_number: transactionNumber,
      transaction_date: row.transaction_date,
      transaction_time: row.transaction_time,
      driver_name: driverName,
      truck_stop_name: truckStopName,
      truck_stop_city: truckStopCity,
      truck_stop_state: truckStopState,
      type: "Reefer",
      price_per_gallon: reeferPpg > 0 ? reeferPpg : null,
      gallons: reeferGallons > 0 ? reeferGallons : null,
      total: reeferCost,
    });
  }

  if (lines.length === 0) {
    lines.push({
      id: `${baseId}-other`,
      transaction_number: transactionNumber,
      transaction_date: row.transaction_date,
      transaction_time: row.transaction_time,
      driver_name: driverName,
      truck_stop_name: truckStopName,
      truck_stop_city: truckStopCity,
      truck_stop_state: truckStopState,
      type: "Other",
      price_per_gallon: null,
      gallons: null,
      total: asNumber(row.total_amount_due),
    });
  }

  return lines;
}

function parsePeriod(rawPeriod: string | null): FuelReportPeriod {
  if (rawPeriod === "weekly") return "weekly";
  return "monthly";
}

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOnly(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function periodStartDate(period: FuelReportPeriod, endDate: Date): string {
  const daysBack = period === "weekly" ? 6 : 29;
  const start = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - daysBack);
  return formatDateOnly(start);
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedUnit = searchParams.get("unit")?.trim();
  const period = parsePeriod(searchParams.get("period"));
  const requestedFrom = parseDateOnly(searchParams.get("from"));
  const requestedTo = parseDateOnly(searchParams.get("to"));

  const today = new Date();
  const fallbackEndDate = formatDateOnly(today);
  let startDate = requestedFrom;
  let endDate = requestedTo ?? fallbackEndDate;

  if (!startDate) {
    startDate = periodStartDate(period, today);
  }

  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  if (requestedUnit) {
    const { data, error } = await supabase
      .from("fuel_expenses")
      .select("unit_number,transaction_date,transaction_time,transaction_number,driver_name,truck_stop_name,truck_stop_city,truck_stop_state,total_amount_due,cash_advance_amount,diesel_gallons,diesel_price_per_gallon,diesel_cost,def_gallons,def_price_per_gallon,def_cost,reefer_gallons,reefer_price_per_gallon,reefer_fuel_cost")
      .eq("tenant_id", appUser.tenantId)
      .eq("unit_number", requestedUnit)
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate)
      .order("transaction_date", { ascending: false })
      .order("transaction_time", { ascending: false })
      .limit(2000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const expenseRows = (data ?? []) as FuelExpenseRow[];
    const transactions = expenseRows
      .flatMap((row) => toFuelLines(row))
      .sort((a, b) => {
        const aDate = `${a.transaction_date ?? ""} ${a.transaction_time ?? ""}`;
        const bDate = `${b.transaction_date ?? ""} ${b.transaction_time ?? ""}`;
        return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
      });

    const byTypeMap = new Map<FuelTransactionLine["type"], FuelTypeSummary>();
    const transactionsByType = {
      "Cash Advance": [] as FuelTransactionLine[],
      Diesel: [] as FuelTransactionLine[],
      DEF: [] as FuelTransactionLine[],
      Reefer: [] as FuelTransactionLine[],
      Other: [] as FuelTransactionLine[],
    };

    for (const transaction of transactions) {
      transactionsByType[transaction.type].push(transaction);
      const existing = byTypeMap.get(transaction.type);
      if (existing) {
        existing.total += transaction.total;
        existing.transaction_count += 1;
      } else {
        byTypeMap.set(transaction.type, {
          type: transaction.type,
          total: transaction.total,
          transaction_count: 1,
        });
      }
    }

    const byType = Array.from(byTypeMap.values())
      .map((row) => ({
        ...row,
        total: Number(row.total.toFixed(4)),
      }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      unit: requestedUnit,
      period,
      startDate,
      endDate,
      byType,
      transactionsByType,
      transactions,
      count: transactions.length,
    });
  }

  const batchSize = 1000;
  let from = 0;
  let hasMore = true;

  const unitTotals = new Map<string, { unit_number: string; total_fuel_cost: number; row_count: number }>();

  while (hasMore) {
    const to = from + batchSize - 1;
    const { data, error } = await supabase
      .from("fuel_expenses")
      .select("unit_number,diesel_cost,def_cost,reefer_fuel_cost")
      .eq("tenant_id", appUser.tenantId)
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate)
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as FuelExpenseRow[];
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      const unit = normalizeUnit(row.unit_number);
      const fuelCost = asNumber(row.diesel_cost) + asNumber(row.def_cost) + asNumber(row.reefer_fuel_cost);

      const existing = unitTotals.get(unit);
      if (existing) {
        existing.total_fuel_cost += fuelCost;
        existing.row_count += 1;
      } else {
        unitTotals.set(unit, {
          unit_number: unit,
          total_fuel_cost: fuelCost,
          row_count: 1,
        });
      }
    }

    hasMore = rows.length === batchSize;
    from += batchSize;
  }

  const summary = Array.from(unitTotals.values())
    .sort((a, b) => b.total_fuel_cost - a.total_fuel_cost)
    .map((row) => ({
      ...row,
      total_fuel_cost: Number(row.total_fuel_cost.toFixed(4)),
    }));

  return NextResponse.json({ byUnit: summary, totalUnits: summary.length, period, startDate, endDate });
}
