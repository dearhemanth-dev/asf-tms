import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPushOpenToken } from "@/lib/notifications/push-auth";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getServiceRoleClient() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Supabase service role credentials not configured.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function sanitizeNextPath(nextRaw: string | null): string {
  const fallback = "/maintenance/fault-codes";
  if (!nextRaw) return fallback;
  if (!nextRaw.startsWith("/")) return fallback;
  if (nextRaw.startsWith("//")) return fallback;
  return nextRaw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = asString(request.nextUrl.searchParams.get("token"));
  const nextPath = sanitizeNextPath(request.nextUrl.searchParams.get("next"));

  const verification = verifyPushOpenToken(token);
  if (!verification.valid) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let role = "maintenance";
  try {
    const supabase = getServiceRoleClient();
    const { data } = await supabase
      .from("Users")
      .select('"UserType"')
      .eq("UserName", verification.username)
      .maybeSingle();

    role = asString((data as { UserType?: string } | null)?.UserType) || role;
  } catch {
    // If role lookup fails, keep default role cookie.
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.cookies.set("asf_login", verification.username, {
    path: "/",
    maxAge: 60 * 60 * 8,
    sameSite: "lax",
    secure: true,
  });
  response.cookies.set("asf_role", role, {
    path: "/",
    maxAge: 60 * 60 * 8,
    sameSite: "lax",
    secure: true,
  });

  return response;
}
