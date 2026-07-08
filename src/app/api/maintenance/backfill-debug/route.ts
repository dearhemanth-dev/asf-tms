/**
 * DEBUG BACKFILL ENDPOINT - Full simulation without auth
 * This is a development-only endpoint for testing backfill logic
 * REMOVE BEFORE PRODUCTION
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key, { auth: { persistSession: false } });
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

type OrgKeyRow = {
  tenant_id: string;
  samsara_api_key: string;
};

interface SamsaraVehicle {
  id: string;
  name?: string;
  j1939?: {
    diagnosticTroubleCodes?: Array<{
      spn?: string | number;
      fmi?: string | number;
    }>;
    checkEngineLights?: {
      warningIsOn?: boolean;
      stopIsOn?: boolean;
    };
  };
}

interface SamsaraResponse {
  data?: SamsaraVehicle[];
  errors?: Array<{ detail?: string }>;
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  const result = {
    ok: false,
    startedAt,
    completedAt: "",
    durationMs: 0,
    keysProcessed: 0,
    keysSucceeded: 0,
    keysFailed: 0,
    vehiclesFound: 0,
    alertsAttempted: 0,
    alertsInserted: 0,
    alertsDuplicate: 0,
    alertsErrored: 0,
    errorSummary: [] as string[],
    ingestionLogId: undefined,
  };

  try {
    const supabase = getServiceRoleClient();

    // 1. GET SAMSARA KEYS
    console.log("[Backfill Debug] Fetching Samsara keys...");
    const { data: keys, error: keysError } = await supabase
      .from("organizations")
      .select("tenant_id, samsara_api_key")
      .not("samsara_api_key", "is", null) as any;

    if (keysError) {
      result.errorSummary.push(`Failed to fetch keys: ${keysError.message}`);
      return NextResponse.json(result);
    }

    const orgRows = (keys as OrgKeyRow[]) || [];
    
    // DEDUPLICATE: Use a Map to track distinct API keys
    const distinctKeysMap = new Map<string, string>(); // key -> tenant_id
    for (const org of orgRows) {
      const key = asString(org.samsara_api_key);
      if (key && !distinctKeysMap.has(key)) {
        distinctKeysMap.set(key, org.tenant_id);
      }
    }
    
    const distinctKeyEntries = Array.from(distinctKeysMap.entries());
    result.keysProcessed = distinctKeyEntries.length;
    console.log(`[Backfill Debug] Found ${orgRows.length} organizations, but only ${distinctKeyEntries.length} distinct Samsara API keys`);

    // 2. FETCH FROM SAMSARA FOR EACH DISTINCT KEY
    const allVehicles: Array<SamsaraVehicle & { tenant_id: string }> = [];
    const alertsToInsert: Array<{
      tenant_id: string;
      vehicle_id: string;
      spn: string;
      fmi: string;
      severity: "critical" | "warning" | "info";
      title: string;
      description: string;
      source: string;
      event_id: string;
      received_at: string;
    }> = [];

    for (const [samsaraApiKey, tenantId] of distinctKeyEntries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        // Build query params for Samsara API
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
        const params = new URLSearchParams({
          types: "faultCodes", // Required parameter
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          limit: "512", // Max limit per Samsara API
        });

        const response = await fetch(`https://api.samsara.com/fleet/vehicles/stats?${params}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${samsaraApiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          result.keysFailed++;
          const errorBody = await response.text();
          result.errorSummary.push(
            `Samsara API error for ${tenantId}: ${response.status} ${response.statusText} - ${errorBody.slice(0, 100)}`
          );
          console.error(`[Backfill Debug] Samsara error for ${tenantId}:`, errorBody);
          continue;
        }

        const data = (await response.json()) as SamsaraResponse;
        result.keysSucceeded++;

        const vehicles = data.data || [];
        console.log(`[Backfill Debug] Found ${vehicles.length} vehicles for API key (tenant ${tenantId})`);
        result.vehiclesFound += vehicles.length;

        // Extract fault codes
        for (const vehicle of vehicles) {
          const vehicleId = asString(vehicle.id);
          if (!vehicleId) continue;

          const dtcArray = vehicle.j1939?.diagnosticTroubleCodes || [];
          const checkEngine = vehicle.j1939?.checkEngineLights;

          for (const dtc of dtcArray) {
            const spn = asString(dtc.spn);
            const fmi = asString(dtc.fmi);

            if (!spn || !fmi) continue;

            // Determine severity
            let severity: "critical" | "warning" | "info" = "info";
            if (checkEngine?.stopIsOn) {
              severity = "critical";
            } else if (checkEngine?.warningIsOn) {
              severity = "warning";
            }

            const eventId = `backfill:${vehicleId}|${spn}|${fmi}`;
            const title = `DTC ${spn}/${fmi} - ${vehicle.name || vehicleId}`;
            const description = `Diagnostic Trouble Code detected via Samsara backfill. SPN: ${spn}, FMI: ${fmi}`;

            alertsToInsert.push({
              tenant_id: tenantId,
              vehicle_id: vehicleId,
              spn,
              fmi,
              severity,
              title,
              description,
              source: "backfill",
              event_id: eventId,
              received_at: new Date().toISOString(),
            });

            result.alertsAttempted++;
          }
        }
      } catch (error) {
        result.keysFailed++;
        result.errorSummary.push(
          `Error processing API key (${tenantId}): ${error instanceof Error ? error.message : "Unknown error"}`
        );
        console.error(`[Backfill Debug] Error for ${tenantId}:`, error);
      }
    }

    // 3. UPSERT ALERTS (if no vehicles found, skip)
    if (alertsToInsert.length > 0) {
      console.log(`[Backfill Debug] Upserting ${alertsToInsert.length} alerts...`);

      const { data: upsertResult, error: upsertError } = await supabase
        .from("maintenance_alerts")
        .upsert(alertsToInsert, {
          onConflict: "tenant_id,event_id",
          ignoreDuplicates: false,
        }) as any;

      if (upsertError) {
        result.errorSummary.push(`Upsert error: ${upsertError.message}`);
        result.alertsErrored = alertsToInsert.length;
      } else {
        // Count results
        const resultArray = (upsertResult as any[]) || [];
        result.alertsInserted = resultArray.filter((r: any) => r.created_at).length;
        result.alertsDuplicate = resultArray.filter((r: any) => !r.created_at).length;
      }
    }

    // 4. LOG TO BACKFILL_INGESTION_LOG
    const logEntry = {
      tenant_id: "debug-mode",
      triggered_by: "debug-endpoint",
      keys_processed: result.keysProcessed,
      keys_succeeded: result.keysSucceeded,
      keys_failed: result.keysFailed,
      vehicles_found: result.vehiclesFound,
      alerts_attempted: result.alertsAttempted,
      alerts_inserted: result.alertsInserted,
      alerts_duplicate: result.alertsDuplicate,
      alerts_errored: result.alertsErrored,
      error_count: result.errorSummary.length,
      error_summary: result.errorSummary.length > 0 ? result.errorSummary.join("\n") : null,
      completed_at: new Date().toISOString(),
    };

    const { data: logResult, error: logError } = await supabase
      .from("backfill_ingestion_log")
      .insert(logEntry)
      .select("id") as any;

    if (!logError && logResult && logResult.length > 0) {
      result.ingestionLogId = (logResult[0] as any).id;
    }

    result.ok = result.alertsAttempted > 0 && result.errorSummary.length === 0;
    result.completedAt = new Date().toISOString();
    result.durationMs = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime();

    console.log("[Backfill Debug] Complete:", result);

    return NextResponse.json(result);
  } catch (error) {
    result.errorSummary.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    result.completedAt = new Date().toISOString();
    result.durationMs = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime();
    return NextResponse.json(result);
  }
}
