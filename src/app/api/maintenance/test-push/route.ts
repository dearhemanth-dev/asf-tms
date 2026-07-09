import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";
import { cleanupStalePushSubscriptions, pushConfigured, sendPushToTenant } from "@/lib/notifications/push";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[,$\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function money(value: number): string {
  return `$${Math.round(Math.max(0, value)).toLocaleString()}`;
}

const HISTORY_LOOKBACK_DAYS = 365;

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatWindowLabel(startDate: string | null, endDate: string | null, fallback: string): string {
  if (!startDate || !endDate) return fallback;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fallback;

  const sameYear = start.getFullYear() === end.getFullYear();
  const startText = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endText = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${startText} - ${endText}`;
}

function extractUnitNumber(vehicleName: string): string | null {
  const direct = vehicleName.trim();
  if (/^[A-Z0-9-]{3,20}$/i.test(direct)) return direct.toUpperCase();
  const match = direct.match(/\b(\d{3,6})\b/);
  return match ? match[1] : null;
}

function compactForPushUrl(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function hasTrueFlag(value: unknown, keys: string[], depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) return false;
  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  if (Array.isArray(value)) {
    return value.some((item) => hasTrueFlag(item, keys, depth + 1));
  }

  const record = asRecord(value);
  if (!record) return false;

  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (keySet.has(recordKey.toLowerCase()) && toBoolean(recordValue)) {
      return true;
    }
  }

  return Object.values(record).some((nestedValue) => hasTrueFlag(nestedValue, keys, depth + 1));
}

function findFirstValueByKeys(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return undefined;
  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValueByKeys(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (keySet.has(recordKey.toLowerCase()) && recordValue !== null && recordValue !== undefined) {
      return recordValue;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const found = findFirstValueByKeys(nestedValue, keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  const candidateKeys = ["faults", "codes", "active", "items", "data", "dtcs", "faultCodes"];
  for (const key of candidateKeys) {
    const maybeList = record[key];
    if (Array.isArray(maybeList)) return maybeList;
  }
  return [value];
}

function expandFaultCodeEntries(faultCodes: unknown): unknown[] {
  const root = asRecord(faultCodes);
  if (!root) return toList(faultCodes);

  const j1939 = asRecord(root.j1939);
  const dtcs = Array.isArray(j1939?.diagnosticTroubleCodes) ? j1939.diagnosticTroubleCodes : [];
  const checkEngineLights = asRecord(j1939?.checkEngineLights);
  const canBusType = root.canBusType ?? j1939?.canBusType;
  const faultTime = root.time ?? j1939?.time;

  if (dtcs.length > 0) {
    return dtcs.map((entry) => {
      const row = asRecord(entry);
      if (!row) return entry;
      return {
        ...row,
        checkEngineLights,
        canBusType,
        faultTime,
      };
    });
  }

  return [{ ...root, checkEngineLights, canBusType, faultTime }];
}

function deriveAlertRank(row: Record<string, unknown>): number {
  if (hasTrueFlag(row, ["stopEngineLightIsOn", "stopIsOn"])) return 3;
  if (hasTrueFlag(row, ["warningLightIsOn", "warningIsOn"])) return 2;
  if (hasTrueFlag(row, ["checkEngineLightIsOn", "checkIsOn", "emissionsIsOn", "malfunctionIndicatorLampIsOn"])) return 1;
  return 0;
}

type LiveFaultFeedRecord = {
  vehicleName?: string;
  faultCodes: unknown;
};

type LiveCriticalSample = {
  sample: AlertSampleRow | null;
  highlights: string[];
  mechanicDiagnosis: string;
  mechanicPrognosis: string;
  faultBreakdown: string;
};

function normalizeVehicleForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildMechanicPrognosisFromRank(rank: number): string {
  if (rank >= 3) {
    return "Immediate risk: stop unit, inspect fault path, and verify parts availability before returning to route.";
  }
  if (rank === 2) {
    return "High risk: complete repair in current shift and avoid long-haul dispatch until cleared.";
  }
  return "Monitor condition and schedule diagnostic confirmation in maintenance window.";
}

function extractLiveCriticalSampleFromFaultFeed(payload: unknown): LiveCriticalSample {
  const record = asRecord(payload);
  const faults = Array.isArray(record?.faults) ? record?.faults : [];
  const candidates: Array<{
    vehicle: string;
    title: string;
    description: string;
    occurredAt: string;
    mechanicDiagnosis: string;
    mechanicPrognosis: string;
    faultBreakdown: string;
  }> = [];

  for (const fault of faults as LiveFaultFeedRecord[]) {
    const vehicleName = asString((fault as { vehicleName?: string }).vehicleName) || "Fleet vehicle";
    const rows = expandFaultCodeEntries((fault as { faultCodes: unknown }).faultCodes);
    for (const rowValue of rows) {
      const row = asRecord(rowValue);
      if (!row) continue;
      const rank = deriveAlertRank(row);
      if (rank < 3) continue;

      const spn = asString(findFirstValueByKeys(row, ["spn", "suspectParameterNumber", "spnId", "suspect_parameter_number"]));
      const fmi = asString(findFirstValueByKeys(row, ["fmi", "failureModeIdentifier", "failure_mode_identifier", "fmiId"]));
      const spnDescription =
        asString(findFirstValueByKeys(row, ["spnDescription", "suspectParameterDescription", "spn_description", "label", "name"])) ||
        "Component signal";
      const fmiDescription =
        asString(findFirstValueByKeys(row, ["fmiDescription", "failureModeDescription", "fmi_description", "faultDescription", "message"])) ||
        "Fault condition detected";

      const title =
        asString(findFirstValueByKeys(row, ["spnDescription", "suspectParameterDescription", "description", "name", "label"])) ||
        "Critical maintenance fault";
      const description =
        asString(findFirstValueByKeys(row, ["fmiDescription", "failureModeDescription", "faultDescription", "description", "message"])) ||
        title;
      const occurredAt =
        asString(findFirstValueByKeys(row, ["detectedAtTime", "startTime", "time", "timestamp", "occurredAt", "faultTime"])) ||
        new Date().toISOString();

      const faultBreakdown = `SPN ${spn || "-"} / FMI ${fmi || "-"} | ${spnDescription} | ${fmiDescription}`;
      const mechanicDiagnosis = `${spnDescription}: ${fmiDescription}`;
      const mechanicPrognosis = buildMechanicPrognosisFromRank(rank);

      candidates.push({ vehicle: vehicleName, title, description, occurredAt, mechanicDiagnosis, mechanicPrognosis, faultBreakdown });
    }
  }

  candidates.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const top = candidates[0] ?? null;
  return {
    sample: top
      ? {
          id: "live-fault-feed",
          occurred_at: top.occurredAt,
          vehicle_name: top.vehicle,
          title: top.title,
          description: top.description,
          fault_description: top.description,
          severity: "critical",
          event_type: "EngineFaultOn",
          canonical_event_type: "EngineFaultOn",
          status: "open",
        }
      : null,
    highlights: candidates.slice(0, 3).map((candidate, index) => `${index + 1}. ${candidate.vehicle} - ${candidate.title}`),
    mechanicDiagnosis: top?.mechanicDiagnosis || "Critical fault requires immediate diagnostic confirmation.",
    mechanicPrognosis: top?.mechanicPrognosis || "Immediate risk: inspect now and confirm repair readiness.",
    faultBreakdown: top?.faultBreakdown || "SPN/FMI breakdown unavailable from live feed.",
  };
}

function classifyIssue(issue: string): "brake_abs" | "engine_protection" | "aftertreatment" | "electrical" | "powertrain_general" {
  const blob = issue.toLowerCase();
  if (blob.includes("brake") || blob.includes("abs") || blob.includes("retarder") || blob.includes("wheel speed")) return "brake_abs";
  if (blob.includes("oil") || blob.includes("pressure") || blob.includes("lubrication") || blob.includes("coolant") || blob.includes("overheat")) return "engine_protection";
  if (blob.includes("def") || blob.includes("aftertreatment") || blob.includes("dpf") || blob.includes("scr") || blob.includes("nox") || blob.includes("emission")) return "aftertreatment";
  if (blob.includes("voltage") || blob.includes("battery") || blob.includes("alternator") || blob.includes("current") || blob.includes("power")) return "electrical";
  return "powertrain_general";
}

function isLowValueDiagnosticText(value: string): boolean {
  const blob = value.toLowerCase();
  return (
    blob.includes("dvir submitted") ||
    blob.includes("dvir") ||
    blob.includes("inspection submitted") ||
    blob.includes("maintenance event") ||
    blob.includes("driver report")
  );
}

function fallbackEstimate(issue: string): { laborHours: string; partsRange: string; safety: string } {
  switch (classifyIssue(issue)) {
    case "brake_abs":
      return { laborHours: "1.5 - 4.0 hrs", partsRange: "$350 - $1,450", safety: "Safety-critical braking or stability degradation possible if unresolved." };
    case "engine_protection":
      return { laborHours: "2.0 - 8.0 hrs", partsRange: "$300 - $1,800", safety: "High engine-damage risk if the unit continues under heavy load." };
    case "aftertreatment":
      return { laborHours: "2.0 - 8.0 hrs", partsRange: "$900 - $4,500", safety: "Lower direct safety risk, but high derate and service-failure risk." };
    case "electrical":
      return { laborHours: "1.5 - 4.0 hrs", partsRange: "$250 - $1,250", safety: "Potential start/fail or visibility/charging reliability risk." };
    default:
      return { laborHours: "2.0 - 6.0 hrs", partsRange: "$400 - $2,200", safety: "Unknown powertrain reliability risk until diagnostic confirmation." };
  }
}

type AlertSampleRow = {
  id: string;
  occurred_at: string | null;
  vehicle_name: string | null;
  title: string | null;
  description: string | null;
  fault_description: string | null;
  severity: "critical" | "warning" | "info" | null;
  event_type: string | null;
  canonical_event_type?: string | null;
  status?: string | null;
};

function buildFinanceContext(input: {
  severity: string;
  criticalLast24h: number;
  sampleTitle: string;
  historicalSpendWindow: number;
  invoiceCountWindow: number;
  historyWindowLabel: string;
  fleetRankText: string;
  projectedPartsRange: string;
  projectedLaborHours: string;
  topPartHint: string;
}): {
  financial: string;
  liability: string;
  guidance: string;
  decisionWindow: string;
  confidence: string;
} {
  const severity = input.severity.toLowerCase();
  const frequency = input.criticalLast24h;
  const title = input.sampleTitle.toLowerCase();
  const spend = input.historicalSpendWindow;
  const invoices = input.invoiceCountWindow;
  const titleSuggestsPowertrain =
    title.includes("engine") || title.includes("oil") || title.includes("coolant") || title.includes("fault");

  if (severity === "critical" || titleSuggestsPowertrain) {
    return {
      financial: `${input.historyWindowLabel} repair spend for this unit: ${money(spend)} across ${invoices} invoice(s). ${input.fleetRankText} Projected repair window: ${input.projectedLaborHours} labor + ${input.projectedPartsRange} parts.${input.topPartHint ? ` High-value part signal: ${input.topPartHint}.` : ""}`,
      liability: "Liability posture: elevated. Exposure includes roadside failure, service disruption, and preventable asset damage if the unit stays active.",
      guidance:
        "AI guidance: stop debating diagnosis depth first. Make the operating decision now, assign the repair owner, and set a dispatch-safe ETA.",
      decisionWindow: "Decision window: within 10 minutes before next dispatch commitment.",
      confidence: `Confidence: strong (${Math.max(1, frequency)} critical signal(s) in recent feed window).`,
    };
  }

  if (severity === "warning") {
    return {
      financial: `${input.historyWindowLabel} repair spend for this unit: ${money(spend)} across ${invoices} invoice(s). ${input.fleetRankText} Projected repair window: ${input.projectedLaborHours} labor + ${input.projectedPartsRange} parts.${input.topPartHint ? ` High-value part signal: ${input.topPartHint}.` : ""}`,
      liability: "Liability posture: medium; monitor for escalation into safety-impacting condition.",
      guidance: "AI guidance: schedule maintenance slot this shift and track repeat frequency by vehicle.",
      decisionWindow: "Decision window: this shift before route finalization.",
      confidence: `Confidence: medium (${Math.max(1, frequency)} critical signal(s) in last 24h across tenant).`,
    };
  }

  return {
    financial: `${input.historyWindowLabel} repair spend for this unit: ${money(spend)} across ${invoices} invoice(s). ${input.fleetRankText} Projected repair window: ${input.projectedLaborHours} labor + ${input.projectedPartsRange} parts.${input.topPartHint ? ` High-value part signal: ${input.topPartHint}.` : ""}`,
    liability: "Liability posture: low currently; keep monitoring policy active.",
    guidance: "AI guidance: keep under observation and auto-escalate if repeated in next reporting cycle.",
    decisionWindow: "Decision window: before next planned maintenance review.",
    confidence: `Confidence: medium (limited urgency signals; ${Math.max(1, frequency)} critical signal(s) in 24h baseline).`,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (appUser.username.trim().toLowerCase() !== "hkmaintenance") {
      return NextResponse.json({ error: "Forbidden: hkmaintenance only." }, { status: 403 });
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

    const supabaseUrl = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceRoleKey = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: false, error: "Supabase service role credentials are not configured." }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const baseSampleQuery = appUser.tenantId
      ? supabase
          .from("maintenance_alerts")
          .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status")
          .eq("tenant_id", appUser.tenantId)
      : supabase
          .from("maintenance_alerts")
          .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status");

    const { data: criticalOpenEngineFaultRows } = await baseSampleQuery
      .eq("status", "open")
      .eq("severity", "critical")
      .eq("canonical_event_type", "EngineFaultOn")
      .order("occurred_at", { ascending: false })
      .limit(1);

    let sample = ((criticalOpenEngineFaultRows ?? [])[0] ?? null) as AlertSampleRow | null;

    if (!sample) {
      const { data: criticalOpenRows } = await (appUser.tenantId
        ? supabase
            .from("maintenance_alerts")
            .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status")
            .eq("tenant_id", appUser.tenantId)
            .eq("status", "open")
            .eq("severity", "critical")
            .order("occurred_at", { ascending: false })
            .limit(1)
        : supabase
            .from("maintenance_alerts")
            .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status")
            .eq("status", "open")
            .eq("severity", "critical")
            .order("occurred_at", { ascending: false })
            .limit(1));

      sample = ((criticalOpenRows ?? [])[0] ?? null) as AlertSampleRow | null;
    }

    if (!sample) {
      const { data: criticalRows } = await (appUser.tenantId
        ? supabase
            .from("maintenance_alerts")
            .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status")
            .eq("tenant_id", appUser.tenantId)
            .eq("severity", "critical")
            .order("occurred_at", { ascending: false })
            .limit(1)
        : supabase
            .from("maintenance_alerts")
            .select("id, occurred_at, vehicle_name, title, description, fault_description, severity, event_type, canonical_event_type, status")
            .eq("severity", "critical")
            .order("occurred_at", { ascending: false })
            .limit(1));

      sample = ((criticalRows ?? [])[0] ?? null) as AlertSampleRow | null;
    }

    let liveFeedHighlights: string[] = [];
    let liveMechanicDiagnosis = "";
    let liveMechanicPrognosis = "";
    let liveFaultBreakdown = "";

    if (!sample) {
      const origin = new URL(request.url).origin;
      const liveResponse = await fetch(`${origin}/api/fleet/fault-codes`, {
        headers: {
          cookie: request.headers.get("cookie") ?? "",
        },
        cache: "no-store",
      }).catch(() => null);

      if (liveResponse?.ok) {
        const livePayload = (await liveResponse.json().catch(() => ({}))) as Record<string, unknown>;
        const liveSample = extractLiveCriticalSampleFromFaultFeed(livePayload);
        sample = liveSample.sample;
        liveFeedHighlights = liveSample.highlights;
        liveMechanicDiagnosis = liveSample.mechanicDiagnosis;
        liveMechanicPrognosis = liveSample.mechanicPrognosis;
        liveFaultBreakdown = liveSample.faultBreakdown;
      }
    }

    if (!sample) {
      return NextResponse.json(
        {
          ok: false,
          error: "No critical fault sample is currently available from either saved alerts or the live fault-code feed.",
        },
        { status: 200 }
      );
    }

    const { data: recentRows } = await (appUser.tenantId
      ? supabase
          .from("maintenance_alerts")
          .select("vehicle_name, title")
          .eq("tenant_id", appUser.tenantId)
          .order("occurred_at", { ascending: false })
          .limit(3)
      : supabase
          .from("maintenance_alerts")
          .select("vehicle_name, title")
          .order("occurred_at", { ascending: false })
          .limit(3));

        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const criticalCountQuery = appUser.tenantId
          ? supabase
            .from("maintenance_alerts")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", appUser.tenantId)
            .eq("severity", "critical")
            .gte("occurred_at", sinceIso)
          : supabase
            .from("maintenance_alerts")
            .select("id", { count: "exact", head: true })
            .eq("severity", "critical")
            .gte("occurred_at", sinceIso);

        const { count: criticalLast24h } = await criticalCountQuery;

    const highlights = (recentRows ?? [])
      .map((row, index) => {
        const vehicleName = asString(row.vehicle_name);
        const titleText = asString(row.title);
        if (!vehicleName && !titleText) return "";
        return `${index + 1}. ${vehicleName || "Vehicle"} - ${titleText || "Maintenance event"}`;
      })
      .filter(Boolean)
      .join(" || ") || liveFeedHighlights.join(" || ");

    const occurredAt = asString(sample?.occurred_at) || new Date().toISOString();
    const sampleSeverity = "critical";
    const sampleVehicle = asString(sample?.vehicle_name) || "Fleet vehicle";
    const sampleTitle = asString(sample?.title) || "Critical maintenance alert";
    const sampleFaultDescription = asString(sample?.fault_description);
    const sampleDescription = sampleFaultDescription || asString(sample?.description) || "Immediate maintenance review required.";
    const sampleFaultBreakdown = `Unit ${sampleVehicle} | Event ${asString(sample?.event_type) || "EngineFaultOn"} | Occurred ${occurredAt}`;
    const diagnosisCandidate = liveMechanicDiagnosis || sampleFaultDescription || asString(sample?.title) || sampleDescription;
    const mechanicDiagnosis = isLowValueDiagnosticText(diagnosisCandidate)
      ? `${sampleTitle}: ${sampleDescription}`
      : diagnosisCandidate;
    const mechanicPrognosis =
      liveMechanicPrognosis ||
      "Immediate risk: verify failure mode, confirm parts path, and hold release until repair is confirmed.";
    const faultBreakdown = liveFaultBreakdown || sampleFaultBreakdown;
    const eventType = asString(sample?.event_type) || "EngineFaultOn";
    const sampleStatus = asString(sample?.status) || "open";
    const unitNumber = extractUnitNumber(sampleVehicle);
    const estimate = fallbackEstimate(`${sampleTitle} ${sampleDescription}`);

    let historicalSpendWindow = 0;
    let invoiceCountWindow = 0;
    let topPartHint = "";
    let fleetWindowBaseline = "";
    let historyWindowLabel = "Rolling 12-month history";
    let fleetRankText = "Fleet cost rank unavailable.";

    const historyWindowEnd = formatDateOnly(new Date());
    const historyWindowStartDate = new Date();
    historyWindowStartDate.setDate(historyWindowStartDate.getDate() - HISTORY_LOOKBACK_DAYS);
    const historyWindowStart = formatDateOnly(historyWindowStartDate);

    if (unitNumber) {
      const { data: repairHeaders } = await supabase
        .from("repairs_expense_headers")
        .select("id,total_amount,invoice_date,unit_number")
        .eq("tenant_id", appUser.tenantId)
        .eq("unit_number", unitNumber)
        .gte("invoice_date", historyWindowStart)
        .lte("invoice_date", historyWindowEnd)
        .order("invoice_date", { ascending: false })
        .limit(100);

      const headerIds = (repairHeaders ?? []).map((row) => String(row.id ?? "")).filter(Boolean);
      historicalSpendWindow = (repairHeaders ?? []).reduce((sum, row) => sum + asNumber(row.total_amount), 0);
      invoiceCountWindow = (repairHeaders ?? []).length;

      const invoiceDates = (repairHeaders ?? [])
        .map((row) => asString(row.invoice_date))
        .filter(Boolean)
        .sort();
      if (invoiceDates.length > 0) {
        historyWindowLabel = formatWindowLabel(invoiceDates[0], invoiceDates[invoiceDates.length - 1], historyWindowLabel);
      }

      if (headerIds.length > 0) {
        const { data: lineItems } = await supabase
          .from("repairs_expense_line_items")
          .select("description,amount")
          .eq("tenant_id", appUser.tenantId)
          .in("header_id", headerIds)
          .order("amount", { ascending: false })
          .limit(5);

        const topParts = (lineItems ?? [])
          .map((row) => ({ description: asString(row.description), amount: asNumber(row.amount) }))
          .filter((row) => row.description && row.amount > 0)
          .slice(0, 2)
          .map((row) => `${row.description} (${money(row.amount)})`);

        topPartHint = topParts.join("; ");
      }
    }

    const unitSpendMap = new Map<string, { total: number; invoices: number }>();
    let rangeFrom = 0;
    const batchSize = 1000;
    while (true) {
      const rangeTo = rangeFrom + batchSize - 1;
      const { data: fleetRows, error: fleetRowsError } = await supabase
        .from("repairs_expense_headers")
        .select("unit_number,total_amount,invoice_date")
        .eq("tenant_id", appUser.tenantId)
        .gte("invoice_date", historyWindowStart)
        .lte("invoice_date", historyWindowEnd)
        .range(rangeFrom, rangeTo);

      if (fleetRowsError) {
        break;
      }

      const rows = fleetRows ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const unit = asString(row.unit_number) || "UNASSIGNED";
        const existing = unitSpendMap.get(unit) ?? { total: 0, invoices: 0 };
        existing.total += asNumber(row.total_amount);
        existing.invoices += 1;
        unitSpendMap.set(unit, existing);
      }

      if (rows.length < batchSize) break;
      rangeFrom += batchSize;
    }

    const rankedUnits = Array.from(unitSpendMap.entries())
      .map(([unit, summary]) => ({ unit, total: summary.total, invoices: summary.invoices }))
      .sort((left, right) => right.total - left.total);

    if (rankedUnits.length > 0) {
      fleetWindowBaseline = rankedUnits
        .slice(0, 3)
        .map((row) => `${row.unit} ${money(row.total)}`)
        .join(" | ");

      if (unitNumber) {
        const unitRank = rankedUnits.findIndex((row) => row.unit === unitNumber);
        if (unitRank >= 0) {
          fleetRankText = `Fleet repair-cost rank in rolling history: ${unitRank + 1} of ${rankedUnits.length}.`;
        }
      }
    }

    const finance = buildFinanceContext({
      severity: sampleSeverity,
      criticalLast24h: criticalLast24h ?? 0,
      sampleTitle,
      historicalSpendWindow,
      invoiceCountWindow,
      historyWindowLabel,
      fleetRankText,
      projectedPartsRange: estimate.partsRange,
      projectedLaborHours: estimate.laborHours,
      topPartHint,
    });

    const summary =
      `TEST MODE: Live open critical fault selected from your feed for client demo and maintenance onboarding. ` +
      `Unit ${sampleVehicle} is the latest high-priority case requiring command attention. ` +
      `Critical alerts in last 24h: ${criticalLast24h ?? 0}.`;

    const decision =
      "Decision now: continue under controlled watch, divert to nearest repair point, or remove from dispatch immediately.";

    const action =
      "Assign an accountable owner, publish repair ETA, and record a go/no-go fleet decision before the next dispatch move.";

    const safety = `${estimate.safety} Driver safety and asset preservation should override schedule convenience until triage is complete.`;

    const alertParams = new URLSearchParams({
      severity: sampleSeverity,
      title: "ASF TMS Critical Alert Test",
      headline: compactForPushUrl(sampleTitle, 96),
      vehicle: compactForPushUrl(sampleVehicle, 56),
      fault: compactForPushUrl(sampleDescription, 170),
      summary: compactForPushUrl(summary, 180),
      action: compactForPushUrl(action, 140),
      decision: compactForPushUrl(decision, 120),
      financial: compactForPushUrl(finance.financial, 140),
      liability: compactForPushUrl(finance.liability, 120),
      safety: compactForPushUrl(safety, 120),
      projectedRepair: compactForPushUrl(`${estimate.laborHours} labor + ${estimate.partsRange} parts (planning window).`, 110),
      historicalSpend: compactForPushUrl(`${historyWindowLabel}: ${money(historicalSpendWindow)} across ${invoiceCountWindow} repair invoice(s).`, 110),
      occurredAt,
      mechanicDiagnosis: compactForPushUrl(mechanicDiagnosis, 140),
      mechanicPrognosis: compactForPushUrl(mechanicPrognosis, 140),
      faultBreakdown: compactForPushUrl(faultBreakdown, 140),
      audience: "maintenance,management",
      role: "maintenance",
      testMode: "1",
      sourceEventType: eventType,
      sourceStatus: sampleStatus,
    });

    let subscriptionQuery = supabase
      .from("maintenance_push_subscriptions")
      .select("username, endpoint")
      .order("last_seen_at", { ascending: false })
      .limit(250);

    if (appUser.tenantId) {
      subscriptionQuery = subscriptionQuery.eq("tenant_id", appUser.tenantId);
    }

    const { data: subscriptionRows, error: subscriptionError } = await subscriptionQuery;
    if (subscriptionError) {
      return NextResponse.json({ ok: false, error: subscriptionError.message }, { status: 200 });
    }

    const targetUsernames = Array.from(
      new Set(
        (subscriptionRows ?? [])
          .map((row) => (typeof row.username === "string" ? row.username.trim() : ""))
          .filter(Boolean)
      )
    );

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

    if ((subscriptionRows ?? []).length === 0 || targetUsernames.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: appUser.tenantId
            ? "No registered devices found for this tenant."
            : "No registered devices found for this user set.",
        },
        { status: 200 }
      );
    }

    const aggregate = {
      attempted: 0,
      sent: 0,
      removed: 0,
      errors: [] as string[],
    };

    const startedAt = new Date().toISOString();
    if (appUser.tenantId) {
      const result = await sendPushToTenant(
        {
          tenantId: appUser.tenantId,
        },
        {
          title: `ASF TMS CRITICAL TEST - ${sampleVehicle}`,
          body: `Immediate attention drill: ${sampleTitle}. Confirm all phones receive now.`,
          url: `/maintenance/alerts?${alertParams.toString()}`,
          tag: "maintenance-team-broadcast-test",
        }
      );

      aggregate.attempted += result.attempted;
      aggregate.sent += result.sent;
      aggregate.removed += result.removed;
      aggregate.errors.push(...result.errors);
    } else {
      const fanoutResults = await Promise.all(
        targetUsernames.map((username) =>
          sendPushToTenant(
            {
              tenantId: null,
              username,
            },
            {
              title: `ASF TMS CRITICAL TEST - ${sampleVehicle}`,
              body: `Immediate attention drill: ${sampleTitle}. Confirm all phones receive now.`,
              url: `/maintenance/alerts?${alertParams.toString()}`,
              tag: "maintenance-team-broadcast-test",
            }
          )
        )
      );

      for (const result of fanoutResults) {
        aggregate.attempted += result.attempted;
        aggregate.sent += result.sent;
        aggregate.removed += result.removed;
        aggregate.errors.push(...result.errors);
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));

    if (aggregate.attempted === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No registered push devices found for this broadcast test.",
        },
        { status: 200 }
      );
    }

    const delivered = aggregate.sent > 0;
    const uniqueErrors = Array.from(new Set(aggregate.errors.filter(Boolean)));
    const failureReason =
      delivered
        ? undefined
        : uniqueErrors[0]
          ? `Push delivery failed (${aggregate.sent}/${aggregate.attempted}). ${uniqueErrors[0]}.`
          : `Push delivery failed (${aggregate.sent}/${aggregate.attempted}). No delivery acknowledgements were received.`;

    return NextResponse.json({
      ok: delivered,
      error: failureReason,
      attempted: aggregate.attempted,
      sent: aggregate.sent,
      removed: aggregate.removed,
      staleRemoved,
      errors: aggregate.errors,
      targets: targetUsernames,
      targetUserCount: targetUsernames.length,
      startedAt,
      completedAt,
      durationMs,
      mode: appUser.tenantId ? "tenant_broadcast" : "username_fanout",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
