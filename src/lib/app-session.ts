import { normalizeAppRole, type AppRole } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export type AppSessionUser = {
  id: string;
  username: string;
  fullName: string;
  role: AppRole;
  tenantId: string | null;
};

function readCookie(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDemoSessionMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return process.env.NEXT_PUBLIC_FORCE_DEMO_FLEET === "true" || !url || !anon || anon.startsWith("your_");
}

function getRoleFromCookie(cookieHeader: string): AppRole {
  const role = readCookie(cookieHeader, "asf_role");
  return normalizeAppRole(role, "maintenance");
}

function toDisplayName(username: string): string {
  if (!username) return "ASF User";
  return username
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function getAppSessionUser(request: Request): Promise<AppSessionUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const username = readCookie(cookieHeader, "asf_login");

  if (!username) return null;

  if (isDemoSessionMode()) {
    return {
      id: `demo:${username}`,
      username,
      fullName: toDisplayName(username),
      role: getRoleFromCookie(cookieHeader),
      tenantId: null,
    };
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("Users")
    .select('id, full_name, tenant_id, "UserName", "UserType"')
    .eq("UserName", username)
    .maybeSingle();

  if (error || !data) return null;

  let tenantId: string | null = isUuid(data.tenant_id) ? data.tenant_id : null;
  if (!tenantId) {
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    tenantId = tenantRow?.id ?? null;
  }

  return {
    id: data.id,
    username: data.UserName,
    fullName: data.full_name ?? data.UserName,
    role: normalizeAppRole(data.UserType, "maintenance"),
    tenantId,
  };
}
