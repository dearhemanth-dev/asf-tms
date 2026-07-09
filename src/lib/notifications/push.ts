import { createClient } from "@supabase/supabase-js";
import webpush, { type PushSubscription } from "web-push";
import { createPushOpenToken } from "@/lib/notifications/push-auth";

type RegisterPushInput = {
  tenantId: string | null;
  username: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type SendPushResult = {
  ok: boolean;
  attempted: number;
  sent: number;
  removed: number;
  errors: string[];
};

type SendPushOptions = {
  tenantId: string | null;
  username?: string;
};

type CleanupPushOptions = {
  tenantId?: string | null;
  usernames?: string[];
  maxAgeDays?: number;
};

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  username?: string;
};

let vapidConfigured = false;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getServiceRoleClient() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Supabase service role credentials not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function getVapidConfig() {
  const publicKey = asString(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = asString(process.env.VAPID_PRIVATE_KEY);
  const subject = asString(process.env.VAPID_SUBJECT);
  return { publicKey, privateKey, subject };
}

function ensureVapidConfigured() {
  if (vapidConfigured) return;

  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Push notifications not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

function toWebPushSubscription(row: PushSubscriptionRow): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function buildPushTargetUrl(url: string | undefined, username?: string): string {
  const baseUrl = url && url.trim() ? url.trim() : "/maintenance/fault-codes";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const nextPath = `${baseUrl}${separator}push=1&ts=${Date.now()}`;

  if (!username) return nextPath;

  const token = createPushOpenToken(username);
  if (!token) return nextPath;

  return `/api/auth/push-open?token=${encodeURIComponent(token)}&next=${encodeURIComponent(nextPath)}`;
}

export function pushConfigured(): boolean {
  const { publicKey, privateKey, subject } = getVapidConfig();
  return Boolean(publicKey && privateKey && subject);
}

export async function registerPushSubscription(input: RegisterPushInput): Promise<void> {
  const supabase = getServiceRoleClient();

  const payload = {
    tenant_id: input.tenantId,
    username: input.username,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    user_agent: input.userAgent,
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("maintenance_push_subscriptions").upsert(payload, {
    onConflict: "endpoint",
    ignoreDuplicates: false,
  });

  if (!error) return;

  if (error.message.toLowerCase().includes("invalid input syntax for type uuid")) {
    const { error: retryError } = await supabase.from("maintenance_push_subscriptions").upsert(
      {
        ...payload,
        tenant_id: null,
      },
      {
        onConflict: "endpoint",
        ignoreDuplicates: false,
      }
    );

    if (!retryError) return;
    throw new Error(retryError.message);
  }

  throw new Error(error.message);
}

export async function cleanupStalePushSubscriptions(options: CleanupPushOptions): Promise<{ removed: number; cutoffIso: string }> {
  const supabase = getServiceRoleClient();
  const maxAgeDays = Number.isFinite(options.maxAgeDays) && Number(options.maxAgeDays) > 0 ? Number(options.maxAgeDays) : 14;
  const cutoffIso = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("maintenance_push_subscriptions")
    .delete({ count: "exact" })
    .lt("last_seen_at", cutoffIso);

  if (options.tenantId) {
    query = query.eq("tenant_id", options.tenantId);
  }

  const usernames = (options.usernames ?? []).map((value) => value.trim()).filter(Boolean);
  if (usernames.length > 0) {
    query = query.in("username", usernames);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return {
    removed: count ?? 0,
    cutoffIso,
  };
}

export async function sendPushToTenant(options: SendPushOptions, payload: PushPayload): Promise<SendPushResult> {
  ensureVapidConfigured();
  const supabase = getServiceRoleClient();

  const uniqueRows = new Map<string, PushSubscriptionRow>();
  const lookupErrors: string[] = [];

  const addRows = (rows: PushSubscriptionRow[] | null | undefined) => {
    for (const row of rows ?? []) {
      if (!uniqueRows.has(row.endpoint)) {
        uniqueRows.set(row.endpoint, row);
      }
    }
  };

  if (options.tenantId) {
    const { data, error } = await supabase
      .from("maintenance_push_subscriptions")
      .select("endpoint,p256dh,auth,username")
      .eq("tenant_id", options.tenantId)
      .order("last_seen_at", { ascending: false })
      .limit(50);

    if (error) {
      lookupErrors.push(error.message);
    } else {
      addRows(data);
    }
  }

  if (options.username) {
    const { data, error } = await supabase
      .from("maintenance_push_subscriptions")
      .select("endpoint,p256dh,auth,username")
      .eq("username", options.username)
      .order("last_seen_at", { ascending: false })
      .limit(50);

    if (error) {
      lookupErrors.push(error.message);
    } else {
      addRows(data);
    }
  }

  const rows = [...uniqueRows.values()];
  const errors: string[] = [...lookupErrors];
  const deliveryResults = await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          toWebPushSubscription(row),
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: buildPushTargetUrl(payload.url, row.username ?? options.username),
            ...(payload.tag?.trim() ? { tag: payload.tag.trim() } : {}),
          }),
          {
            TTL: 60,
            urgency: "high",
          }
        );

        return { sent: 1, removed: 0, error: null as string | null };
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
        const errorBody =
          typeof error === "object" && error !== null && "body" in error
            ? (error as { body?: unknown }).body
            : undefined;
        const errorBodyText =
          typeof errorBody === "string"
            ? errorBody
            : errorBody && typeof errorBody === "object"
              ? JSON.stringify(errorBody)
              : "";
        const baseMessage = error instanceof Error ? error.message : "Unknown push delivery failure";
        const message = [
          baseMessage,
          statusCode > 0 ? `status=${statusCode}` : "",
          errorBodyText ? `provider=${errorBodyText.slice(0, 220)}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        console.error(
          "[push-send-error] Endpoint:",
          row.endpoint.substring(0, 50),
          "Status:",
          statusCode,
          "Message:",
          message
        );

        let removed = 0;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await supabase
            .from("maintenance_push_subscriptions")
            .delete()
            .eq("endpoint", row.endpoint);

          if (!deleteError) {
            removed = 1;
          }
        }

        return { sent: 0, removed, error: message };
      }
    })
  );

  const sent = deliveryResults.reduce((sum, result) => sum + result.sent, 0);
  const removed = deliveryResults.reduce((sum, result) => sum + result.removed, 0);
  for (const result of deliveryResults) {
    if (result.error) {
      errors.push(result.error);
    }
  }

  return {
    ok: errors.length === 0,
    attempted: rows.length,
    sent,
    removed,
    errors,
  };
}
