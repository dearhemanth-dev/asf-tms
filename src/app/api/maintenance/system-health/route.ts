import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: System health dashboard data for ops
export async function GET(req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const user = await supabase.auth.getUser();

    if (!user.data.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is maintenance role (ops)
    const { data: userData, error: userError } = await supabase
      .from("Users")
      .select("tenant_id, UserType")
      .eq("id", user.data.user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (userData.UserType !== "maintenance") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const tenantId = userData.tenant_id;

    // Get latest health metrics (last 5-min bucket)
    const { data: latestMetrics } = await supabase
      .from("push_system_health_metrics")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("metric_period", { ascending: false })
      .limit(1)
      .single();

    // Get health metrics trend (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: metricsTrend } = await supabase
      .from("push_system_health_metrics")
      .select("metric_period, alerts_queued, alerts_sent, alerts_failed, latency_p95_ms")
      .eq("tenant_id", tenantId)
      .gte("metric_period", twentyFourHoursAgo)
      .order("metric_period", { ascending: false })
      .limit(288); // 24 hours * 6 buckets per hour

    // Get subscription enrollment stats
    const { data: subscriptions } = await supabase
      .from("maintenance_push_subscriptions")
      .select("status")
      .eq("tenant_id", tenantId);

    const subscriptionStats = {
      total: subscriptions?.length ?? 0,
      verified: subscriptions?.filter((s) => s.status === "verified").length ?? 0,
      pending: subscriptions?.filter((s) => s.status === "pending").length ?? 0,
      expired: subscriptions?.filter((s) => s.status === "expired").length ?? 0,
      revoked: subscriptions?.filter((s) => s.status === "revoked").length ?? 0,
    };

    // Get failed deliveries (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: failedDeliveries } = await supabase
      .from("push_alert_delivery_log")
      .select("id, username, status, failure_reason, failed_at, error_details")
      .eq("tenant_id", tenantId)
      .eq("status", "failed")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(20);

    // Get pipeline health status (webhook + backfill)
    const { data: pipelineHealth } = await supabase
      .from("push_pipeline_health")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    // Compute success rate from latest metrics
    const successRate = latestMetrics
      ? Math.round(
          (latestMetrics.alerts_sent * 100) /
            Math.max(latestMetrics.alerts_queued, 1)
        )
      : null;

    // Calculate SLA violations
    const slaViolations = {
      successRateBelowTarget:
        successRate !== null && successRate < 95,
      latencyExceedsTarget:
        latestMetrics?.latency_p95_ms !== null &&
        latestMetrics?.latency_p95_ms > 30000,
      webhookStale: pipelineHealth?.webhook_is_stale ?? false,
      backfillFailing:
        pipelineHealth?.backfill_consecutive_failures ?? 0 >= 3,
    };

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      latestMetrics: latestMetrics
        ? {
            ...latestMetrics,
            delivery_success_rate: successRate,
          }
        : null,
      metricsTrend: metricsTrend || [],
      subscriptionStats,
      failedDeliveries: failedDeliveries || [],
      pipelineHealth: pipelineHealth || null,
      slaViolations,
      slaTargets: {
        deliverySuccessRate: 95, // percent
        latencyP95: 30000, // milliseconds
        webhookStalenessThreshold: 300, // seconds (5 min)
        maxConsecutiveBackfillFailures: 3,
      },
    });
  } catch (error) {
    console.error("System health error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
