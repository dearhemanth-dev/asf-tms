import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { pushConfigured, sendPushToTenant } from "@/lib/notifications/push";
import { recordPushAction } from "@/lib/notifications/push-audit";

function asTier(value: unknown): "critical" | "warning" | "info" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "warning" || normalized === "info") return normalized;
  return "critical";
}

export async function POST(request: Request): Promise<NextResponse> {
  let username = "unknown";
  let tenantId: string | null = null;
  let role = "unknown";
  const userAgent = typeof request.headers.get === "function" ? request.headers.get("user-agent") ?? null : null;
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    username = appUser.username;
    tenantId = appUser.tenantId;
    role = appUser.role;

    if (!pushConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Push not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
        },
        { status: 200 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { tier?: string };
    const tier = asTier(body.tier);
    const occurredAt = new Date().toISOString();

    await recordPushAction({
      tenantId: appUser.tenantId,
      username: appUser.username,
      userRole: appUser.role,
      action: "self_test_push_requested",
      status: "info",
      options: { tier },
      userAgent,
    });

    const titles: Record<"critical" | "warning" | "info", string> = {
      critical: "ASF TMS Critical Alert - Personal Test",
      warning: "ASF TMS Pro+ Alert - Personal Test",
      info: "ASF TMS Info Alert - Personal Test",
    };

    const summaries: Record<"critical" | "warning" | "info", string> = {
      critical: "Immediate maintenance action is recommended for this test signal.",
      warning: "Pro+ alert preview for maintenance personnel onboarding.",
      info: "Informational push preview for maintenance user experience.",
    };

    const alertParams = new URLSearchParams({
      severity: tier,
      title: titles[tier],
      vehicle: "Onboarding Test Unit",
      fault: "Push registration and delivery verification",
      summary: summaries[tier],
      action: "Confirm this notification appears on your phone and opens the app.",
      occurredAt,
      highlights: "Notification received on phone||Tap opened alert screen||User is subscribed for push",
    });

    const result = await sendPushToTenant(
      {
        tenantId: null,
        username: appUser.username,
      },
      {
        title: titles[tier],
        body: "Tap to confirm your phone is fully enrolled for ASF TMS push alerts.",
        url: `/maintenance/alerts?${alertParams.toString()}`,
        tag: `maintenance-self-test-${tier}`,
      }
    );

    if (result.attempted === 0) {
      await recordPushAction({
        tenantId: appUser.tenantId,
        username: appUser.username,
        userRole: appUser.role,
        action: "self_test_push_no_subscription",
        status: "failed",
        options: { tier },
        errorMessage: "No registered push subscription found for this user.",
        userAgent,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "No registered push subscription found for this user. Enable push on this phone first.",
        },
        { status: 200 }
      );
    }

    await recordPushAction({
      tenantId: appUser.tenantId,
      username: appUser.username,
      userRole: appUser.role,
      action: "self_test_push_sent",
      status: result.sent > 0 ? "success" : "failed",
      options: {
        tier,
        attempted: result.attempted,
        sent: result.sent,
        removed: result.removed,
      },
      errorMessage: result.errors.length > 0 ? result.errors[0] : null,
      userAgent,
    });

    return NextResponse.json({
      ok: result.sent > 0,
      tier,
      attempted: result.attempted,
      sent: result.sent,
      removed: result.removed,
      errors: result.errors,
    });
  } catch (error) {
    await recordPushAction({
      tenantId,
      username,
      userRole: role,
      action: "self_test_push_error",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unexpected server error.",
      userAgent,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
