import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ALLOWED_ROLES = ["management", "accounts"] as const;

type ImportAction = "validate" | "commit";

type ImportAcknowledgements = {
  reviewedConflicts?: boolean;
  understandImpact?: boolean;
};

type ConflictDecision = {
  conflictKey: string;
  decision: "keep_both" | "skip";
};

type ExistingFuelExpense = {
  id: string;
  transaction_number: string | null;
  transaction_date: string | null;
  transaction_time: string | null;
  truck_stop_name: string | null;
  truck_stop_city: string | null;
  truck_stop_state: string | null;
  truck_stop_invoice_number: string | null;
  driver_name: string | null;
  unit_number: string | null;
  diesel_gallons: string | number | null;
  diesel_price_per_gallon: string | number | null;
  diesel_cost: string | number | null;
  total_amount_due_comdata: string | number | null;
};

type ConflictPayload = {
  conflictKey: string;
  kind: "transaction_number_conflict";
  incoming: {
    uploadIndex: number;
    transaction_number: string | null;
    transaction_date: string | null;
    transaction_time: string | null;
    truck_stop_name: string | null;
    truck_stop_city: string | null;
    truck_stop_state: string | null;
    truck_stop_invoice_number: string | null;
    driver_name: string | null;
    unit_number: string | null;
    diesel_gallons: string | number | null;
    diesel_price_per_gallon: string | number | null;
    diesel_cost: string | number | null;
    total_amount_due_comdata: string | number | null;
  };
  existing: ExistingFuelExpense;
};

type PreparedImportRow = Record<string, unknown> & {
  __uploadIndex: number;
};

function normalizeTransactionNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeDate(value: unknown): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized;
}

function compositeUploadKey(row: Record<string, unknown>): string | null {
  const txn = normalizeTransactionNumber(row.transaction_number);
  if (!txn) return null;
  const date = normalizeDate(row.transaction_date) ?? "";
  const invoice = normalizeText(row.truck_stop_invoice_number) ?? "";
  return `${txn}::${date}::${invoice}`;
}

function sameAsExisting(row: Record<string, unknown>, existing: ExistingFuelExpense): boolean {
  const incomingTxn = normalizeTransactionNumber(row.transaction_number);
  const incomingDate = normalizeDate(row.transaction_date) ?? "";
  const incomingInvoice = normalizeText(row.truck_stop_invoice_number) ?? "";

  const existingTxn = normalizeTransactionNumber(existing.transaction_number);
  const existingDate = normalizeDate(existing.transaction_date) ?? "";
  const existingInvoice = normalizeText(existing.truck_stop_invoice_number) ?? "";

  return incomingTxn === existingTxn && incomingDate === existingDate && incomingInvoice === existingInvoice;
}

function toConflictPayload(row: PreparedImportRow, existing: ExistingFuelExpense): ConflictPayload {
  const txn = normalizeTransactionNumber(row.transaction_number);
  const date = normalizeDate(row.transaction_date);
  const invoice = normalizeText(row.truck_stop_invoice_number);
  const conflictKey = `${txn ?? "none"}::${date ?? "none"}::${invoice ?? "none"}::${row.__uploadIndex}`;

  return {
    conflictKey,
    kind: "transaction_number_conflict",
    incoming: {
      uploadIndex: row.__uploadIndex,
      transaction_number: txn,
      transaction_date: date,
      transaction_time: normalizeText(row.transaction_time),
      truck_stop_name: normalizeText(row.truck_stop_name),
      truck_stop_city: normalizeText(row.truck_stop_city),
      truck_stop_state: normalizeText(row.truck_stop_state),
      truck_stop_invoice_number: invoice,
      driver_name: normalizeText(row.driver_name),
      unit_number: normalizeText(row.unit_number),
      diesel_gallons: (row.diesel_gallons as string | number | null | undefined) ?? null,
      diesel_price_per_gallon: (row.diesel_price_per_gallon as string | number | null | undefined) ?? null,
      diesel_cost: (row.diesel_cost as string | number | null | undefined) ?? null,
      total_amount_due_comdata: (row.total_amount_due_comdata as string | number | null | undefined) ?? null,
    },
    existing,
  };
}

async function findExistingByTransaction(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  tenantId: string,
  transactionNumbers: string[]
): Promise<Map<string, ExistingFuelExpense[]>> {
  const byTxn = new Map<string, ExistingFuelExpense[]>();
  if (transactionNumbers.length === 0) return byTxn;

  const chunkSize = 200;
  for (let start = 0; start < transactionNumbers.length; start += chunkSize) {
    const chunk = transactionNumbers.slice(start, start + chunkSize);
    const { data, error } = await supabase
      .from("fuel_expenses")
      .select(
        "id,transaction_number,transaction_date,transaction_time,truck_stop_name,truck_stop_city,truck_stop_state,truck_stop_invoice_number,driver_name,unit_number,diesel_gallons,diesel_price_per_gallon,diesel_cost,total_amount_due_comdata"
      )
      .eq("tenant_id", tenantId)
      .in("transaction_number", chunk);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as ExistingFuelExpense[]) {
      const txn = normalizeTransactionNumber(row.transaction_number);
      if (!txn) continue;
      const existing = byTxn.get(txn) ?? [];
      existing.push(row);
      byTxn.set(txn, existing);
    }
  }

  return byTxn;
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

  const payload = body as {
    rows: unknown[];
    action?: ImportAction;
    conflictDecisions?: ConflictDecision[];
    acknowledgements?: ImportAcknowledgements;
  };
  const rawRows = payload.rows;
  const action: ImportAction = payload.action === "validate" ? "validate" : "commit";

  if (rawRows.length === 0) {
    return NextResponse.json({ error: "No rows to import." }, { status: 400 });
  }

  if (rawRows.length > 5000) {
    return NextResponse.json({ error: "Maximum 5,000 rows per import batch." }, { status: 400 });
  }

  const rows = rawRows
    .map((row, uploadIndex) => {
    if (typeof row !== "object" || row === null) return null;
    const r = { ...(row as Record<string, unknown>) };
    delete r.id;
    delete r.created_at;
    r.tenant_id = appUser.tenantId;
    r.uploaded_by_user_id = appUser.id;
      return { ...r, __uploadIndex: uploadIndex } as PreparedImportRow;
    })
    .filter((r): r is PreparedImportRow => r !== null);

  const seenInUpload = new Set<string>();
  const duplicateInUpload = new Set<string>();
  const uniqueTransactionNumbers: string[] = [];

  for (const row of rows) {
    const transactionNumber = normalizeTransactionNumber(row.transaction_number);
    if (!transactionNumber) continue;

    const uploadKey = compositeUploadKey(row);
    if (uploadKey && seenInUpload.has(uploadKey)) {
      duplicateInUpload.add(uploadKey);
      continue;
    }

    if (uploadKey) {
      seenInUpload.add(uploadKey);
    }
    uniqueTransactionNumbers.push(transactionNumber);
  }

  if (duplicateInUpload.size > 0) {
    const samples = Array.from(duplicateInUpload)
      .slice(0, 10)
      .map((key) => {
        const [txn, date, invoice] = key.split("::");
        return `${txn} (${date || "no-date"} / ${invoice || "no-invoice"})`;
      })
      .join(", ");
    return NextResponse.json(
      {
        error: `Duplicate rows found in this upload (${duplicateInUpload.size}) by Transaction Number + Date + Invoice. Examples: ${samples}`,
      },
      { status: 409 }
    );
  }

  let existingByTxn: Map<string, ExistingFuelExpense[]>;
  try {
    existingByTxn = await findExistingByTransaction(supabase, appUser.tenantId, Array.from(new Set(uniqueTransactionNumbers)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check duplicates." }, { status: 500 });
  }

  const conflicts: ConflictPayload[] = [];
  const exactDuplicates: { uploadIndex: number; transaction_number: string | null; transaction_date: string | null; truck_stop_invoice_number: string | null }[] = [];

  for (const row of rows) {
    const txn = normalizeTransactionNumber(row.transaction_number);
    if (!txn) continue;

    const matches = existingByTxn.get(txn) ?? [];
    if (matches.length === 0) continue;

    const exactMatch = matches.find((existing) => sameAsExisting(row, existing));
    if (exactMatch) {
      exactDuplicates.push({
        uploadIndex: row.__uploadIndex,
        transaction_number: txn,
        transaction_date: normalizeDate(row.transaction_date),
        truck_stop_invoice_number: normalizeText(row.truck_stop_invoice_number),
      });
      continue;
    }

    conflicts.push(toConflictPayload(row, matches[0]));
  }

  if (action === "validate") {
    const exactDuplicateIndexes = new Set(exactDuplicates.map((entry) => entry.uploadIndex));
    const conflictIndexes = new Set(conflicts.map((entry) => entry.incoming.uploadIndex));
    const importableCount = rows.filter((row) => !exactDuplicateIndexes.has(row.__uploadIndex) && !conflictIndexes.has(row.__uploadIndex)).length;

    return NextResponse.json({
      action,
      totalRows: rows.length,
      importableCount,
      exactDuplicates,
      conflicts,
      requiresReview: conflicts.length > 0,
    });
  }

  const acknowledgements = payload.acknowledgements ?? {};
  const decisions = payload.conflictDecisions ?? [];
  const decisionsByKey = new Map(decisions.map((entry) => [entry.conflictKey, entry.decision]));

  if (conflicts.length > 0) {
    if (!acknowledgements.reviewedConflicts || !acknowledgements.understandImpact) {
      return NextResponse.json(
        {
          error: "Double acknowledgment required before committing conflicts.",
          conflicts,
          requiresReview: true,
        },
        { status: 409 }
      );
    }

    const missingDecisions = conflicts.filter((entry) => !decisionsByKey.has(entry.conflictKey));
    if (missingDecisions.length > 0) {
      return NextResponse.json(
        {
          error: "A decision is required for every conflict before commit.",
          conflicts,
          requiresReview: true,
        },
        { status: 409 }
      );
    }
  }

  const exactDuplicateIndexes = new Set(exactDuplicates.map((entry) => entry.uploadIndex));
  const conflictByUploadIndex = new Map(conflicts.map((entry) => [entry.incoming.uploadIndex, entry]));
  const rowsToInsert: Record<string, unknown>[] = [];
  let skippedConflicts = 0;

  for (const row of rows) {
    if (exactDuplicateIndexes.has(row.__uploadIndex)) continue;

    const conflict = conflictByUploadIndex.get(row.__uploadIndex);
    if (conflict) {
      const decision = decisionsByKey.get(conflict.conflictKey);
      if (decision !== "keep_both") {
        skippedConflicts += 1;
        continue;
      }
    }

    const { __uploadIndex: _uploadIndex, ...cleanRow } = row;
    rowsToInsert.push(cleanRow);
  }

  if (rowsToInsert.length === 0) {
    return NextResponse.json({
      inserted: 0,
      skippedConflicts,
      skippedExactDuplicates: exactDuplicates.length,
      message: "No rows were inserted after conflict decisions.",
    });
  }

  const { data, error } = await supabase
    .from("fuel_expenses")
    .insert(rowsToInsert)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      inserted: data?.length ?? 0,
      skippedConflicts,
      skippedExactDuplicates: exactDuplicates.length,
    },
    { status: 201 }
  );
}
