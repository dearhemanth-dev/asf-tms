import { createClient } from "@supabase/supabase-js";

type SmsSendResult = {
  ok: boolean;
  status?: number;
  messageId?: string;
  error?: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

export async function getHkMaintenancePhoneByTenant(tenantId?: string | null): Promise<string | null> {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (tenantId) {
    const { data, error } = await supabase
      .from("Users")
      .select("phone_number")
      .eq("UserName", "hkmaintenance")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!error) {
      const tenantPhone = normalizePhone(asString(data?.phone_number));
      if (tenantPhone) return tenantPhone;
    }
  }

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("Users")
    .select("phone_number")
    .eq("UserName", "hkmaintenance")
    .limit(1)
    .maybeSingle();

  if (fallbackError) return null;

  const fallbackPhone = normalizePhone(asString(fallbackData?.phone_number));
  return fallbackPhone || null;
}

export async function sendSms(message: string, toOverride?: string): Promise<SmsSendResult> {
  const accountSid = asString(process.env.TWILIO_ACCOUNT_SID);
  const authToken = asString(process.env.TWILIO_AUTH_TOKEN);
  const from = normalizePhone(asString(process.env.TWILIO_FROM_NUMBER));
  const target = normalizePhone(asString(toOverride) || asString(process.env.ALERT_SMS_TO));

  if (!accountSid || !authToken || !from || !target) {
    return {
      ok: false,
      error: "Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and a target phone.",
    };
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const body = new URLSearchParams({
    To: target,
    From: from,
    Body: message.slice(0, 1400),
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: asString(payload.message) || `Twilio send failed (${response.status})`,
    };
  }

  return {
    ok: true,
    status: response.status,
    messageId: asString(payload.sid),
  };
}
