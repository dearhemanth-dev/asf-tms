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

type RecentAlertRow = {
  id: string;
  event_type: string | null;
  occurred_at: string;
  vehicle_name: string | null;
  title: string | null;
  severity: "critical" | "warning" | "info";
};

function readableEventType(eventType: string | null): string {
  const raw = (eventType ?? "").trim();
  if (!raw) return "Other";

  const normalized = raw.toLowerCase();
  if (normalized === "enginefaulton") return "Engine Fault";
  if (normalized === "dvirsubmitted") return "DVIR Submitted";
  if (normalized === "severespeedingstarted") return "Severe Speeding Started";
  if (normalized === "severespeedingended") return "Severe Speeding Ended";
  if (normalized === "predictivemaintenancealert") return "Predictive Maintenance";

  return raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getServiceRoleClient();
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("maintenance_alerts")
      .select("id,event_type,occurred_at,vehicle_name,title,severity")
      .eq("tenant_id", appUser.tenantId)
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message || "Unable to load alerts." }, { status: 500 });
    }

    const rows = (data ?? []) as RecentAlertRow[];
    const severityCounts = rows.reduce(
      (acc, row) => {
        if (row.severity === "critical") acc.critical += 1;
        else if (row.severity === "warning") acc.warning += 1;
        else acc.info += 1;
        return acc;
      },
      { critical: 0, warning: 0, info: 0 }
    );

    const eventTypeCounts = new Map<string, number>();
    for (const row of rows) {
      const key = readableEventType(row.event_type);
      eventTypeCounts.set(key, (eventTypeCounts.get(key) ?? 0) + 1);
    }

    const topTypes = [...eventTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    const events = rows.map((row) => {
      const base = row.title?.trim() || readableEventType(row.event_type);
      const vehicle = row.vehicle_name?.trim();
      const summary = vehicle ? `${base} (${vehicle})` : base;

      return {
        id: row.id,
        occurredAt: row.occurred_at,
        summary,
        severity: row.severity,
      };
    });

    return NextResponse.json(
      {
        summary: {
          total: rows.length,
          critical: severityCounts.critical,
          warning: severityCounts.warning,
          info: severityCounts.info,
          topTypes,
        },
        events,
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
