import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: Request) {
  const supabase = await getSupabaseServerClient();
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sixtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60);

  const endDate = formatDateOnly(yesterday);
  const cap = formatDateOnly(sixtyDaysAgo);

  // Find the earliest date in the DB (within 60 days cap).
  const { data: minData, error: minError } = await supabase
    .from("fuel_expenses")
    .select("transaction_date")
    .eq("tenant_id", appUser.tenantId)
    .not("transaction_date", "is", null)
    .order("transaction_date", { ascending: true })
    .limit(1);

  if (minError) {
    return NextResponse.json({ error: minError.message }, { status: 500 });
  }

  const earliestInDb: string | null = minData?.[0]?.transaction_date ?? null;
  // Use whichever is later: earliest DB date or 60-days-ago cap.
  const startDate = earliestInDb && earliestInDb > cap ? earliestInDb : cap;

  const { data, error } = await supabase
    .from("fuel_expenses")
    .select("transaction_date")
    .eq("tenant_id", appUser.tenantId)
    .gte("transaction_date", startDate)
    .lte("transaction_date", endDate)
    .not("transaction_date", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const presentDates = new Set<string>(
    (data ?? []).map((row) => String(row.transaction_date))
  );

  const missingDates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  while (cursor <= yesterday) {
    const key = formatDateOnly(cursor);
    if (!presentDates.has(key)) {
      missingDates.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return NextResponse.json({
    startDate,
    endDate,
    checkedDays: missingDates.length + presentDates.size,
    presentDays: presentDates.size,
    missingCount: missingDates.length,
    missingDates,
  });
}
