import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { cleanupStalePushSubscriptions, pushConfigured, sendPushToTenant } from "@/lib/notifications/push";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!pushConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Push not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
        },
        { status: 200 }
      );
    }

    const occurredAt = new Date().toISOString();
    const alertParams = new URLSearchParams({
      severity: "critical",
      title: "ASF TMS Test Critical Alert",
      vehicle: "Unit 1146 (Test)",
      fault: "Engine coolant temperature abnormal and oil pressure warning",
      summary: "Immediate maintenance required to prevent engine damage.",
      action: "Pull over when safe, dispatch roadside support, and verify fluid system status.",
      occurredAt,
      highlights: "Coolant temperature exceeded threshold||Oil pressure dropped below safe range||Risk of forced derate in current trip",
    });

    const targetUsernames = ["hkmaintenance", "gsmaintenance", "skmaintenance"];
    let staleRemoved = 0;
    try {
      const cleanup = await cleanupStalePushSubscriptions({
        usernames: targetUsernames,
        maxAgeDays: 14,
      });
      staleRemoved = cleanup.removed;
    } catch {
      // Non-fatal: proceed with send if cleanup fails.
    }

    const aggregate = {
      attempted: 0,
      sent: 0,
      removed: 0,
      errors: [] as string[],
    };

    for (const username of targetUsernames) {
      const result = await sendPushToTenant(
        {
          tenantId: null,
          username,
        },
        {
          title: "ASF TMS Critical Alert - Test",
          body: "Unit 1146: coolant and oil pressure warning. Tap for concise alert view.",
          url: `/maintenance/alerts?${alertParams.toString()}`,
          tag: "maintenance-test-alert",
        }
      );

      aggregate.attempted += result.attempted;
      aggregate.sent += result.sent;
      aggregate.removed += result.removed;
      aggregate.errors.push(...result.errors);
    }

    if (aggregate.attempted === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No registered devices found for hkmaintenance, gsmaintenance, or skmaintenance.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: aggregate.sent > 0,
      attempted: aggregate.attempted,
      sent: aggregate.sent,
      removed: aggregate.removed,
      staleRemoved,
      errors: aggregate.errors,
      targets: targetUsernames,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
