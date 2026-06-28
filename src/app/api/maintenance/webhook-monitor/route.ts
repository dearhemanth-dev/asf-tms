import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const thresholdHours = 24;
    const staleThresholdMs = thresholdHours * 60 * 60 * 1000;
    const sinceIso = new Date(Date.now() - staleThresholdMs).toISOString();

    const { data: logs, error: logError } = await supabase
      .from("webhook_ingestion_logs")
      .select("received_at,signature_valid,http_status,received_count,inserted_count,duplicate_count,error_count,event_types,notes")
      .eq("tenant_id", appUser.tenantId)
      .order("received_at", { ascending: false })
      .limit(200);

    if (logError) {
      return NextResponse.json({ error: logError.message || "Unable to load webhook monitor." }, { status: 500 });
    }

    const logRows = logs ?? [];
    const recentRows = logRows.filter((row) => String(row.received_at ?? "") >= sinceIso);

    const totals = recentRows.reduce(
      (acc, row) => {
        acc.received += Number(row.received_count ?? 0);
        acc.inserted += Number(row.inserted_count ?? 0);
        acc.duplicates += Number(row.duplicate_count ?? 0);
        acc.errors += Number(row.error_count ?? 0);
        return acc;
      },
      { received: 0, inserted: 0, duplicates: 0, errors: 0 }
    );

    const eventTypeCounts = new Map<string, number>();
    for (const row of recentRows) {
      const types = String(row.event_types ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      for (const eventType of types) {
        const key = String(eventType || "").trim();
        if (!key) continue;
        eventTypeCounts.set(key, (eventTypeCounts.get(key) ?? 0) + 1);
      }
    }

    const topEventTypes = [...eventTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([eventType, count]) => ({ eventType, count }));

    const lastSuccess = logRows.find((row) => Number(row.inserted_count ?? 0) > 0) ?? null;
    const lastReceivedAt = String(logRows[0]?.received_at ?? "") || null;
    const stale = !lastReceivedAt || Date.now() - new Date(lastReceivedAt).getTime() > staleThresholdMs;

    return NextResponse.json(
      {
        tenantId: appUser.tenantId,
        staleThresholdHours: thresholdHours,
        stale,
        lastReceivedAt,
        lastSuccessAt: lastSuccess ? String(lastSuccess.received_at ?? "") : null,
        totalsLast24h: totals,
        topEventTypes,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
