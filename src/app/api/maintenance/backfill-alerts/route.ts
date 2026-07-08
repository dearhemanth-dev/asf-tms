import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";

type OrgKeyRow = {
  tenant_id: string | null;
  samsara_api_key: string | null;
};

type BackfillAlertRow = {
  tenant_id: string;
  event_type: string;
  canonical_event_type: string;
  event_id: string;
  occurred_at: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  organization_external_id: string | null;
  webhook_version: string | null;
  fault_code: string | null;
  fault_description: string | null;
  speed_mph: number | null;
  speed_limit_mph: number | null;
  dvir_defect_count: number | null;
  predictive_alert_code: string | null;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  status: "open";
  raw_payload: Record<string, unknown>;
};

const SAMSARA_STATS_URL = "https://api.samsara.com/fleet/vehicles/stats";

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

function toBool(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
}

function extractDtcRows(faultEntry: Record<string, unknown>): Record<string, unknown>[] {
  const j1939 = asRecord(faultEntry.j1939);
  const candidates: unknown[] = [
    j1939?.diagnosticTroubleCodes,
    faultEntry.diagnosticTroubleCodes,
    faultEntry.dtcs,
    asRecord(faultEntry.faultCode)?.diagnosticTroubleCodes,
  ];

  for (const candidate of candidates) {
    const rows = asArray(candidate)
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => row !== null);
    if (rows.length > 0) return rows;
  }

  return [];
}

function hasAnyLightOn(faultEntry: Record<string, unknown>): boolean {
  const j1939 = asRecord(faultEntry.j1939);
  const lights = asRecord(j1939?.checkEngineLights) ?? asRecord(faultEntry.checkEngineLights);

  if (!lights) return false;

  return (
    toBool(lights.warningIsOn) ||
    toBool(lights.stopIsOn) ||
    toBool(lights.protectIsOn) ||
    toBool(lights.emissionsIsOn) ||
    toBool(lights.malfunctionIndicatorLampIsOn)
  );
}

function matchesVehicleFilter(vehicle: Record<string, unknown>, filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();

  const vehicleRecord = asRecord(vehicle.vehicle);

  const id = asString(vehicle.id) || asString(vehicle.vehicleId) || asString(vehicleRecord?.id);
  const name = asString(vehicle.name) || asString(vehicleRecord?.name);
  const externalIds = asRecord(vehicle.externalIds) ?? asRecord(vehicleRecord?.externalIds);
  const serial = asString(externalIds?.["samsara.serial"]);
  const vin = asString(externalIds?.["samsara.vin"]);

  const haystack = [id, name, serial, vin].map((value) => value.toLowerCase());
  return haystack.some((value) => value.includes(needle));
}

function normalizeDateWindow(dateParam: string | null): { date: string; startIso: string; endIso: string } {
  const now = new Date();
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : now.toISOString().slice(0, 10);
  const startIso = `${date}T00:00:00.000Z`;
  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endIso = end.toISOString();
  return { date, startIso, endIso };
}

function buildFaultCode(spnId: string, fmiId: string): string | null {
  if (spnId && fmiId) return `${spnId}/${fmiId}`;
  if (spnId) return spnId;
  if (fmiId) return fmiId;
  return null;
}

async function fetchStatsForToken(token: string, startIso: string, endIso: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    types: "faultCodes",
    startTime: startIso,
    endTime: endIso,
    limit: "200",
  });

  const response = await fetch(`${SAMSARA_STATS_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = asString(payload.message) || asString(payload.error) || `Samsara stats request failed (${response.status})`;
    throw new Error(message);
  }

  return asArray(payload.data)
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

async function fetchSnapshotStatsForToken(token: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    types: "faultCodes",
    limit: "200",
  });

  const response = await fetch(`${SAMSARA_STATS_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = asString(payload.message) || asString(payload.error) || `Samsara snapshot request failed (${response.status})`;
    throw new Error(message);
  }

  return asArray(payload.data)
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

function toEntryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function extractFaultEntries(vehicle: Record<string, unknown>): unknown[] {
  const vehicleRecord = asRecord(vehicle.vehicle);
  const statsRecord = asRecord(vehicle.stats);

  const candidates = [
    vehicle.faultCodes,
    statsRecord?.faultCodes,
    vehicleRecord?.faultCodes,
    vehicle.faultCode,
    statsRecord?.faultCode,
    vehicleRecord?.faultCode,
  ];

  for (const candidate of candidates) {
    const entries = toEntryArray(candidate);
    if (entries.length > 0) return entries;
  }

  return [];
}

function makeAlertsFromVehicle(
  tenantId: string,
  vehicle: Record<string, unknown>,
  date: string,
  sourceKeyIndex: number
): { alerts: BackfillAlertRow[]; faultEntriesScanned: number; dtcRowsSeen: number; lightOnEntries: number } {
  const vehicleRecord = asRecord(vehicle.vehicle);

  const vehicleId = asString(vehicle.id) || asString(vehicle.vehicleId) || asString(vehicleRecord?.id) || null;
  const vehicleName = asString(vehicle.name) || asString(vehicleRecord?.name) || null;
  const faultCodes = extractFaultEntries(vehicle);
  const alerts: BackfillAlertRow[] = [];
  let faultEntriesScanned = 0;
  let dtcRowsSeen = 0;
  let lightOnEntries = 0;

  for (let faultIndex = 0; faultIndex < faultCodes.length; faultIndex += 1) {
    const faultEntry = asRecord(faultCodes[faultIndex]);
    if (!faultEntry) continue;
    faultEntriesScanned += 1;

    const occurredAt = asString(faultEntry.time) || `${date}T00:00:00.000Z`;
    const anyLightOn = hasAnyLightOn(faultEntry);
    if (anyLightOn) lightOnEntries += 1;

    const dtcs = extractDtcRows(faultEntry);
    dtcRowsSeen += dtcs.length;

    if (dtcs.length === 0 && !anyLightOn) {
      continue;
    }

    if (dtcs.length === 0) {
      const eventId = `retro:${vehicleId ?? "unknown"}:${occurredAt}:lights-on:${faultIndex}`;
      alerts.push({
        tenant_id: tenantId,
        event_type: "EngineFaultOn",
        canonical_event_type: "EngineFaultOn",
        event_id: eventId,
        occurred_at: occurredAt,
        vehicle_id: vehicleId,
        vehicle_name: vehicleName,
        driver_id: null,
        driver_name: null,
        organization_external_id: null,
        webhook_version: "retro-backfill-v1",
        fault_code: null,
        fault_description: "Check engine lights are on",
        speed_mph: null,
        speed_limit_mph: null,
        dvir_defect_count: null,
        predictive_alert_code: null,
        severity: "critical",
        title: `Fault Code: Warning Lights On — ${vehicleName ?? "Unknown vehicle"}`,
        description: "Engine warning/protect/stop/emissions light reported as ON.",
        status: "open",
        raw_payload: {
          source: "retro-backfill",
          sourceKeyIndex,
          vehicle,
          faultEntry,
        },
      });
      continue;
    }

    for (let dtcIndex = 0; dtcIndex < dtcs.length; dtcIndex += 1) {
      const dtc = dtcs[dtcIndex];
      const spnId = String(dtc.spnId ?? "").trim();
      const fmiId = String(dtc.fmiId ?? "").trim();
      const spnDescription = asString(dtc.spnDescription);
      const fmiDescription = asString(dtc.fmiDescription);
      const faultCode = buildFaultCode(spnId, fmiId);
      const faultDescription = [spnDescription, fmiDescription].filter(Boolean).join(" / ") || null;

      const eventId = `retro:${vehicleId ?? "unknown"}:${occurredAt}:${faultCode ?? "dtc"}:${dtcIndex}`;
      alerts.push({
        tenant_id: tenantId,
        event_type: "EngineFaultOn",
        canonical_event_type: "EngineFaultOn",
        event_id: eventId,
        occurred_at: occurredAt,
        vehicle_id: vehicleId,
        vehicle_name: vehicleName,
        driver_id: null,
        driver_name: null,
        organization_external_id: null,
        webhook_version: "retro-backfill-v1",
        fault_code: faultCode,
        fault_description: faultDescription,
        speed_mph: null,
        speed_limit_mph: null,
        dvir_defect_count: null,
        predictive_alert_code: null,
        severity: "critical",
        title: `Fault Code: ${spnDescription || "Unknown fault"} — ${vehicleName ?? "Unknown vehicle"}`,
        description: faultDescription || "Engine fault reported by vehicle diagnostics.",
        status: "open",
        raw_payload: {
          source: "retro-backfill",
          sourceKeyIndex,
          vehicle,
          faultEntry,
          dtc,
        },
      });
    }
  }

  return { alerts, faultEntriesScanned, dtcRowsSeen, lightOnEntries };
}

export async function POST(request: Request): Promise<NextResponse> {
  const startTime = Date.now();
  let httpStatus = 200;
  let logNotes: string[] = [];

  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const vehicleFilter = asString(body.vehicleFilter);
    const dryRun = body.dryRun !== false;
    const triggeredBy = asString(body.triggeredBy) || "manual";
    const { date, startIso, endIso } = normalizeDateWindow(asString(body.date) || null);

    const supabase = getServiceRoleClient();
    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("tenant_id,samsara_api_key")
      .eq("tenant_id", appUser.tenantId)
      .not("samsara_api_key", "is", null);

    if (orgError) {
      httpStatus = 500;
      logNotes.push(`Org key fetch error: ${orgError.message}`);
      return NextResponse.json({ error: orgError.message || "Unable to load Samsara key(s)." }, { status: 500 });
    }

    const keys = (orgRows ?? [])
      .map((row) => ({ tenantId: asString((row as OrgKeyRow).tenant_id), key: asString((row as OrgKeyRow).samsara_api_key) }))
      .filter((row) => row.tenantId && row.key);

    if (keys.length === 0) {
      httpStatus = 200;
      logNotes.push("No Samsara API keys configured");
      
      // Log to backfill ingestion logs
      await supabase.from("maintenance_backfill_ingestion_logs").insert({
        tenant_id: appUser.tenantId,
        triggered_by: triggeredBy,
        date_window: date,
        vehicle_filter: vehicleFilter || null,
        dry_run: dryRun,
        key_count: 0,
        http_status: 200,
        notes: logNotes.join("; "),
      });

      return NextResponse.json(
        {
          error: "No Samsara API key configured for this tenant.",
          date,
          dryRun,
          vehicleFilter,
        },
        { status: 200 }
      );
    }

    const pendingAlerts: BackfillAlertRow[] = [];
    const sourceErrorsByKey = new Map<number, string[]>();
    let matchedVehicles = 0;
    let faultEntriesScanned = 0;
    let dtcRowsSeen = 0;
    let lightOnEntries = 0;
    let snapshotFallbackUsed = false;

    // Fetch from time-windowed stats for each key
    for (let sourceKeyIndex = 0; sourceKeyIndex < keys.length; sourceKeyIndex += 1) {
      const source = keys[sourceKeyIndex];
      const keyErrors = sourceErrorsByKey.get(sourceKeyIndex) ?? [];

      try {
        const vehicles = await fetchStatsForToken(source.key, startIso, endIso);
        for (const vehicle of vehicles) {
          if (!matchesVehicleFilter(vehicle, vehicleFilter)) continue;
          matchedVehicles += 1;
          const parsed = makeAlertsFromVehicle(source.tenantId, vehicle, date, sourceKeyIndex);
          faultEntriesScanned += parsed.faultEntriesScanned;
          dtcRowsSeen += parsed.dtcRowsSeen;
          lightOnEntries += parsed.lightOnEntries;
          pendingAlerts.push(...parsed.alerts);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown Samsara error";
        keyErrors.push(errorMsg);
        logNotes.push(`Key[${sourceKeyIndex}] time-window fetch error: ${errorMsg}`);
      }

      sourceErrorsByKey.set(sourceKeyIndex, keyErrors);
    }

    // Fallback to snapshot if no time-windowed data
    if (faultEntriesScanned === 0) {
      snapshotFallbackUsed = true;
      logNotes.push("Time-window returned 0 entries, using current snapshot fallback");
      
      for (let sourceKeyIndex = 0; sourceKeyIndex < keys.length; sourceKeyIndex += 1) {
        const source = keys[sourceKeyIndex];
        const keyErrors = sourceErrorsByKey.get(sourceKeyIndex) ?? [];

        try {
          const vehicles = await fetchSnapshotStatsForToken(source.key);
          for (const vehicle of vehicles) {
            if (!matchesVehicleFilter(vehicle, vehicleFilter)) continue;
            const parsed = makeAlertsFromVehicle(source.tenantId, vehicle, date, sourceKeyIndex);
            faultEntriesScanned += parsed.faultEntriesScanned;
            dtcRowsSeen += parsed.dtcRowsSeen;
            lightOnEntries += parsed.lightOnEntries;
            pendingAlerts.push(...parsed.alerts);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown Samsara snapshot error";
          keyErrors.push(errorMsg);
          logNotes.push(`Key[${sourceKeyIndex}] snapshot fallback error: ${errorMsg}`);
        }

        sourceErrorsByKey.set(sourceKeyIndex, keyErrors);
      }
    }

    // Deduplicate in-memory (will rely on DB UNIQUE constraint for cross-layer dedup)
    const dedupedByEventId = new Map<string, BackfillAlertRow>();
    for (const row of pendingAlerts) {
      dedupedByEventId.set(`${row.tenant_id}:${row.event_id}`, row);
    }
    const dedupedAlerts = [...dedupedByEventId.values()];

    // Collect source errors for logging
    const sourceErrors: string[] = [];
    sourceErrorsByKey.forEach((errors, keyIndex) => {
      if (errors.length > 0) {
        sourceErrors.push(`Key[${keyIndex}]: ${errors.join("; ")}`);
      }
    });

    // DRY RUN RESPONSE
    if (dryRun) {
      const logEntry = {
        tenant_id: appUser.tenantId,
        triggered_by: triggeredBy,
        date_window: date,
        vehicle_filter: vehicleFilter || null,
        dry_run: true,
        key_count: keys.length,
        matched_vehicles: matchedVehicles,
        fault_entries_scanned: faultEntriesScanned,
        dtc_rows_seen: dtcRowsSeen,
        light_on_entries: lightOnEntries,
        candidate_alerts: dedupedAlerts.length,
        snapshot_fallback_used: snapshotFallbackUsed,
        source_errors: sourceErrors.length > 0 ? sourceErrors : null,
        http_status: 200,
        notes: logNotes.join("; "),
      };

      await supabase.from("maintenance_backfill_ingestion_logs").insert(logEntry);

      return NextResponse.json(
        {
          ok: true,
          mode: "dry-run",
          date,
          window: { startIso, endIso },
          vehicleFilter,
          keyCount: keys.length,
          matchedVehicles,
          snapshotFallbackUsed,
          faultEntriesScanned,
          dtcRowsSeen,
          lightOnEntries,
          candidateAlerts: dedupedAlerts.length,
          sample: dedupedAlerts.slice(0, 5).map((row) => ({
            occurredAt: row.occurred_at,
            vehicleName: row.vehicle_name,
            faultCode: row.fault_code,
            title: row.title,
            eventId: row.event_id,
          })),
          sourceErrors,
        },
        { status: 200 }
      );
    }

    // REAL INSERT
    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    for (const row of dedupedAlerts) {
      const { error } = await supabase.from("maintenance_alerts").insert(row);
      if (error?.code === "23505") {
        duplicates += 1;
        continue;
      }
      if (error) {
        errors += 1;
        logNotes.push(`Insert error: ${error.message}`);
        continue;
      }
      inserted += 1;
    }

    httpStatus = inserted > 0 || duplicates > 0 ? 200 : 400;

    // Log ingestion results
    const logEntry = {
      tenant_id: appUser.tenantId,
      triggered_by: triggeredBy,
      date_window: date,
      vehicle_filter: vehicleFilter || null,
      dry_run: false,
      key_count: keys.length,
      matched_vehicles: matchedVehicles,
      fault_entries_scanned: faultEntriesScanned,
      dtc_rows_seen: dtcRowsSeen,
      light_on_entries: lightOnEntries,
      candidate_alerts: dedupedAlerts.length,
      inserted_count: inserted,
      duplicate_count: duplicates,
      error_count: errors,
      snapshot_fallback_used: snapshotFallbackUsed,
      source_errors: sourceErrors.length > 0 ? sourceErrors : null,
      http_status: httpStatus,
      notes: logNotes.join("; "),
    };

    const { error: logError } = await supabase.from("maintenance_backfill_ingestion_logs").insert(logEntry);
    if (logError) {
      console.error("[backfill] Failed to log ingestion:", logError.message);
    }

    return NextResponse.json(
      {
        ok: true,
        mode: "insert",
        date,
        window: { startIso, endIso },
        vehicleFilter,
        keyCount: keys.length,
        matchedVehicles,
        snapshotFallbackUsed,
        faultEntriesScanned,
        dtcRowsSeen,
        lightOnEntries,
        candidateAlerts: dedupedAlerts.length,
        inserted,
        duplicates,
        errors,
        sourceErrors,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[backfill] Unexpected error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}
