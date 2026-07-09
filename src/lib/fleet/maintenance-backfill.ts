import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pushConfigured, sendPushToTenant } from "@/lib/notifications/push";
import { getHkMaintenancePhoneByTenant, sendSms, smsConfigured } from "@/lib/notifications/sms";

const SAMSARA_STATS_URL = "https://api.samsara.com/fleet/vehicles/stats";

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

export type MaintenanceBackfillWindow = {
  date: string;
  startIso: string;
  endIso: string;
};

export type MaintenanceBackfillTenantInput = {
  supabase: SupabaseClient;
  tenantId: string;
  samsaraApiKeys: string[];
  window: MaintenanceBackfillWindow;
  vehicleFilter?: string;
  dryRun?: boolean;
  notifyOnInsert?: boolean;
};

export type MaintenanceBackfillTenantResult = {
  ok: boolean;
  tenantId: string;
  mode: "dry-run" | "insert";
  date: string;
  window: MaintenanceBackfillWindow;
  vehicleFilter: string;
  keyCount: number;
  matchedVehicles: number;
  snapshotFallbackUsed: boolean;
  faultEntriesScanned: number;
  dtcRowsSeen: number;
  lightOnEntries: number;
  candidateAlerts: number;
  inserted: number;
  duplicates: number;
  errors: number;
  sourceErrors: string[];
  sample?: Array<{
    occurredAt: string;
    vehicleName: string | null;
    faultCode: string | null;
    title: string;
    eventId: string;
  }>;
};

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

function normalizeDateWindow(dateParam: string | null): MaintenanceBackfillWindow {
  const now = new Date();
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : now.toISOString().slice(0, 10);
  const startIso = `${date}T00:00:00.000Z`;
  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endIso = end.toISOString();
  return { date, startIso, endIso };
}

function normalizeLookbackWindow(hours: number): MaintenanceBackfillWindow {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const end = new Date();
  const start = new Date(end.getTime() - safeHours * 60 * 60 * 1000);
  return {
    date: end.toISOString().slice(0, 10),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function buildFaultCode(spnId: string, fmiId: string): string | null {
  if (spnId && fmiId) return `${spnId}/${fmiId}`;
  if (spnId) return spnId;
  if (fmiId) return fmiId;
  return null;
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

async function notifyInsertedAlerts(tenantId: string, alerts: BackfillAlertRow[]): Promise<void> {
  const alertCandidates = alerts.filter((row) => row.canonical_event_type === "EngineFaultOn" && row.severity === "critical");

  if (alertCandidates.length > 0 && pushConfigured()) {
    const preview = alertCandidates
      .slice(0, 3)
      .map((candidate, index) => `${index + 1}. ${candidate.vehicle_name ?? "Unknown vehicle"} - ${candidate.title}`)
      .join(" || ");

    const topCandidate = alertCandidates[0];
    const occurredAt = topCandidate?.occurred_at || new Date().toISOString();
    const alertParams = new URLSearchParams({
      severity: "critical",
      title: `ASF TMS Critical Alert (${alertCandidates.length})`,
      vehicle: topCandidate?.vehicle_name ?? "Fleet vehicle",
      fault: topCandidate?.title ?? "Critical maintenance fault detected",
      summary: `Immediate attention required across ${alertCandidates.length} critical event(s).`,
      action: "Review active faults, contact driver, and dispatch maintenance response.",
      decision: "Confirm go/no-go for this unit before next dispatch commitment.",
      collaboration: "Maintenance owns triage + repair plan; Manager owns route and customer impact decisions.",
      financial: "Estimated exposure: high same-day repair and downtime risk if unresolved.",
      liability: "Liability posture: elevated while critical condition remains open.",
      guidance: "AI guidance: assign owner + ETA now, then post stakeholder update for operations alignment.",
      decisionWindow: "Decision window: immediate (next 10-15 minutes).",
      confidence: "Confidence: strong, based on critical event criteria from telematics backfill.",
      occurredAt,
      highlights: preview || "No additional fault highlights available",
      audience: "maintenance,management",
    });

    const pushResult = await sendPushToTenant(
      {
        tenantId,
      },
      {
        title: `ASF TMS Critical Alert (${alertCandidates.length})`,
        body: (topCandidate ? `${topCandidate.vehicle_name ?? "Fleet vehicle"}: ${topCandidate.title}` : "New critical maintenance alert received.").slice(0, 160),
        url: `/maintenance/alerts?${alertParams.toString()}`,
        tag: "maintenance-critical-alert",
      }
    );

    if (!pushResult.ok && pushResult.errors.length > 0) {
      console.error("[maintenance-backfill] Push send failed:", pushResult.errors[0]);
    }
  }

  if (alertCandidates.length > 0 && smsConfigured()) {
    const smsPhone = await getHkMaintenancePhoneByTenant(tenantId);

    if (!smsPhone) {
      console.error("[maintenance-backfill] SMS target unavailable: hkmaintenance phone not found for tenant");
      return;
    }

    const preview = alertCandidates
      .slice(0, 3)
      .map((candidate, index) => `${index + 1}. ${candidate.vehicle_name ?? "Unknown vehicle"} - ${candidate.title}`)
      .join("\n");
    const smsBody =
      `ASF TMS Alert: ${alertCandidates.length} new EngineFaultOn event(s).\n` +
      `${preview}\n` +
      `Source: cron maintenance backfill ${new Date().toLocaleString()}`;

    const smsResult = await sendSms(smsBody, smsPhone);
    if (!smsResult.ok) {
      console.error("[maintenance-backfill] SMS send failed:", smsResult.error ?? "unknown error");
    }
  }
}

export function normalizeMaintenanceBackfillDateWindow(dateParam: string | null): MaintenanceBackfillWindow {
  return normalizeDateWindow(dateParam);
}

export function normalizeMaintenanceBackfillLookbackWindow(hours: number): MaintenanceBackfillWindow {
  return normalizeLookbackWindow(hours);
}

export async function runMaintenanceBackfillForTenant(
  input: MaintenanceBackfillTenantInput
): Promise<MaintenanceBackfillTenantResult> {
  const vehicleFilter = input.vehicleFilter ?? "";
  const dryRun = input.dryRun ?? true;
  const notifyOnInsert = input.notifyOnInsert ?? false;
  const { date, startIso, endIso } = input.window;

  const keys = input.samsaraApiKeys.filter(Boolean);
  if (keys.length === 0) {
    return {
      ok: true,
      tenantId: input.tenantId,
      mode: dryRun ? "dry-run" : "insert",
      date,
      window: input.window,
      vehicleFilter,
      keyCount: 0,
      matchedVehicles: 0,
      snapshotFallbackUsed: false,
      faultEntriesScanned: 0,
      dtcRowsSeen: 0,
      lightOnEntries: 0,
      candidateAlerts: 0,
      inserted: 0,
      duplicates: 0,
      errors: 0,
      sourceErrors: ["No Samsara API key configured for this tenant."],
    };
  }

  const pendingAlerts: BackfillAlertRow[] = [];
  const sourceErrors: string[] = [];
  let matchedVehicles = 0;
  let faultEntriesScanned = 0;
  let dtcRowsSeen = 0;
  let lightOnEntries = 0;
  let snapshotFallbackUsed = false;

  for (let sourceKeyIndex = 0; sourceKeyIndex < keys.length; sourceKeyIndex += 1) {
    const key = keys[sourceKeyIndex];

    try {
      const vehicles = await fetchStatsForToken(key, startIso, endIso);
      for (const vehicle of vehicles) {
        if (!matchesVehicleFilter(vehicle, vehicleFilter)) continue;
        matchedVehicles += 1;
        const parsed = makeAlertsFromVehicle(input.tenantId, vehicle, date, sourceKeyIndex);
        faultEntriesScanned += parsed.faultEntriesScanned;
        dtcRowsSeen += parsed.dtcRowsSeen;
        lightOnEntries += parsed.lightOnEntries;
        pendingAlerts.push(...parsed.alerts);
      }
    } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : "Unknown Samsara error");
    }
  }

  if (faultEntriesScanned === 0) {
    snapshotFallbackUsed = true;
    for (let sourceKeyIndex = 0; sourceKeyIndex < keys.length; sourceKeyIndex += 1) {
      const key = keys[sourceKeyIndex];
      try {
        const vehicles = await fetchSnapshotStatsForToken(key);
        for (const vehicle of vehicles) {
          if (!matchesVehicleFilter(vehicle, vehicleFilter)) continue;
          const parsed = makeAlertsFromVehicle(input.tenantId, vehicle, date, sourceKeyIndex);
          faultEntriesScanned += parsed.faultEntriesScanned;
          dtcRowsSeen += parsed.dtcRowsSeen;
          lightOnEntries += parsed.lightOnEntries;
          pendingAlerts.push(...parsed.alerts);
        }
      } catch (error) {
        sourceErrors.push(error instanceof Error ? error.message : "Unknown Samsara snapshot error");
      }
    }
  }

  const dedupedByEventId = new Map<string, BackfillAlertRow>();
  for (const row of pendingAlerts) {
    dedupedByEventId.set(`${row.tenant_id}:${row.event_id}`, row);
  }
  const dedupedAlerts = [...dedupedByEventId.values()];

  if (dryRun) {
    return {
      ok: true,
      tenantId: input.tenantId,
      mode: "dry-run",
      date,
      window: input.window,
      vehicleFilter,
      keyCount: keys.length,
      matchedVehicles,
      snapshotFallbackUsed,
      faultEntriesScanned,
      dtcRowsSeen,
      lightOnEntries,
      candidateAlerts: dedupedAlerts.length,
      inserted: 0,
      duplicates: 0,
      errors: 0,
      sourceErrors,
      sample: dedupedAlerts.slice(0, 5).map((row) => ({
        occurredAt: row.occurred_at,
        vehicleName: row.vehicle_name,
        faultCode: row.fault_code,
        title: row.title,
        eventId: row.event_id,
      })),
    };
  }

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  const insertedAlerts: BackfillAlertRow[] = [];

  for (const row of dedupedAlerts) {
    const { error } = await input.supabase.from("maintenance_alerts").insert(row);
    if (error?.code === "23505") {
      duplicates += 1;
      continue;
    }
    if (error) {
      errors += 1;
      continue;
    }

    inserted += 1;
    insertedAlerts.push(row);
  }

  if (notifyOnInsert && insertedAlerts.length > 0) {
    await notifyInsertedAlerts(input.tenantId, insertedAlerts);
  }

  return {
    ok: true,
    tenantId: input.tenantId,
    mode: "insert",
    date,
    window: input.window,
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
  };
}

export async function createServiceRoleClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export type { BackfillAlertRow, OrgKeyRow };