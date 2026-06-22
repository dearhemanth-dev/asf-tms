import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type RepairsReportPeriod = "weekly" | "monthly";

type RepairsExpenseRow = {
  unit_number: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_due_date: string | null;
  vendor_name: string | null;
  repair_category: string | null;
  total_amount: string | number | null;
};

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parsePeriod(rawPeriod: string | null): RepairsReportPeriod {
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

function periodStartDate(period: RepairsReportPeriod, endDate: Date): string {
  if (period === "weekly") {
    // Past 7 calendar days plus today.
    const start = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 7);
    return formatDateOnly(start);
  }

  // Past month window plus today (covers 30/31-day month differences).
  const start = new Date(endDate);
  start.setMonth(start.getMonth() - 1);
  start.setDate(start.getDate() - 1);
  return formatDateOnly(start);
}

function latestRowDate(row: RepairsExpenseRow) {
  const dates = [parseDateOnly(row.invoice_date), parseDateOnly(row.payment_due_date)].filter((value): value is string => Boolean(value));
  return dates.sort().at(-1) ?? null;
}

function rowIsWithinWindow(row: RepairsExpenseRow, startDate: string, endDate: string) {
  const dates = [parseDateOnly(row.invoice_date), parseDateOnly(row.payment_due_date)].filter((value): value is string => Boolean(value));
  return dates.some((date) => date >= startDate && date <= endDate);
}

function normalizeUnit(rawUnit: string | null) {
  return (rawUnit ?? "UNASSIGNED").trim() || "UNASSIGNED";
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
  const requestedToday = parseDateOnly(searchParams.get("today"));

  const today = new Date();
  let startDate = requestedFrom;
  let endDate = requestedTo ?? requestedToday ?? formatDateOnly(today);

  if (!startDate) {
    const anchorDate = new Date(`${endDate}T00:00:00`);
    startDate = periodStartDate(period, anchorDate);
  }

  if (startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  if (requestedUnit) {
    const { data, error } = await supabase
      .from("repairs_expense_headers")
      .select("unit_number,invoice_number,invoice_date,payment_due_date,vendor_name,repair_category,total_amount")
      .eq("tenant_id", appUser.tenantId)
      .eq("unit_number", requestedUnit)
      .limit(2000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const invoices = ((data ?? []) as RepairsExpenseRow[])
      .filter((row) => rowIsWithinWindow(row, startDate, endDate))
      .sort((a, b) => {
        const aDate = latestRowDate(a) ?? "";
        const bDate = latestRowDate(b) ?? "";
        return aDate.localeCompare(bDate);
      })
      .map((row, index) => ({
        id: `${row.invoice_number ?? "NA"}-${row.invoice_date ?? "NA"}-${index}`,
        unit_number: normalizeUnit(row.unit_number),
        invoice_number: row.invoice_number ?? "N/A",
        invoice_date: row.invoice_date,
        payment_due_date: row.payment_due_date,
        vendor_name: row.vendor_name,
        repair_category: row.repair_category,
        total_amount: asNumber(row.total_amount),
      }));

    return NextResponse.json({
      unit: requestedUnit,
      period,
      startDate,
      endDate,
      invoices,
      count: invoices.length,
    });
  }

  const batchSize = 1000;
  let from = 0;
  let hasMore = true;

  const unitTotals = new Map<string, { unit_number: string; total_repairs_cost: number; row_count: number; earliestInvoiceDate: string | null; assetType: string | null }>();

  while (hasMore) {
    const to = from + batchSize - 1;
    const { data, error } = await supabase
      .from("repairs_expense_headers")
      .select("unit_number,invoice_date,payment_due_date,total_amount")
      .eq("tenant_id", appUser.tenantId)
      .range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as RepairsExpenseRow[];
    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      if (!rowIsWithinWindow(row, startDate, endDate)) {
        continue;
      }

      const unit = normalizeUnit(row.unit_number);
      const amount = asNumber(row.total_amount);
      const rowDate = latestRowDate(row);

      const existing = unitTotals.get(unit);
      if (existing) {
        existing.total_repairs_cost += amount;
        existing.row_count += 1;
        if (rowDate && (!existing.earliestInvoiceDate || rowDate < existing.earliestInvoiceDate)) {
          existing.earliestInvoiceDate = rowDate;
        }
      } else {
        unitTotals.set(unit, {
          unit_number: unit,
          total_repairs_cost: amount,
          row_count: 1,
          earliestInvoiceDate: rowDate,
          assetType: null,
        });
      }
    }

    hasMore = rows.length === batchSize;
    from += batchSize;
  }

  const { data: assetData, error: assetError } = await supabase
    .from("assets")
    .select("asset_unit_number,asset_type")
    .eq("tenant_id", appUser.tenantId);

  if (!assetError && Array.isArray(assetData)) {
    for (const asset of assetData) {
      const unit = normalizeUnit(asset.asset_unit_number);
      const summary = unitTotals.get(unit);
      if (summary) {
        summary.assetType = asset.asset_type;
      }
    }
  }

  const summary = Array.from(unitTotals.values())
    .sort((a, b) => b.total_repairs_cost - a.total_repairs_cost)
    .map((row) => ({
      ...row,
      total_repairs_cost: Number(row.total_repairs_cost.toFixed(2)),
    }));

  return NextResponse.json({ byUnit: summary, totalUnits: summary.length, period, startDate, endDate });
}
