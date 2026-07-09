import { NextRequest, NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

interface EnrollDeviceRequest {
  endpoint: string; // Browser push subscription endpoint URL
  p256dh: string;   // VAPID public key (base64)
  auth: string;     // Authentication secret (base64)
  userAgent?: string;
}

export async function POST(req: NextRequest) {
  try {
    const appUser = await getAppSessionUser(req);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();
    const body: EnrollDeviceRequest = await req.json();

    if (!body.endpoint || !body.p256dh || !body.auth) {
      return NextResponse.json(
        { error: "Missing endpoint, p256dh, or auth" },
        { status: 400 }
      );
    }

    // Upsert subscription into maintenance_push_subscriptions
    // status defaults to 'pending' until user verifies
    const { data: subscription, error: subscriptionError } = await supabase
      .from("maintenance_push_subscriptions")
      .upsert(
        {
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
          tenant_id: appUser.tenantId,
          username: appUser.username,
          user_agent: body.userAgent || null,
          status: "pending",
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: "endpoint",
        }
      )
      .select()
      .single();

    if (subscriptionError) {
      console.error("Subscription enrollment error:", subscriptionError);
      return NextResponse.json(
        { error: "Failed to enroll device" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      message: "Device enrolled. Complete setup by verifying your phone.",
    });
  } catch (error) {
    console.error("Device enrollment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
