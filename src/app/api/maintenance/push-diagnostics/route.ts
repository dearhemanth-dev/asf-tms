import { NextRequest, NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  try {
    // Require auth
    const user = await getAppSessionUser(request);
    if (!user || !["maintenance", "management"].includes(user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Prefer tenant-scoped subscriptions; fallback to username-scoped rows in demo sessions.
    let query = supabase
      .from("maintenance_push_subscriptions")
      .select("id, tenant_id, username, endpoint, p256dh, auth, created_at, last_seen_at");

    if (user.tenantId) {
      query = query.eq("tenant_id", user.tenantId);
    } else {
      query = query.eq("username", user.username);
    }

    const { data: subscriptions, error: selectError } = await query;

    if (selectError) {
      return NextResponse.json({
        error: "Database query failed",
        details: selectError.message,
        subscriptionCount: 0,
      });
    }

    return NextResponse.json({
      ok: true,
      username: user.username,
      tenantId: user.tenantId,
      subscriptionCount: subscriptions?.length || 0,
      subscriptions: subscriptions?.map((s) => ({
        id: s.id,
        username: s.username,
        endpoint: s.endpoint ? s.endpoint.substring(0, 100) + "..." : "missing",
        hasP256dh: !!s.p256dh,
        hasAuth: !!s.auth,
        created_at: s.created_at,
        last_seen_at: s.last_seen_at,
      })) || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Diagnostics failed",
      },
      { status: 500 }
    );
  }
}



