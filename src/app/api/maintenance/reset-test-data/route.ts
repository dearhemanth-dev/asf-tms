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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { hard?: boolean };
    const hard = body.hard === true;

    const supabase = getServiceRoleClient();

    const alertCountQuery = supabase.from("maintenance_alerts").select("id", { count: "exact", head: true });
    const scopedAlertCountQuery = hard ? alertCountQuery : alertCountQuery.eq("tenant_id", appUser.tenantId);
    const { count: alertCountBefore, error: alertCountError } = await scopedAlertCountQuery;

    if (alertCountError) {
      return NextResponse.json(
        { error: alertCountError.message || "Unable to count maintenance alerts." },
        { status: 500 }
      );
    }

    const ingestCountQuery = supabase.from("webhook_ingestion_logs").select("id", { count: "exact", head: true });
    const scopedIngestCountQuery = hard ? ingestCountQuery : ingestCountQuery.eq("tenant_id", appUser.tenantId);
    const { count: ingestCountBefore, error: ingestCountError } = await scopedIngestCountQuery;

    if (ingestCountError) {
      return NextResponse.json(
        { error: ingestCountError.message || "Unable to count ingestion logs." },
        { status: 500 }
      );
    }

    const alertsDeleteQuery = supabase.from("maintenance_alerts").delete();
    const scopedAlertsDeleteQuery = hard
      ? alertsDeleteQuery.not("id", "is", null)
      : alertsDeleteQuery.eq("tenant_id", appUser.tenantId);
    const { error: alertsDeleteError } = await scopedAlertsDeleteQuery;

    if (alertsDeleteError) {
      return NextResponse.json(
        { error: alertsDeleteError.message || "Unable to clear maintenance alerts." },
        { status: 500 }
      );
    }

    const logsDeleteQuery = supabase.from("webhook_ingestion_logs").delete();
    const scopedLogsDeleteQuery = hard
      ? logsDeleteQuery.not("id", "is", null)
      : logsDeleteQuery.eq("tenant_id", appUser.tenantId);
    const { error: logsDeleteError } = await scopedLogsDeleteQuery;

    if (logsDeleteError) {
      return NextResponse.json(
        { error: logsDeleteError.message || "Unable to clear ingestion logs." },
        { status: 500 }
      );
    }

    const alertRemainingQuery = supabase.from("maintenance_alerts").select("id", { count: "exact", head: true });
    const scopedAlertRemainingQuery = hard ? alertRemainingQuery : alertRemainingQuery.eq("tenant_id", appUser.tenantId);
    const { count: alertCountAfter, error: alertAfterError } = await scopedAlertRemainingQuery;

    if (alertAfterError) {
      return NextResponse.json(
        { error: alertAfterError.message || "Unable to verify maintenance alerts reset." },
        { status: 500 }
      );
    }

    const ingestRemainingQuery = supabase.from("webhook_ingestion_logs").select("id", { count: "exact", head: true });
    const scopedIngestRemainingQuery = hard ? ingestRemainingQuery : ingestRemainingQuery.eq("tenant_id", appUser.tenantId);
    const { count: ingestCountAfter, error: ingestAfterError } = await scopedIngestRemainingQuery;

    if (ingestAfterError) {
      return NextResponse.json(
        { error: ingestAfterError.message || "Unable to verify ingestion logs reset." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        tenantId: appUser.tenantId,
        hard,
        deletedAlerts: alertCountBefore ?? 0,
        deletedIngestionLogs: ingestCountBefore ?? 0,
        remainingAlerts: alertCountAfter ?? 0,
        remainingIngestionLogs: ingestCountAfter ?? 0,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}
