import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "crypto";
import { getAppSessionUser } from "@/lib/app-session";
import { POST as handleSamsaraWebhook } from "@/lib/fleet/Provider_Samsara_Webhook";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function isHkMaintenance(username: string | null | undefined): boolean {
  return String(username ?? "").trim().toLowerCase() === "hkmaintenance";
}

function decodeWebhookSecret(secret: string): Buffer {
  const normalized = secret.trim();
  if (!normalized) return Buffer.from("", "utf8");

  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length > 0 && decoded.toString("base64").replace(/=+$/g, "") === normalized.replace(/\s+/g, "").replace(/=+$/g, "")) {
      return decoded;
    }
  } catch {
    // fallback below
  }

  return Buffer.from(normalized, "utf8");
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isHkMaintenance(appUser.username)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();

    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("id,organization_name,samsara_webhook_secret")
      .eq("tenant_id", appUser.tenantId)
      .not("samsara_webhook_secret", "is", null)
      .order("organization_name", { ascending: true });

    if (orgError) {
      return NextResponse.json({ error: orgError.message || "Unable to load organization webhook secret." }, { status: 500 });
    }

    const org = (orgRows ?? []).find((row) => Boolean(asString(row.samsara_webhook_secret)));
    if (!org) {
      return NextResponse.json(
        { error: "No organization webhook secret configured. Set secret first in Webhook Settings panel." },
        { status: 400 }
      );
    }

    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const simulatedEventId = `sim-${randomUUID()}`;
    const simulatedVehicleName = `SIM-${org.organization_name ?? "Fleet"}`;

    const payload = {
      eventId: simulatedEventId,
      eventMs: now.getTime(),
      eventType: "Alert",
      events: [
        {
          eventId: simulatedEventId,
          eventType: "EngineFaultOn",
          occurredAt: now.toISOString(),
          organization: {
            id: appUser.tenantId,
          },
          vehicle: {
            id: `sim-vehicle-${now.getTime()}`,
            name: simulatedVehicleName,
          },
          faultCode: {
            spnDescription: "Simulated Coolant Temperature Fault",
            fmiDescription: "Synthetic webhook test event",
          },
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const secretKey = decodeWebhookSecret(asString(org.samsara_webhook_secret));
    const message = `v1:${timestamp}:${rawBody}`;
    const signature = `v1=${createHmac("sha256", secretKey).update(message, "utf8").digest("hex")}`;

    const simulatedRequest = new Request("http://internal.local/api/webhooks/samsara", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-samsara-timestamp": timestamp,
        "x-samsara-signature": signature,
        "x-samsara-event-type": "Alert",
      },
      body: rawBody,
    });

    const webhookResponse = await handleSamsaraWebhook(simulatedRequest);
    const webhookJson = (await webhookResponse.json().catch(() => ({}))) as Record<string, unknown>;

    return NextResponse.json(
      {
        ok: webhookResponse.ok,
        simulatedEventId,
        organizationId: org.id,
        organizationName: org.organization_name,
        webhookStatus: webhookResponse.status,
        webhookResult: webhookJson,
      },
      { status: webhookResponse.ok ? 200 : 500 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
