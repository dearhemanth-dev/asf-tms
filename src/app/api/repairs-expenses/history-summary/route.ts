import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type RepairsHistoryRequest = {
  units?: unknown;
  vins?: unknown;
  asOfDate?: unknown;
};

type RepairExpenseHeaderRow = {
  id: string | null;
  unit_number: string | null;
  vin: string | null;
  invoice_date: string | null;
  payment_due_date: string | null;
  total_amount: string | number | null;
};

type RepairWindowRollup = {
  cost7: number;
  cost30: number;
  cost60: number;
  invoiceCount7: number;
  invoiceCount30: number;
  invoiceCount60: number;
  lastRepairDate: string | null;
};

const MAX_LOOKUPS_PER_TYPE = 150;
const MAX_QUERY_ROWS = 5000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDateOnly(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function subtractDays(dateOnly: string, days: number): string {
  const anchor = new Date(`${dateOnly}T00:00:00`);
  anchor.setDate(anchor.getDate() - Math.max(0, days - 1));
  return formatDateOnly(anchor);
}

function normalizeUnit(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function normalizeVin(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function toNormalizedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim();
    if (!normalized) continue;
    seen.add(normalized);
  }

  return Array.from(seen).slice(0, MAX_LOOKUPS_PER_TYPE);
}

function latestRowDate(row: RepairExpenseHeaderRow): string | null {
  const invoiceDate = parseDateOnly(row.invoice_date);
  const dueDate = parseDateOnly(row.payment_due_date);
  if (invoiceDate && dueDate) return invoiceDate > dueDate ? invoiceDate : dueDate;
  return invoiceDate ?? dueDate;
}

function createEmptyRollup(): RepairWindowRollup {
  return {
    cost7: 0,
    cost30: 0,
    cost60: 0,
    invoiceCount7: 0,
    invoiceCount30: 0,
    invoiceCount60: 0,
    lastRepairDate: null,
  };
}

function accumulateRow(
  map: Map<string, RepairWindowRollup>,
  key: string,
  amount: number,
  rowDate: string,
  windows: { start7: string; start30: string; start60: string }
) {
  if (!key) return;
  if (rowDate < windows.start60) return;

  const rollup = map.get(key) ?? createEmptyRollup();

  if (rowDate >= windows.start60) {
    rollup.cost60 += amount;
    rollup.invoiceCount60 += 1;
  }

  if (rowDate >= windows.start30) {
    rollup.cost30 += amount;
    rollup.invoiceCount30 += 1;
  }

  if (rowDate >= windows.start7) {
    rollup.cost7 += amount;
    rollup.invoiceCount7 += 1;
  }

  if (!rollup.lastRepairDate || rowDate > rollup.lastRepairDate) {
    rollup.lastRepairDate = rowDate;
  }

  map.set(key, rollup);
}

function finalizeRollups(map: Map<string, RepairWindowRollup>): Record<string, RepairWindowRollup> {
  const output: Record<string, RepairWindowRollup> = {};
  for (const [key, rollup] of map.entries()) {
    output[key] = {
      ...rollup,
      cost7: Number(rollup.cost7.toFixed(2)),
      cost30: Number(rollup.cost30.toFixed(2)),
      cost60: Number(rollup.cost60.toFixed(2)),
    };
  }
  return output;
}

export async function POST(request: Request) {
  const appUser = await getAppSessionUser(request);
  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await getSupabaseServerClient();
  const body = asRecord((await request.json().catch(() => ({}))) as RepairsHistoryRequest) ?? {};

  const requestedUnits = toNormalizedStringList(body.units).map((value) => normalizeUnit(value)).filter(Boolean);
  const requestedVins = toNormalizedStringList(body.vins).map((value) => normalizeVin(value)).filter((vin) => vin.length >= 8);
  const asOfDate = parseDateOnly(typeof body.asOfDate === "string" ? body.asOfDate : null) ?? formatDateOnly(new Date());

  if (requestedUnits.length === 0 && requestedVins.length === 0) {
    return NextResponse.json({ asOfDate, byUnit: {}, byVin: {} });
  }

  const windows = {
    start7: subtractDays(asOfDate, 7),
    start30: subtractDays(asOfDate, 30),
    start60: subtractDays(asOfDate, 60),
  };

  const unitQuery =
    requestedUnits.length > 0
      ? supabase
          .from("repairs_expense_headers")
          .select("id,unit_number,vin,invoice_date,payment_due_date,total_amount")
          .eq("tenant_id", appUser.tenantId)
          .in("unit_number", requestedUnits)
          .limit(MAX_QUERY_ROWS)
      : Promise.resolve({ data: [] as RepairExpenseHeaderRow[], error: null });

  const vinQuery =
    requestedVins.length > 0
      ? supabase
          .from("repairs_expense_headers")
          .select("id,unit_number,vin,invoice_date,payment_due_date,total_amount")
          .eq("tenant_id", appUser.tenantId)
          .in("vin", requestedVins)
          .limit(MAX_QUERY_ROWS)
      : Promise.resolve({ data: [] as RepairExpenseHeaderRow[], error: null });

  const [unitResult, vinResult] = await Promise.all([unitQuery, vinQuery]);

  if (unitResult.error) {
    return NextResponse.json({ error: unitResult.error.message }, { status: 500 });
  }

  if (vinResult.error) {
    return NextResponse.json({ error: vinResult.error.message }, { status: 500 });
  }

  const rowsById = new Map<string, RepairExpenseHeaderRow>();
  for (const row of ((unitResult.data ?? []) as RepairExpenseHeaderRow[]).concat((vinResult.data ?? []) as RepairExpenseHeaderRow[])) {
    const rowId = String(row.id ?? "").trim();
    if (rowId) {
      rowsById.set(rowId, row);
      continue;
    }

    const fallbackKey = [row.unit_number ?? "", row.vin ?? "", row.invoice_date ?? "", row.payment_due_date ?? "", row.total_amount ?? ""]
      .map((part) => String(part))
      .join("|");
    rowsById.set(fallbackKey, row);
  }

  const unitRollups = new Map<string, RepairWindowRollup>();
  const vinRollups = new Map<string, RepairWindowRollup>();

  for (const row of rowsById.values()) {
    const rowDate = latestRowDate(row);
    if (!rowDate || rowDate > asOfDate) continue;

    const amount = asNumber(row.total_amount);
    const unit = normalizeUnit(row.unit_number);
    const vin = normalizeVin(row.vin);

    accumulateRow(unitRollups, unit, amount, rowDate, windows);
    accumulateRow(vinRollups, vin, amount, rowDate, windows);
  }

  return NextResponse.json({
    asOfDate,
    windows,
    byUnit: finalizeRollups(unitRollups),
    byVin: finalizeRollups(vinRollups),
  });
}
