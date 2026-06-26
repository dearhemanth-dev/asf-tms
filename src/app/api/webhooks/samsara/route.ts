import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

// Samsara sends HMAC-SHA256 signature in this header
const SAMSARA_SIGNATURE_HEADER = "x-samsara-signature";

// Event types we care about → map to severity
const SEVERITY_MAP: Record<string, "critical" | "warning" | "info"> = {
  VehicleDisconnected:       "warning",
  FaultCodeRaised:           "critical",
  DriverSafetyScoreChanged:  "warning",
  DVIRSubmitted:             "info",
  DVIRDefectReported:        "critical",
  SpeedingIntervalCompleted: "warning",
  HarshBraking:              "warning",
  HarshAcceleration:         "info",
  FuelLevelLow:              "warning",
};

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role credentials not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getWebhookSecrets() {
  const secrets = new Set<string>();
  const envSecret = process.env.SAMSARA_WEBHOOK_SECRET?.trim();
  if (envSecret) secrets.add(envSecret);

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("samsara_webhook_secret")
    .not("samsara_webhook_secret", "is", null);

  if (error) {
    console.error("[samsara-webhook] Unable to load organization webhook secrets:", error.message);
    return [...secrets];
  }

  for (const row of data ?? []) {
    const secret = asString(row.samsara_webhook_secret);
    if (secret) secrets.add(secret);
  }

  return [...secrets];
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  try {
    const trimmedSignature = signature.trim();
    const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const expectedBase64 = Buffer.from(expectedHex, "hex").toString("base64");

    const comparisons: Array<[string, string]> = [
      [trimmedSignature, expectedHex],
      [trimmedSignature, expectedBase64],
    ];

    for (const [actual, expected] of comparisons) {
      const actualBuf = Buffer.from(actual, "utf8");
      const expectedBuf = Buffer.from(expected, "utf8");
      if (actualBuf.length !== expectedBuf.length) continue;
      if (timingSafeEqual(actualBuf, expectedBuf)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function classifyEvent(eventType: string, payload: Record<string, unknown>): {
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
} {
  const vehicle = asString(asRecord(payload.vehicle)?.name ?? payload.vehicleName);
  const driver = asString(asRecord(payload.driver)?.name ?? payload.driverName);

  const base = vehicle || "Unknown vehicle";

  switch (eventType) {
    case "FaultCodeRaised": {
      const spn = asString(asRecord(payload.faultCode)?.spnDescription ?? payload.spnDescription ?? "");
      const fmi = asString(asRecord(payload.faultCode)?.fmiDescription ?? payload.fmiDescription ?? "");
      return {
        title: `Fault Code: ${spn || "Unknown fault"} — ${base}`,
        description: fmi ? `${spn} / ${fmi}` : spn,
        severity: "critical",
      };
    }
    case "DVIRDefectReported":
      return {
        title: `DVIR Defect Reported — ${base}`,
        description: asString(payload.defectComment ?? payload.defectType ?? "Inspection defect logged"),
        severity: "critical",
      };
    case "DVIRSubmitted":
      return {
        title: `DVIR Submitted — ${base}`,
        description: driver ? `Submitted by ${driver}` : "Pre/post-trip inspection completed",
        severity: "info",
      };
    case "HarshBraking":
      return {
        title: `Harsh Braking — ${base}`,
        description: driver ? `Driver: ${driver}` : "Harsh braking event detected",
        severity: "warning",
      };
    case "SpeedingIntervalCompleted":
      return {
        title: `Speeding Interval — ${base}`,
        description: driver ? `Driver: ${driver}` : "Speeding interval recorded",
        severity: "warning",
      };
    case "FuelLevelLow":
      return {
        title: `Low Fuel — ${base}`,
        description: asString(payload.fuelPercent ? `Fuel level: ${payload.fuelPercent}%` : "Low fuel level detected"),
        severity: "warning",
      };
    case "VehicleDisconnected":
      return {
        title: `Vehicle Disconnected — ${base}`,
        description: "Telematics device stopped reporting",
        severity: "warning",
      };
    default:
      return {
        title: `${eventType} — ${base}`,
        description: "",
        severity: SEVERITY_MAP[eventType] ?? "info",
      };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const secrets = await getWebhookSecrets();
  if (secrets.length === 0) {
    console.error("[samsara-webhook] No webhook secrets configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get(SAMSARA_SIGNATURE_HEADER) ?? "";

  if (!secrets.some((secret) => verifySignature(rawBody, signature, secret))) {
    console.warn("[samsara-webhook] Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Samsara can batch-send events in an array
  const events: unknown[] = Array.isArray(body.events)
    ? body.events
    : Array.isArray(body)
    ? (body as unknown as unknown[])
    : [body];

  const supabase = getServiceRoleClient();
  let inserted = 0;

  for (const raw of events) {
    const event = asRecord(raw);
    if (!event) continue;

    const eventType = asString(event.eventType ?? event.type);
    if (!eventType) continue;

    const vehicleRec = asRecord(event.vehicle);
    const driverRec  = asRecord(event.driver);
    const orgRec     = asRecord(event.organization);

    const tenantId = asString(
      orgRec?.externalIds ?? orgRec?.id ?? event.organizationId ?? event.tenantId ?? "unknown"
    );

    const { title, description, severity } = classifyEvent(eventType, event);

    const { error } = await supabase.from("maintenance_alerts").insert({
      tenant_id:    tenantId,
      event_type:   eventType,
      event_id:     asString(event.eventId ?? event.id),
      occurred_at:  asString(event.eventMs ? new Date(Number(event.eventMs)).toISOString() : event.occurredAt ?? new Date().toISOString()),
      vehicle_id:   asString(vehicleRec?.id ?? event.vehicleId),
      vehicle_name: asString(vehicleRec?.name ?? event.vehicleName),
      driver_id:    asString(driverRec?.id ?? event.driverId),
      driver_name:  asString(driverRec?.name ?? event.driverName),
      severity,
      title,
      description,
      status:       "open",
      raw_payload:  event,
    });

    if (error?.code === "23505") continue; // duplicate event_id, skip silently
    if (error) console.error("[samsara-webhook] Insert error:", error.message);
    else inserted++;
  }

  return NextResponse.json({ received: events.length, inserted });
}
