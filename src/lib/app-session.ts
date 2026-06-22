import type { AppRole } from "@/lib/auth";
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

export async function getAppSessionUser(request: Request): Promise<AppSessionUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const username = readCookie(cookieHeader, "asf_login");

  if (!username) return null;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("Users")
    .select('id, full_name, tenant_id, "UserName", "UserType"')
    .eq("UserName", username)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    username: data.UserName,
    fullName: data.full_name ?? data.UserName,
    role: data.UserType as AppRole,
    tenantId: data.tenant_id,
  };
}
