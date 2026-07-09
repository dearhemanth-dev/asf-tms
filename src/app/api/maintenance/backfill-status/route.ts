/**
 * GET /api/maintenance/backfill-status
 * 
 * Fetches the last backfill ingestion run for the current tenant
 * Used by UI to display backfill monitor widget
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: Request) {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = appUser.tenantId ?? "unknown";
    const supabase = getServiceRoleClient();

    // Fetch the most recent backfill run for this tenant
    const { data, error } = await supabase
      .from("backfill_ingestion_log")
      .select(
        "id, tenant_id, triggered_by, keys_processed, keys_succeeded, keys_failed, vehicles_found, alerts_attempted, alerts_inserted, alerts_duplicate, alerts_errored, duration_ms, error_count, error_summary, completed_at, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No data yet is not an error
      if (error.code === "PGRST116") {
        return NextResponse.json({
          ok: true,
          lastRun: null,
          message: "No backfill runs yet",
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      lastRun: data ? {
        id: data.id,
        triggeredBy: data.triggered_by,
        completedAt: data.completed_at,
        durationMs: data.duration_ms,
        keysProcessed: data.keys_processed,
        keysSucceeded: data.keys_succeeded,
        keysFailed: data.keys_failed,
        vehiclesFound: data.vehicles_found,
        alertsAttempted: data.alerts_attempted,
        alertsInserted: data.alerts_inserted,
        alertsDuplicate: data.alerts_duplicate,
        alertsErrored: data.alerts_errored,
        errorCount: data.error_count,
        errorSummary: data.error_summary ? data.error_summary.split(";") : [],
      } : null,
    });
  } catch (error) {
    console.error("[backfill-status] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
