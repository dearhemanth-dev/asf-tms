import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";

/**
 * BACKFILL ENDPOINT - Bulletproof Samsara stats polling
 * 
 * Purpose: Fetch fault codes from Samsara API and insert into maintenance_alerts
 * Primary data source until webhooks are hardened
 * 
 * Authorization: hkmaintenance only (development/ops)
 * 
 * Flow:
 * 1. Validate user (hkmaintenance)
 * 2. Fetch all distinct Samsara API keys from organizations
 * 3. For each key, call /fleet/vehicles/stats with fault codes
 * 4. Extract fault codes from each vehicle
 * 5. Upsert to maintenance_alerts with source=backfill
 * 6. Log results to backfill_ingestion_log
 * 7. Return detailed status
 */

type OrgKeyRow = {
  tenant_id: string;
  samsara_api_key: string;
};

type BackfillResult = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  
  keysProcessed: number;
  keysSucceeded: number;
  keysFailed: number;
  
  vehiclesFound: number;
  alertsAttempted: number;
  alertsInserted: number;
  alertsDuplicate: number;
  alertsErrored: number;
  
  errorSummary: string[];
  ingestionLogId?: string;
};

interface ApiResponse {
  data?: Array<{
    id: string;
    name?: string;
    faultCodes?: Array<{
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
    }>;
  }>;
  errors?: Array<{ detail?: string }>;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toBool(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const n = value.trim().toLowerCase();
    return n === "true" || n === "1" || n === "yes" || n === "on";
  }
  return false;
}

function getServiceRoleClient() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Missing Supabase service role credentials");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchSamsaraStats(apiKey: string): Promise<ApiResponse | null> {
  try {
    // Build query params for Samsara API (required parameters)
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    const params = new URLSearchParams({
      types: "faultCodes", // Required parameter
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: "512", // Max limit per Samsara API
    });
    
    const url = `https://api.samsara.com/fleet/vehicles/stats?${params}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[backfill] Samsara stats failed: ${response.status}`, text.slice(0, 200));
      return null;
    }

    const json = (await response.json()) as ApiResponse;
    return json;
  } catch (error) {
    console.error("[backfill] Fetch error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function getDistinctSamsaraKeys(tenantId: string): Promise<string[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("samsara_api_key")
    .eq("tenant_id", tenantId)
    .not("samsara_api_key", "is", null);

  if (error) {
    console.error("[backfill] Query organizations failed:", error.message);
    return [];
  }

  const keys = new Set<string>();
  for (const row of (data ?? []) as OrgKeyRow[]) {
    const key = asString(row.samsara_api_key);
    if (key) keys.add(key);
  }

  return [...keys];
}

async function upsertAlert(
  supabase: any,
  alert: Record<string, unknown>
): Promise<{ inserted: boolean; isDuplicate: boolean; error?: string }> {
  const { error } = await supabase
    .from("maintenance_alerts")
    .upsert(alert, {
      onConflict: "tenant_id,event_id",
    });

  if (error) {
    // Check if duplicate (unique constraint)
    if (error.message?.includes("duplicate") || error.code === "23505") {
      return { inserted: false, isDuplicate: true };
    }
    return { inserted: false, isDuplicate: false, error: error.message };
  }

  return { inserted: true, isDuplicate: false };
}

export async function POST(request: Request): Promise<NextResponse> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const result: BackfillResult = {
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
    errorSummary: [],
  };

  try {
    // 1. AUTHORIZE: hkmaintenance only
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      result.errorSummary.push("Unauthorized");
      return NextResponse.json({ ...result, ok: false }, { status: 401 });
    }

    const username = (appUser.username ?? "").trim().toLowerCase();
    if (username !== "hkmaintenance") {
      result.errorSummary.push(`Access denied: ${username} (hkmaintenance required)`);
      return NextResponse.json({ ...result, ok: false }, { status: 403 });
    }

    const tenantId = appUser.tenantId ?? "unknown";
    const supabase = getServiceRoleClient();

    // 2. GET SAMSARA KEYS
    const apiKeys = await getDistinctSamsaraKeys(tenantId);
    if (apiKeys.length === 0) {
      result.errorSummary.push("No Samsara API keys configured");
      result.completedAt = new Date().toISOString();
      result.durationMs = Date.now() - startTime;
      return NextResponse.json({ ...result, ok: true }, { status: 200 });
    }

    result.keysProcessed = apiKeys.length;

    // 3. FETCH STATS FOR EACH KEY (continue on error)
    const allAlerts: Array<{
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

    for (const apiKey of apiKeys) {
      try {
        const statsPayload = await fetchSamsaraStats(apiKey);
        if (!statsPayload || !statsPayload.data) {
          result.keysFailed++;
          result.errorSummary.push(`Failed to fetch Samsara stats for key ${apiKey.substring(0, 8)}...`);
          continue;
        }

        result.keysSucceeded++;

        // 4. PROCESS VEHICLES FOR THIS KEY
        for (const vehicle of statsPayload.data) {
          const vehicleId = asString(vehicle.id);
          const vehicleName = asString(vehicle.name);

          if (!vehicleId) continue;

          result.vehiclesFound++;

          // Extract fault codes
          const faultCodes = asArray(vehicle.faultCodes);
          if (faultCodes.length === 0) continue;

          for (const faultEntry of faultCodes) {
            const faultRecord = asRecord(faultEntry);
            if (!faultRecord) continue;

            const j1939 = asRecord(faultRecord.j1939);
            const dtcArray = asArray(j1939?.diagnosticTroubleCodes ?? []);

            if (dtcArray.length === 0) continue;

            // Check for check-engine lights
            const lights = asRecord(j1939?.checkEngineLights);
            const warningIsOn = toBool(lights?.warningIsOn);
            const stopIsOn = toBool(lights?.stopIsOn);

            const severity = stopIsOn ? "critical" : warningIsOn ? "warning" : "info";

            // Process each DTC
            for (const dtcRecord of dtcArray) {
              const dtc = asRecord(dtcRecord);
              if (!dtc) continue;

              const spn = asString(dtc.spn);
              const fmi = asString(dtc.fmi);

              if (!spn || !fmi) continue;

              result.alertsAttempted++;

              const eventId = `backfill:${vehicleId}|${spn}|${fmi}`;
              const alert = {
                tenant_id: tenantId,
                event_type: "FaultCode",
                event_id: eventId,
                occurred_at: new Date().toISOString(),
                received_at: new Date().toISOString(),
                vehicle_id: vehicleId,
                vehicle_name: vehicleName || null,
                driver_id: null,
                driver_name: null,
                severity,
                title: `Fault Code ${spn}/${fmi}`,
                description: `Engine fault detected: SPN ${spn}, FMI ${fmi}`,
                status: "open",
                acknowledged_by: null,
                acknowledged_at: null,
                resolved_at: null,
                raw_payload: {
                  source: "backfill",
                  spn,
                  fmi,
                  warningIsOn,
                  stopIsOn,
                  checkEngineLights: lights,
                },
              };

              const upsertResult = await upsertAlert(supabase, alert);
              if (upsertResult.inserted) {
                result.alertsInserted++;
              } else if (upsertResult.isDuplicate) {
                result.alertsDuplicate++;
              } else {
                result.alertsErrored++;
                if (upsertResult.error) {
                  result.errorSummary.push(`Vehicle ${vehicleId}: ${upsertResult.error}`);
                }
              }
            }
          }
        }
      } catch (error) {
        result.keysFailed++;
        result.errorSummary.push(
          `Error processing key: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        console.error("[backfill] Error:", error);
      }
    }

    result.ok = true;
    result.completedAt = new Date().toISOString();
    result.durationMs = Date.now() - startTime;

    // 5. LOG INGESTION
    try {
      const logResult = (await supabase.from("backfill_ingestion_log").insert({
        tenant_id: tenantId,
        triggered_by: username,
        keys_processed: result.keysProcessed,
        keys_succeeded: result.keysSucceeded,
        keys_failed: result.keysFailed,
        vehicles_found: result.vehiclesFound,
        alerts_attempted: result.alertsAttempted,
        alerts_inserted: result.alertsInserted,
        alerts_duplicate: result.alertsDuplicate,
        alerts_errored: result.alertsErrored,
        duration_ms: result.durationMs,
        error_count: result.errorSummary.length,
        error_summary: result.errorSummary.length > 0 ? result.errorSummary.join("; ") : null,
        completed_at: new Date().toISOString(),
      })) as any;

      if (logResult?.data?.[0]?.id) {
        result.ingestionLogId = logResult.data[0].id;
      }
    } catch (logError) {
      console.warn("[backfill] Failed to write ingestion log:", logError instanceof Error ? logError.message : String(logError));
    }

    console.log("[backfill] Complete:", {
      tenantId,
      username,
      inserted: result.alertsInserted,
      duplicate: result.alertsDuplicate,
      errored: result.alertsErrored,
      durationMs: result.durationMs,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    result.errorSummary.push(error instanceof Error ? error.message : String(error));
    result.completedAt = new Date().toISOString();
    result.durationMs = Date.now() - startTime;
    console.error("[backfill] Fatal error:", error);
    return NextResponse.json(result, { status: 500 });
  }
}
