import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ALLOWED_ROLES = ["management", "accounts"] as const;

function parseDateOnly(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeDateRange(from: string | null, to: string | null) {
  let startDate = parseDateOnly(from);
  let endDate = parseDateOnly(to);

  if (startDate && endDate && startDate > endDate) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  return { startDate, endDate };
}

type RepairLineItem = {
  line_no?: number;
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string;
};

function asTrimmedText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.slice(0, maxLength);
}

function asDecimalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[,$\s]/g, "").trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeLineItems(value: unknown): RepairLineItem[] {
  if (!Array.isArray(value)) return [];

  const items: RepairLineItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const description = asTrimmedText(item.description, 200);
    const amount = asDecimalText(item.amount);
    if (!description || !amount) continue;

    const normalized: RepairLineItem = {
      line_no: items.length + 1,
      description,
      quantity: asDecimalText(item.quantity),
      unit_price: asDecimalText(item.unit_price),
      amount,
    };

    const key = `${normalized.description}::${normalized.quantity ?? ""}::${normalized.unit_price ?? ""}::${normalized.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push(normalized);
  }

  return items.slice(0, 200);
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedUnit = searchParams.get("unit")?.trim();
  const { startDate, endDate } = normalizeDateRange(searchParams.get("from"), searchParams.get("to"));

  let headerQuery = supabase
    .from("repairs_expense_headers")
    .select("id,invoice_number,invoice_date,payment_due_date,vendor_name,unit_number,repair_category,breakdown_location,breakdown_time,discount_amount,total_amount,currency,source_file_name,created_at,notes,description")
    .eq("tenant_id", appUser.tenantId);

  if (requestedUnit) {
    headerQuery = headerQuery.eq("unit_number", requestedUnit);
  }

  if (startDate) {
    headerQuery = headerQuery.gte("invoice_date", startDate);
  }

  if (endDate) {
    headerQuery = headerQuery.lte("invoice_date", endDate);
  }

  const { data: headers, error } = await headerQuery
    .order("invoice_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(requestedUnit ? 500 : 100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headerRows = headers ?? [];
  const headerIds = headerRows.map((row) => row.id).filter(Boolean);

  let lineItemsByHeader = new Map<string, RepairLineItem[]>();
  if (headerIds.length > 0) {
    const { data: lineItems, error: lineItemsError } = await supabase
      .from("repairs_expense_line_items")
      .select("header_id,line_no,description,quantity,unit_price,amount")
      .eq("tenant_id", appUser.tenantId)
      .in("header_id", headerIds)
      .order("line_no", { ascending: true });

    if (lineItemsError) {
      return NextResponse.json({ error: lineItemsError.message }, { status: 500 });
    }

    lineItemsByHeader = (lineItems ?? []).reduce((acc, item) => {
      const headerId = String(item.header_id ?? "");
      if (!headerId) return acc;
      const list = acc.get(headerId) ?? [];
      list.push({
        line_no: typeof item.line_no === "number" ? item.line_no : undefined,
        description: String(item.description ?? ""),
        quantity: item.quantity === null || item.quantity === undefined ? null : String(item.quantity),
        unit_price: item.unit_price === null || item.unit_price === undefined ? null : String(item.unit_price),
        amount: String(item.amount ?? ""),
      });
      acc.set(headerId, list);
      return acc;
    }, new Map<string, RepairLineItem[]>());
  }

  const rows = headerRows.map((row) => ({
    ...row,
    notes_text: typeof row.notes === "string" && row.notes.trim() ? row.notes : row.description,
    line_items: lineItemsByHeader.get(String(row.id)) ?? [],
  }));

  return NextResponse.json({ rows, unit: requestedUnit ?? null, startDate, endDate });
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(appUser.role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("row" in body)) {
    return NextResponse.json({ error: "Request body must contain a row object." }, { status: 400 });
  }

  const row = (body as { row: Record<string, unknown> }).row;

  const payload = {
    tenant_id: appUser.tenantId,
    uploaded_by_user_id: appUser.id,
    breakdown_number: asTrimmedText(row.breakdown_number, 60),
    breakdown_time: asTrimmedText(row.breakdown_time, 20),
    breakdown_location: asTrimmedText(row.breakdown_location, 200),
    invoice_number: asTrimmedText(row.invoice_number, 100),
    invoice_date: asTrimmedText(row.invoice_date, 20),
    payment_due_date: asTrimmedText(row.payment_due_date, 20),
    po_so_number: asTrimmedText(row.po_so_number, 120),
    bill_to_company: asTrimmedText(row.bill_to_company, 200),
    provider_name: asTrimmedText(row.provider_name, 200) ?? asTrimmedText(row.vendor_name, 200) ?? "Unknown",
    provider_state: asTrimmedText(row.provider_state, 120),
    provider_country: asTrimmedText(row.provider_country, 120),
    provider_type: asTrimmedText(row.provider_type, 100),
    provider_account_id: asTrimmedText(row.provider_account_id, 120),
    source_document_hash: asTrimmedText(row.source_document_hash, 64),
    vendor_name: asTrimmedText(row.vendor_name, 200),
    unit_number: asTrimmedText(row.unit_number, 40),
    vin: asTrimmedText(row.vin, 17)?.toUpperCase() ?? null,
    repair_category: asTrimmedText(row.repair_category, 100),
    notes: asTrimmedText(row.notes, 4000) ?? asTrimmedText(row.description, 4000),
    description: asTrimmedText(row.description, 4000) ?? asTrimmedText(row.notes, 4000),
    labor_amount: asDecimalText(row.labor_amount),
    parts_amount: asDecimalText(row.parts_amount),
    tax_amount: asDecimalText(row.tax_amount),
    subtotal_amount: asDecimalText(row.subtotal_amount),
    discount_amount: asDecimalText(row.discount_amount),
    invoice_total: asDecimalText(row.invoice_total),
    amount_due: asDecimalText(row.amount_due),
    total_amount: asDecimalText(row.total_amount),
    currency: asTrimmedText(row.currency, 10) ?? "USD",
    source_file_name: asTrimmedText(row.source_file_name, 260),
    raw_text_excerpt: asTrimmedText(row.raw_text_excerpt, 4000),
  };

  const lineItems = normalizeLineItems(row.line_items);

  if (!payload.invoice_number) {
    return NextResponse.json({ error: "Invoice number is required." }, { status: 400 });
  }

  if (!payload.total_amount) {
    return NextResponse.json({ error: "Total amount is required." }, { status: 400 });
  }

  if (!payload.provider_name) {
    return NextResponse.json({ error: "Provider name is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("repairs_expense_headers")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            `A matching invoice already exists for provider ${payload.provider_name}. ` +
            `Invoice: ${payload.invoice_number ?? "N/A"}.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (lineItems.length > 0) {
    const lineItemPayload = lineItems.map((item, index) => ({
      tenant_id: appUser.tenantId,
      uploaded_by_user_id: appUser.id,
      header_id: data.id,
      line_no: item.line_no ?? index + 1,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount: item.amount,
    }));

    const { error: lineInsertError } = await supabase.from("repairs_expense_line_items").insert(lineItemPayload);
    if (lineInsertError) {
      await supabase.from("repairs_expense_headers").delete().eq("id", data.id);
      return NextResponse.json({ error: lineInsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ inserted: 1, id: data.id }, { status: 201 });
}
