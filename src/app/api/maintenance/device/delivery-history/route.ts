import { NextRequest, NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: User's alert delivery history
export async function GET(req: NextRequest) {
  try {
    const appUser = await getAppSessionUser(req);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();

    // Get last 50 delivery log entries for this user
    const { data: deliveryLog, error: logError } = await supabase
      .from("push_alert_delivery_log")
      .select(
        `
        id,
        alert_id,
        status,
        failure_reason,
        received_at,
        sent_at,
        failed_at,
        retry_count,
        maintenance_alerts(
          id,
          event_id,
          severity,
          description
        )
      `
      )
      .eq("username", appUser.username)
      .order("created_at", { ascending: false })
      .limit(50);

    if (logError) {
      console.error("Delivery log fetch error:", logError);
      return NextResponse.json(
        { error: "Failed to fetch delivery history" },
        { status: 500 }
      );
    }

    // Calculate statistics
    const stats = {
      total: deliveryLog?.length ?? 0,
      sent: deliveryLog?.filter((d) => d.status === "sent").length ?? 0,
      failed: deliveryLog?.filter((d) => d.status === "failed").length ?? 0,
      pending: deliveryLog?.filter((d) => d.status === "pending").length ?? 0,
      successRate: deliveryLog && deliveryLog.length > 0
        ? Math.round(
            ((deliveryLog.filter((d) => d.status === "sent").length) /
              deliveryLog.length) *
              100
          )
        : 0,
    };

    return NextResponse.json({
      ok: true,
      stats,
      deliveryLog: deliveryLog || [],
    });
  } catch (error) {
    console.error("Delivery history error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
