import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type RepairExpenseHeaderRow = {
  id: string | null;
  unit_number: string | null;
  vin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_due_date: string | null;
  vendor_name: string | null;
  repair_category: string | null;
  total_amount: string | number | null;
  notes: string | null;
  description: string | null;
};

type RepairExpenseLineItemRow = {
  id: string | null;
  header_id: string | null;
  line_no: number | null;
  description: string | null;
  quantity: string | number | null;
  unit_price: string | number | null;
  amount: string | number | null;
};

const MAX_QUERY_ROWS = 1000;

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

function latestRowDate(row: RepairExpenseHeaderRow): string | null {
  const invoiceDate = parseDateOnly(row.invoice_date);
  const dueDate = parseDateOnly(row.payment_due_date);
  if (invoiceDate && dueDate) return invoiceDate > dueDate ? invoiceDate : dueDate;
  return invoiceDate ?? dueDate;
}

function classifyLineType(description: string): "parts" | "labor" | "tax" | "fees" | "other" {
  const blob = description.toLowerCase();
  if (blob.includes("labor") || blob.includes("labour") || blob.includes("shop time") || blob.includes("diagnostic")) return "labor";
  if (blob.includes("tax") || blob.includes("vat")) return "tax";
  if (blob.includes("fee") || blob.includes("charge") || blob.includes("surcharge") || blob.includes("shipping")) return "fees";
  if (
    blob.includes("part") ||
    blob.includes("filter") ||
    blob.includes("sensor") ||
    blob.includes("hose") ||
    blob.includes("belt") ||
    blob.includes("brake") ||
    blob.includes("oil") ||
    blob.includes("coolant")
  ) {
    return "parts";
  }
  return "other";
}

export async function GET(request: Request) {
  const appUser = await getAppSessionUser(request);
  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const unit = normalizeUnit(searchParams.get("unit"));
  const vin = normalizeVin(searchParams.get("vin"));
  const daysRaw = Number.parseInt(searchParams.get("days") ?? "60", 10);
  const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(daysRaw, 365)) : 60;

  if (!unit && !vin) {
    return NextResponse.json({ error: "unit or vin is required" }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const unitQuery =
    unit.length > 0
      ? supabase
          .from("repairs_expense_headers")
          .select("id,unit_number,vin,invoice_number,invoice_date,payment_due_date,vendor_name,repair_category,total_amount,notes,description")
          .eq("tenant_id", appUser.tenantId)
          .eq("unit_number", unit)
          .limit(MAX_QUERY_ROWS)
      : Promise.resolve({ data: [] as RepairExpenseHeaderRow[], error: null });

  const vinQuery =
    vin.length >= 8
      ? supabase
          .from("repairs_expense_headers")
          .select("id,unit_number,vin,invoice_number,invoice_date,payment_due_date,vendor_name,repair_category,total_amount,notes,description")
          .eq("tenant_id", appUser.tenantId)
          .eq("vin", vin)
          .limit(MAX_QUERY_ROWS)
      : Promise.resolve({ data: [] as RepairExpenseHeaderRow[], error: null });

  const [unitResult, vinResult] = await Promise.all([unitQuery, vinQuery]);
  if (unitResult.error) {
    return NextResponse.json({ error: unitResult.error.message }, { status: 500 });
  }
  if (vinResult.error) {
    return NextResponse.json({ error: vinResult.error.message }, { status: 500 });
  }

  const today = formatDateOnly(new Date());
  const startDate = subtractDays(today, days);

  const merged = new Map<string, RepairExpenseHeaderRow>();
  for (const row of ((unitResult.data ?? []) as RepairExpenseHeaderRow[]).concat((vinResult.data ?? []) as RepairExpenseHeaderRow[])) {
    const key = String(row.id ?? `${row.invoice_number ?? "NA"}|${row.invoice_date ?? "NA"}|${row.total_amount ?? "NA"}`);
    merged.set(key, row);
  }

  const rows = Array.from(merged.values())
    .map((row, index) => {
      const effectiveDate = latestRowDate(row);
      if (!effectiveDate) return null;
      if (effectiveDate < startDate || effectiveDate > today) return null;

      return {
        id: String(row.id ?? `${row.invoice_number ?? "NA"}-${effectiveDate}-${index}`),
        source_header_id: row.id ? String(row.id) : null,
        unit_number: normalizeUnit(row.unit_number),
        vin: normalizeVin(row.vin),
        invoice_number: (row.invoice_number ?? "N/A").trim() || "N/A",
        invoice_date: row.invoice_date,
        payment_due_date: row.payment_due_date,
        effective_date: effectiveDate,
        vendor_name: (row.vendor_name ?? "Unknown vendor").trim() || "Unknown vendor",
        repair_category: (row.repair_category ?? "Uncategorized").trim() || "Uncategorized",
        total_amount: Number(asNumber(row.total_amount).toFixed(2)),
        notes_text: (row.notes ?? row.description ?? "").trim(),
        line_items: [] as Array<{
          id: string;
          line_no: number | null;
          line_type: "parts" | "labor" | "tax" | "fees" | "summary" | "other";
          description: string;
          quantity: string | null;
          unit_price: string | null;
          amount: number;
        }>,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => {
      if (a.effective_date === b.effective_date) {
        return b.total_amount - a.total_amount;
      }
      return b.effective_date.localeCompare(a.effective_date);
    });

  const headerIds = rows
    .map((row) => row.source_header_id)
    .filter((id): id is string => Boolean(id));
  if (headerIds.length > 0) {
    const { data: lineItemData, error: lineItemError } = await supabase
      .from("repairs_expense_line_items")
      .select("id,header_id,line_no,description,quantity,unit_price,amount")
      .eq("tenant_id", appUser.tenantId)
      .in("header_id", headerIds)
      .order("line_no", { ascending: true })
      .limit(MAX_QUERY_ROWS * 5);

    if (!lineItemError) {
      const lineItemsByHeader = new Map<string, RepairExpenseLineItemRow[]>();
      for (const item of (lineItemData ?? []) as RepairExpenseLineItemRow[]) {
        const headerId = String(item.header_id ?? "").trim();
        if (!headerId) continue;
        const bucket = lineItemsByHeader.get(headerId) ?? [];
        bucket.push(item);
        lineItemsByHeader.set(headerId, bucket);
      }

      for (const row of rows) {
        const headerId = row.source_header_id;
        if (!headerId) continue;
        const lineItems = lineItemsByHeader.get(headerId) ?? [];
        row.line_items = lineItems.map((item, index) => {
          const description = (item.description ?? "Line item").trim() || "Line item";
          return {
            id: String(item.id ?? `${row.id}-line-${index}`),
            line_no: typeof item.line_no === "number" ? item.line_no : null,
            line_type: classifyLineType(description),
            description,
            quantity: item.quantity === null || item.quantity === undefined ? null : String(item.quantity),
            unit_price: item.unit_price === null || item.unit_price === undefined ? null : String(item.unit_price),
            amount: Number(asNumber(item.amount).toFixed(2)),
          };
        });
      }
    }
  }

  const responseRows = rows.map(({ source_header_id: _sourceHeaderId, ...rest }) => rest);
  return NextResponse.json({ unit: unit || null, vin: vin || null, days, startDate, endDate: today, rows: responseRows });
}
