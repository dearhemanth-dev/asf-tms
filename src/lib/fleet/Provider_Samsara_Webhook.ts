import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { pushConfigured, sendPushToTenant } from "@/lib/notifications/push";
import { getHkMaintenancePhoneByTenant, sendSms, smsConfigured } from "@/lib/notifications/sms";

const SAMSARA_SIGNATURE_HEADER = "x-samsara-signature";
const WEBHOOK_PROVIDER = "samsara";
const WEBHOOK_ENDPOINT = "/api/webhooks/samsara";

type Severity = "critical" | "warning" | "info";

type WebhookSecretEntry = {
  secret: string;
  tenantId: string | null;
};

type CanonicalEventType =
  | "EngineFaultOn"
  | "DvirSubmitted"
  | "SevereSpeedingStarted"
  | "SevereSpeedingEnded"
  | "PredictiveMaintenanceAlert"
  | "Unknown";

type IngestionBucket = {
  tenantId: string | null;
  receivedCount: number;
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
  eventTypes: Set<string>;
  sampleProviderEventIds: Set<string>;
};

type WebhookIngressRow = {
  provider: string;
  endpoint: string;
  tenant_id: string | null;
  signature_valid: boolean;
  received_count: number;
  inserted_count: number;
  duplicate_count: number;
  error_count: number;
  event_types: string;
  sample_event_types: string;
  provider_event_id: string | null;
  http_status: number;
  notes: string | null;
};

const EVENT_ALIASES: Record<string, CanonicalEventType> = {
  enginefaulton: "EngineFaultOn",
  faultcoderaised: "EngineFaultOn",
  dvirsubmitted: "DvirSubmitted",
  dvirdefectreported: "DvirSubmitted",
  severespeedingstarted: "SevereSpeedingStarted",
  severespeedingended: "SevereSpeedingEnded",
  speedingintervalcompleted: "SevereSpeedingEnded",
  predictivemaintenancealert: "PredictiveMaintenanceAlert",
};

const SEVERITY_BY_EVENT: Record<CanonicalEventType, Severity> = {
  EngineFaultOn: "critical",
  DvirSubmitted: "info",
  SevereSpeedingStarted: "warning",
  SevereSpeedingEnded: "warning",
  PredictiveMaintenanceAlert: "critical",
  Unknown: "info",
};

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstStringInRecord(record: Record<string, unknown> | null | undefined): string {
  if (!record) return "";
  for (const value of Object.values(record)) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function toSignatureCandidates(signatureHeader: string): string[] {
  const raw = signatureHeader.trim();
  if (!raw) return [];

  const candidates = new Set<string>();
  candidates.add(raw);

  const chunks = raw.split(",").map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    candidates.add(chunk);
    if (chunk.includes("=")) {
      const [, value] = chunk.split("=", 2);
      if (value) candidates.add(value.trim());
    }
  }

  return [...candidates];
}

function toSecretKeyCandidates(secret: string): Buffer[] {
  const normalized = secret.trim();
  if (!normalized) return [];

  const candidates = [Buffer.from(normalized, "utf8")];

  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/g, "") === normalized.replace(/\s+/g, "").replace(/=+$/g, "")) {
      candidates.push(decoded);
    }
  } catch {
    // Fall back to the raw string candidate.
  }

  return candidates;
}

function canonicalizeEventType(rawType: string): CanonicalEventType {
  const normalized = rawType.trim().toLowerCase();
  return EVENT_ALIASES[normalized] ?? "Unknown";
}

function toReadableEventType(rawType: string, canonicalType: CanonicalEventType): string {
  switch (canonicalType) {
    case "EngineFaultOn":
      return "Engine Fault On";
    case "DvirSubmitted":
      return "DVIR Submitted";
    case "SevereSpeedingStarted":
      return "Severe Speeding Started";
    case "SevereSpeedingEnded":
      return "Severe Speeding Ended";
    case "PredictiveMaintenanceAlert":
      return "Predictive Maintenance Alert";
    default:
      return rawType
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim();
  }
}

function resolveTenantId(event: Record<string, unknown>, fallbackTenantId: string | null): string {
  const orgRecord = asRecord(event.organization);
  const externalIdsRecord = asRecord(orgRecord?.externalIds);
  const tenantRecord = asRecord(event.tenant);

  const candidates = [
    asString(tenantRecord?.id),
    asString(event.tenant),
    asString(event.tenantId),
    asString(event.organizationId),
    asString(orgRecord?.id),
    asString(orgRecord?.externalId),
    asString(orgRecord?.externalIds),
    firstStringInRecord(externalIdsRecord),
    fallbackTenantId ?? "",
  ];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  return "unknown";
}

function parseOccurredAt(event: Record<string, unknown>): string {
  const explicit = asString(event.occurredAt);
  if (explicit) return explicit;

  const eventMs = asNumber(event.eventMs);
  if (eventMs !== null && Number.isFinite(eventMs)) {
    try {
      return new Date(eventMs).toISOString();
    } catch {
      // Fall through to now.
    }
  }

  return new Date().toISOString();
}

function extractFaultDetails(event: Record<string, unknown>): {
  faultCode: string | null;
  faultDescription: string | null;
} {
  const faultCodeRecord = asRecord(event.faultCode);
  const spn = asString(faultCodeRecord?.spn ?? event.spn);
  const fmi = asString(faultCodeRecord?.fmi ?? event.fmi);
  const directCode = asString(faultCodeRecord?.code ?? event.faultCode);

  const spnDescription = asString(faultCodeRecord?.spnDescription ?? event.spnDescription);
  const fmiDescription = asString(faultCodeRecord?.fmiDescription ?? event.fmiDescription);
  const directDescription = asString(event.description);

  const faultCode = directCode || (spn && fmi ? `${spn}/${fmi}` : spn || fmi || "") || null;
  const faultDescription = spnDescription || fmiDescription || directDescription || null;

  return { faultCode, faultDescription };
}

function extractPredictiveCode(event: Record<string, unknown>): string | null {
  const predictiveRecord = asRecord(event.predictiveMaintenance);
  return (
    asString(event.alertCode) ||
    asString(event.alertType) ||
    asString(predictiveRecord?.alertCode) ||
    asString(predictiveRecord?.alertType) ||
    null
  );
}

function extractSpeedMetrics(event: Record<string, unknown>): {
  speedMph: number | null;
  speedLimitMph: number | null;
} {
  const speedingRecord = asRecord(event.speeding);
  const speedMph =
    asNumber(event.speedMph) ??
    asNumber(event.speed) ??
    asNumber(speedingRecord?.speedMph) ??
    asNumber(speedingRecord?.speed);

  const speedLimitMph =
    asNumber(event.speedLimitMph) ??
    asNumber(event.speedLimit) ??
    asNumber(speedingRecord?.speedLimitMph) ??
    asNumber(speedingRecord?.speedLimit);

  return { speedMph, speedLimitMph };
}

function extractDvirDefectCount(event: Record<string, unknown>): number | null {
  const defects = event.defects;
  if (Array.isArray(defects)) return defects.length;
  return asNumber(event.defectCount);
}

function newBucket(tenantId: string | null): IngestionBucket {
  return {
    tenantId,
    receivedCount: 0,
    insertedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    eventTypes: new Set<string>(),
    sampleProviderEventIds: new Set<string>(),
  };
}

function touchBucket(map: Map<string, IngestionBucket>, tenantId: string | null): IngestionBucket {
  const key = tenantId ?? "__unknown__";
  const existing = map.get(key);
  if (existing) return existing;
  const created = newBucket(tenantId);
  map.set(key, created);
  return created;
}

async function logWebhookIngress(
  supabase: any,
  buckets: Map<string, IngestionBucket>,
  options: {
    signatureValid: boolean;
    httpStatus: number;
    notes?: string;
  }
) {
  const toReadableList = (values: Set<string>) => [...values].join(", ");

  const rows: WebhookIngressRow[] = [...buckets.values()].map((bucket) => ({
    provider: WEBHOOK_PROVIDER,
    endpoint: WEBHOOK_ENDPOINT,
    tenant_id: bucket.tenantId,
    signature_valid: options.signatureValid,
    received_count: bucket.receivedCount,
    inserted_count: bucket.insertedCount,
    duplicate_count: bucket.duplicateCount,
    error_count: bucket.errorCount,
    event_types: toReadableList(bucket.eventTypes),
    sample_event_types: toReadableList(bucket.eventTypes),
    provider_event_id: [...bucket.sampleProviderEventIds][0] ?? null,
    http_status: options.httpStatus,
    notes: options.notes ?? null,
  }));

  if (rows.length === 0) {
    rows.push({
      provider: WEBHOOK_PROVIDER,
      endpoint: WEBHOOK_ENDPOINT,
      tenant_id: null,
      signature_valid: options.signatureValid,
      received_count: 0,
      inserted_count: 0,
      duplicate_count: 0,
      error_count: 0,
      event_types: "",
      sample_event_types: "",
      provider_event_id: null,
      http_status: options.httpStatus,
      notes: options.notes ?? null,
    });
  }

  const { error } = await supabase.from("webhook_ingestion_logs").insert(rows as never[]);
  if (error) {
    console.error("[samsara-webhook] Unable to write ingestion log:", error.message);
  }
}

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role credentials not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getWebhookSecrets() {
  const entries = new Map<string, WebhookSecretEntry>();
  const envSecret = process.env.SAMSARA_WEBHOOK_SECRET?.trim();
  if (envSecret) entries.set(`env:${envSecret}`, { secret: envSecret, tenantId: null });

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("tenant_id,samsara_webhook_secret")
    .not("samsara_webhook_secret", "is", null);

  if (error) {
    console.error("[samsara-webhook] Unable to load organization webhook secrets:", error.message);
    return [...entries.values()];
  }

  for (const row of data ?? []) {
    const secret = asString(row.samsara_webhook_secret);
    if (!secret) continue;
    entries.set(`org:${secret}`, {
      secret,
      tenantId: asString(row.tenant_id) || null,
    });
  }

  return [...entries.values()];
}

function verifySignature(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
  if (!timestamp || !signature || !secret) return false;
  try {
    const signatures = toSignatureCandidates(signature);
    if (signatures.length === 0) return false;

    const secrets = toSecretKeyCandidates(secret);
    if (secrets.length === 0) return false;

    const message = `v1:${timestamp.trim()}:${rawBody}`;

    for (const webhookSecret of secrets) {
      const expectedHex = createHmac("sha256", webhookSecret).update(message, "utf8").digest("hex");
      const expectedSignature = `v1=${expectedHex}`;

      for (const actual of signatures) {
        const candidates = [expectedSignature, expectedHex];
        for (const expected of candidates) {
          const actualBuf = Buffer.from(actual, "utf8");
          const expectedBuf = Buffer.from(expected, "utf8");
          if (actualBuf.length !== expectedBuf.length) continue;
          if (timingSafeEqual(actualBuf, expectedBuf)) return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

function classifyEvent(canonicalType: CanonicalEventType, payload: Record<string, unknown>): {
  title: string;
  description: string;
  severity: Severity;
} {
  const vehicle = asString(asRecord(payload.vehicle)?.name ?? payload.vehicleName);
  const driver = asString(asRecord(payload.driver)?.name ?? payload.driverName);

  const base = vehicle || "Unknown vehicle";

  switch (canonicalType) {
    case "EngineFaultOn": {
      const spn = asString(asRecord(payload.faultCode)?.spnDescription ?? payload.spnDescription ?? "");
      const fmi = asString(asRecord(payload.faultCode)?.fmiDescription ?? payload.fmiDescription ?? "");
      return {
        title: `Fault Code: ${spn || "Unknown fault"} — ${base}`,
        description: fmi ? `${spn} / ${fmi}` : spn,
        severity: "critical",
      };
    }
    case "DvirSubmitted":
      return {
        title: `DVIR Submitted — ${base}`,
        description: driver ? `Submitted by ${driver}` : "Pre/post-trip inspection completed",
        severity: "info",
      };
    case "SevereSpeedingStarted":
      return {
        title: `Severe Speeding Started — ${base}`,
        description: driver ? `Driver: ${driver}` : "Harsh braking event detected",
        severity: "warning",
      };
    case "SevereSpeedingEnded":
      return {
        title: `Severe Speeding Ended — ${base}`,
        description: driver ? `Driver: ${driver}` : "Speeding interval recorded",
        severity: "warning",
      };
    case "PredictiveMaintenanceAlert":
      return {
        title: `Predictive Maintenance Alert — ${base}`,
        description: asString(payload.alertType ?? payload.alertCode ?? "Potential maintenance issue detected"),
        severity: "critical",
      };
    default:
      return {
        title: `${asString(payload.eventType ?? payload.type) || "Unknown Event"} — ${base}`,
        description: "",
        severity: SEVERITY_BY_EVENT.Unknown,
      };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = getServiceRoleClient();
  const secrets = await getWebhookSecrets();
  if (secrets.length === 0) {
    console.error("[samsara-webhook] No webhook secrets configured");
    const emptyBuckets = new Map<string, IngestionBucket>();
    await logWebhookIngress(supabase, emptyBuckets, {
      signatureValid: false,
      httpStatus: 500,
      notes: "Webhook not configured",
    });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-samsara-timestamp") ?? request.headers.get("X-Samsara-Timestamp") ?? "";
  const signature = request.headers.get(SAMSARA_SIGNATURE_HEADER) ?? "";

  const matchingSecrets = secrets.filter((entry) => verifySignature(rawBody, timestamp, signature, entry.secret));
  const matchingSecret = matchingSecrets.find((entry) => Boolean(entry.tenantId)) ?? matchingSecrets[0];

  if (!matchingSecret) {
    console.warn("[samsara-webhook] Signature verification failed");
    const failedBuckets = new Map<string, IngestionBucket>();
    failedBuckets.set("__unknown__", newBucket(null));
    await logWebhookIngress(supabase, failedBuckets, {
      signatureValid: false,
      httpStatus: 401,
      notes: "Invalid signature",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    const failedBuckets = new Map<string, IngestionBucket>();
    failedBuckets.set("__unknown__", newBucket(matchingSecret.tenantId));
    await logWebhookIngress(supabase, failedBuckets, {
      signatureValid: true,
      httpStatus: 400,
      notes: "Invalid JSON",
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyRecord = asRecord(body);
  const nestedEvents = bodyRecord?.events;
  const nestedData = bodyRecord?.data;
  const events: unknown[] = Array.isArray(nestedEvents)
    ? nestedEvents
    : Array.isArray(nestedData)
    ? nestedData
    : Array.isArray(body)
    ? (body as unknown[])
    : [body];

  const buckets = new Map<string, IngestionBucket>();
  let inserted = 0;
  let duplicates = 0;
  let eventErrors = 0;
  const alertCandidates: Array<{ tenantId: string; vehicle: string; title: string; occurredAt: string }> = [];

  for (const raw of events) {
    const eventRecord = asRecord(raw);
    const nestedEvent = asRecord(eventRecord?.event);
    const nestedPayload = asRecord(eventRecord?.payload);
    const event = nestedEvent ?? nestedPayload ?? eventRecord;
    if (!event) continue;

    const rawEventType = asString(event.eventType ?? event.type);
    if (!rawEventType) continue;

    const canonicalEventType = canonicalizeEventType(rawEventType);
    const readableEventType = toReadableEventType(rawEventType, canonicalEventType);

    const vehicleRec = asRecord(event.vehicle);
    const driverRec = asRecord(event.driver);
    const resolvedTenantId = resolveTenantId(event, matchingSecret.tenantId);
    const tenantId = resolvedTenantId === "unknown" ? matchingSecret.tenantId ?? "unknown" : resolvedTenantId;
    const bucket = touchBucket(buckets, tenantId === "unknown" ? null : tenantId);
    bucket.receivedCount += 1;
    bucket.eventTypes.add(readableEventType);

    const eventId = asString(event.eventId ?? event.id);
    if (eventId) {
      bucket.sampleProviderEventIds.add(eventId);
    }

    const { title, description, severity } = classifyEvent(canonicalEventType, event);
    const { speedMph, speedLimitMph } = extractSpeedMetrics(event);
    const { faultCode, faultDescription } = extractFaultDetails(event);
    const dvirDefectCount = extractDvirDefectCount(event);
    const predictiveAlertCode = extractPredictiveCode(event);
    const organizationRec = asRecord(event.organization);

    const occurredAt = parseOccurredAt(event);

    const { error } = await supabase.from("maintenance_alerts").insert({
      tenant_id: tenantId,
      event_type: rawEventType,
      canonical_event_type: canonicalEventType,
      event_id: eventId || null,
      occurred_at: occurredAt,
      vehicle_id: asString(vehicleRec?.id ?? event.vehicleId),
      vehicle_name: asString(vehicleRec?.name ?? event.vehicleName),
      driver_id: asString(driverRec?.id ?? event.driverId),
      driver_name: asString(driverRec?.name ?? event.driverName),
      organization_external_id: asString(organizationRec?.id ?? event.organizationId) || null,
      webhook_version: asString(event.version ?? event.schemaVersion) || null,
      fault_code: faultCode,
      fault_description: faultDescription,
      speed_mph: speedMph,
      speed_limit_mph: speedLimitMph,
      dvir_defect_count: dvirDefectCount,
      predictive_alert_code: predictiveAlertCode,
      severity,
      title,
      description,
      status: "open",
      raw_payload: event,
    });

    if (error?.code === "23505") {
      duplicates += 1;
      bucket.duplicateCount += 1;
      continue;
    }

    if (error) {
      eventErrors += 1;
      bucket.errorCount += 1;
      console.error("[samsara-webhook] Insert error:", error.message);
    } else {
      inserted += 1;
      bucket.insertedCount += 1;
      if (canonicalEventType === "EngineFaultOn" && severity === "critical") {
        alertCandidates.push({
          tenantId,
          vehicle: asString(vehicleRec?.name ?? event.vehicleName) || "Unknown vehicle",
          title,
          occurredAt,
        });
      }
    }
  }

  await logWebhookIngress(supabase, buckets, {
    signatureValid: true,
    httpStatus: 200,
    notes: undefined,
  });

  if (alertCandidates.length > 0 && pushConfigured()) {
    const pushByTenant = new Map<string, Array<{ vehicle: string; title: string; occurredAt: string }>>();

    for (const candidate of alertCandidates) {
      const tenantKey = candidate.tenantId && candidate.tenantId !== "unknown" ? candidate.tenantId : "__unknown__";
      const current = pushByTenant.get(tenantKey) ?? [];
      current.push({ vehicle: candidate.vehicle, title: candidate.title, occurredAt: candidate.occurredAt });
      pushByTenant.set(tenantKey, current);
    }

    for (const [tenantKey, candidates] of pushByTenant) {
      const tenantId = tenantKey === "__unknown__" ? null : tenantKey;
            const preview = candidates
        .slice(0, 3)
        .map((candidate, index) => `${index + 1}. ${candidate.vehicle} - ${candidate.title}`)
        .join(" || ");

      const topCandidate = candidates[0];
      const occurredAt = topCandidate?.occurredAt || new Date().toISOString();
      const alertParams = new URLSearchParams({
        severity: "critical",
        title: `ASF TMS Critical Alert (${candidates.length})`,
        vehicle: topCandidate?.vehicle ?? "Fleet vehicle",
        fault: topCandidate?.title ?? "Critical maintenance fault detected",
        summary: `Immediate attention required across ${candidates.length} critical event(s).`,
        action: "Review active faults, contact driver, and dispatch maintenance response.",
        decision: "Confirm go/no-go for this unit before next dispatch commitment.",
        collaboration: "Maintenance owns technical triage; Manager owns dispatch impact and customer communication path.",
        financial: "Estimated exposure: high same-day cost and downtime risk if this condition escalates in-service.",
        liability: "Liability posture: elevated while unresolved due to potential safety/compliance impacts.",
        guidance: "AI guidance: assign owner + ETA now, then publish route impact decision to stakeholders.",
        decisionWindow: "Decision window: immediate (next 10-15 minutes).",
        confidence: "Confidence: strong, based on active critical telematics event feed.",
        occurredAt,
        highlights: preview || "No additional fault highlights available",
        audience: "maintenance,management",
      });

      const pushResult = await sendPushToTenant(
        {
          tenantId,
        },
        {
          title: `ASF TMS Critical Alert (${candidates.length})`,
          body: (topCandidate ? `${topCandidate.vehicle}: ${topCandidate.title}` : "New critical maintenance alert received.").slice(0, 160),
          url: `/maintenance/alerts?${alertParams.toString()}`,
          tag: "maintenance-critical-alert",
        }
      );

      if (!pushResult.ok && pushResult.errors.length > 0) {
        console.error("[samsara-webhook] Push send failed:", pushResult.errors[0]);
      }
    }
  }

  if (alertCandidates.length > 0 && smsConfigured()) {
    const smsTenantId = alertCandidates.find((candidate) => candidate.tenantId && candidate.tenantId !== "unknown")?.tenantId;
    const smsPhone = smsTenantId ? await getHkMaintenancePhoneByTenant(smsTenantId) : null;

    if (!smsPhone) {
      console.error("[samsara-webhook] SMS target unavailable: hkmaintenance phone not found for tenant");
      return NextResponse.json({ received: events.length, inserted, duplicates, errors: eventErrors });
    }

    const preview = alertCandidates
      .slice(0, 3)
      .map((candidate, index) => `${index + 1}. ${candidate.vehicle} - ${candidate.title}`)
      .join("\n");
    const smsBody =
      `ASF TMS Alert: ${alertCandidates.length} new EngineFaultOn event(s).\n` +
      `${preview}\n` +
      `Webhook: ${WEBHOOK_PROVIDER} ${new Date().toLocaleString()}`;

    const smsResult = await sendSms(smsBody, smsPhone);
    if (!smsResult.ok) {
      console.error("[samsara-webhook] SMS send failed:", smsResult.error ?? "unknown error");
    }
  }

  return NextResponse.json({ received: events.length, inserted, duplicates, errors: eventErrors });
}

