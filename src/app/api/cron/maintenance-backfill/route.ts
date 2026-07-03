import { NextResponse } from "next/server";
import { normalizeMaintenanceBackfillLookbackWindow, runMaintenanceBackfillForTenant, createServiceRoleClient } from "@/lib/fleet/maintenance-backfill";

function isCronRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return request.headers.get("x-vercel-cron") === "1";
}

async function runCronBackfill(request: Request): Promise<NextResponse> {
  try {
    if (!isCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createServiceRoleClient();
    const window = normalizeMaintenanceBackfillLookbackWindow(24);

    const { data: orgRows, error } = await supabase
      .from("organizations")
      .select("tenant_id,samsara_api_key")
      .not("samsara_api_key", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message || "Unable to load Samsara keys." }, { status: 500 });
    }

    const groupedKeys = new Map<string, string[]>();
    for (const row of orgRows ?? []) {
      const tenantId = String((row as { tenant_id?: unknown }).tenant_id ?? "").trim();
      const samsaraApiKey = String((row as { samsara_api_key?: unknown }).samsara_api_key ?? "").trim();
      if (!tenantId || !samsaraApiKey) continue;
      const current = groupedKeys.get(tenantId) ?? [];
      current.push(samsaraApiKey);
      groupedKeys.set(tenantId, current);
    }

    const tenantResults = [] as Array<Awaited<ReturnType<typeof runMaintenanceBackfillForTenant>>>;
    for (const [tenantId, samsaraApiKeys] of groupedKeys.entries()) {
      const result = await runMaintenanceBackfillForTenant({
        supabase,
        tenantId,
        samsaraApiKeys,
        window,
        dryRun: false,
        notifyOnInsert: true,
      });
      tenantResults.push(result);
    }

    const totals = tenantResults.reduce(
      (acc, result) => {
        acc.tenants += 1;
        acc.inserted += result.inserted;
        acc.duplicates += result.duplicates;
        acc.errors += result.errors;
        acc.candidates += result.candidateAlerts;
        return acc;
      },
      { tenants: 0, inserted: 0, duplicates: 0, errors: 0, candidates: 0 }
    );

    return NextResponse.json(
      {
        ok: true,
        window,
        totals,
        tenantResults,
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

export async function GET(request: Request): Promise<NextResponse> {
  return runCronBackfill(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return runCronBackfill(request);
}