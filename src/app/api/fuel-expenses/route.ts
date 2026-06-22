import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ALLOWED_ROLES = ["management", "accounts"] as const;

function normalizeTransactionNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 1000);
  const offset = Number(searchParams.get("offset") ?? "0");

  const { data, error, count } = await supabase
    .from("fuel_expenses")
    .select("*", { count: "exact" })
    .eq("tenant_id", appUser.tenantId)
    .order("transaction_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ expenses: data ?? [], total: count ?? 0 });
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

  if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).rows)) {
    return NextResponse.json({ error: "Request body must contain a rows array." }, { status: 400 });
  }

  const rawRows = (body as { rows: unknown[] }).rows;

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "No rows to import." }, { status: 400 });
  }

  if (rawRows.length > 5000) {
    return NextResponse.json({ error: "Maximum 5,000 rows per import batch." }, { status: 400 });
  }

  // Attach tenant_id to every row and strip any client-supplied id / created_at.
  const rows = rawRows.map((row) => {
    if (typeof row !== "object" || row === null) return null;
    const r = { ...(row as Record<string, unknown>) };
    delete r.id;
    delete r.created_at;
    r.tenant_id = appUser.tenantId;
    r.uploaded_by_user_id = appUser.id;
    return r;
  }).filter((r): r is Record<string, unknown> => r !== null);

  const seenInUpload = new Set<string>();
  const duplicateInUpload = new Set<string>();
  const uniqueTransactionNumbers: string[] = [];

  for (const row of rows) {
    const transactionNumber = normalizeTransactionNumber(row.transaction_number);
    if (!transactionNumber) continue;

    if (seenInUpload.has(transactionNumber)) {
      duplicateInUpload.add(transactionNumber);
      continue;
    }

    seenInUpload.add(transactionNumber);
    uniqueTransactionNumbers.push(transactionNumber);
  }

  if (duplicateInUpload.size > 0) {
    const samples = Array.from(duplicateInUpload).slice(0, 10).join(", ");
    return NextResponse.json(
      {
        error: `Duplicate transaction numbers found in this upload (${duplicateInUpload.size}). Examples: ${samples}`,
      },
      { status: 409 }
    );
  }

  if (uniqueTransactionNumbers.length > 0) {
    const existingTransactionNumbers = new Set<string>();
    const chunkSize = 200;

    for (let start = 0; start < uniqueTransactionNumbers.length; start += chunkSize) {
      const chunk = uniqueTransactionNumbers.slice(start, start + chunkSize);
      const { data, error } = await supabase
        .from("fuel_expenses")
        .select("transaction_number")
        .eq("tenant_id", appUser.tenantId)
        .in("transaction_number", chunk);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      for (const row of data ?? []) {
        const transactionNumber = normalizeTransactionNumber((row as { transaction_number?: unknown }).transaction_number);
        if (transactionNumber) {
          existingTransactionNumbers.add(transactionNumber);
        }
      }
    }

    if (existingTransactionNumbers.size > 0) {
      const samples = Array.from(existingTransactionNumbers).slice(0, 10).join(", ");
      return NextResponse.json(
        {
          error: `Import rejected. ${existingTransactionNumbers.size} transaction number(s) already exist for this tenant. Examples: ${samples}`,
        },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from("fuel_expenses")
    .insert(rows)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data?.length ?? 0 }, { status: 201 });
}
