import { NextRequest, NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: List user's enrolled devices with verification status
export async function GET(req: NextRequest) {
  try {
    const appUser = await getAppSessionUser(req);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();

    // Get all subscriptions for this user
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("maintenance_push_subscriptions")
      .select("id, endpoint, status, verified_at, created_at, updated_at, last_seen_at")
      .eq("username", appUser.username)
      .order("created_at", { ascending: false });

    if (subscriptionsError) {
      console.error("Subscription fetch error:", subscriptionsError);
      return NextResponse.json(
        { error: "Failed to fetch subscriptions" },
        { status: 500 }
      );
    }

    // Check verification status
    const hasVerifiedDevice = subscriptions?.some((s) => s.status === "verified") ?? false;

    return NextResponse.json({
      ok: true,
      subscriptions: subscriptions || [],
      hasVerifiedDevice,
      verifiedCount: subscriptions?.filter((s) => s.status === "verified").length ?? 0,
      pendingCount: subscriptions?.filter((s) => s.status === "pending").length ?? 0,
      expiredCount: subscriptions?.filter((s) => s.status === "expired").length ?? 0,
      revokedCount: subscriptions?.filter((s) => s.status === "revoked").length ?? 0,
    });
  } catch (error) {
    console.error("Device list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
