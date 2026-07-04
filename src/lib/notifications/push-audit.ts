import { createClient } from "@supabase/supabase-js";

type PushAuditStatus = "success" | "failed" | "info";

export type PushAuditRow = {
  id: string;
  tenant_id: string | null;
  username: string | null;
  user_role: string | null;
  action: string;
  status: PushAuditStatus;
  options: Record<string, unknown>;
  error_message: string | null;
  user_agent: string | null;
  created_at: string;
};

type PushAuditInput = {
  tenantId: string | null;
  username: string;
  userRole?: string;
  action: string;
  status?: PushAuditStatus;
  options?: Record<string, unknown>;
  errorMessage?: string | null;
  userAgent?: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getServiceRoleClient() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured.");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function recordPushAction(input: PushAuditInput): Promise<void> {
  try {
    const supabase = getServiceRoleClient();

    const payload = {
      tenant_id: input.tenantId,
      username: input.username,
      user_role: input.userRole ?? null,
      action: input.action,
      status: input.status ?? "info",
      options: input.options ?? {},
      error_message: input.errorMessage ?? null,
      user_agent: input.userAgent ?? null,
    };

    const { error } = await supabase.from("maintenance_push_action_logs").insert(payload);
    if (error) {
      console.error("[push-audit] insert failed:", error.message);
    }
  } catch (error) {
    console.error("[push-audit] unexpected failure:", error instanceof Error ? error.message : String(error));
  }
}

export async function getRecentPushActions(input: { tenantId: string | null; limit?: number }): Promise<PushAuditRow[]> {
  const supabase = getServiceRoleClient();
  const limit = Math.max(1, Math.min(input.limit ?? 40, 200));

  let query = supabase
    .from("maintenance_push_action_logs")
    .select("id, tenant_id, username, user_role, action, status, options, error_message, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.tenantId) {
    query = query.eq("tenant_id", input.tenantId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PushAuditRow[];
}
