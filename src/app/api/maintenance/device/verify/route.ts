import { NextRequest, NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const maxDuration = 60;

interface VerifyDeviceRequest {
  subscriptionId: string;
}

interface VerifyConfirmRequest {
  challengeToken: string;
}

// POST: Start verification flow (send test alert with challenge)
export async function POST(req: NextRequest) {
  try {
    const appUser = await getAppSessionUser(req);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();
    const body: VerifyDeviceRequest = await req.json();

    if (!body.subscriptionId) {
      return NextResponse.json(
        { error: "Missing subscriptionId" },
        { status: 400 }
      );
    }

    // Get subscription details (must belong to this user)
    const { data: subscription, error: subscriptionError } = await supabase
      .from("maintenance_push_subscriptions")
      .select("id, tenant_id, username, status")
      .eq("id", body.subscriptionId)
      .single();

    if (subscriptionError || !subscription) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    // Verify username matches (user can only verify their own subscriptions)
    if (appUser.username !== subscription.username) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // If there is already a valid pending challenge for this subscription, reuse it.
    const nowIso = new Date().toISOString();
    const { data: existingPendingChallenge } = await supabase
      .from("push_verification_challenges")
      .select("id, challenge_token, expires_at")
      .eq("subscription_id", subscription.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPendingChallenge) {
      return NextResponse.json({
        ok: true,
        challengeId: existingPendingChallenge.id,
        challengeToken: existingPendingChallenge.challenge_token,
        expiresAt: existingPendingChallenge.expires_at,
        message: "Using existing verification challenge. Check your device for test alert.",
      });
    }

    // Expire stale pending challenges for this subscription so one new pending challenge can be created.
    await supabase
      .from("push_verification_challenges")
      .update({ status: "expired" })
      .eq("subscription_id", subscription.id)
      .eq("status", "pending")
      .lte("expires_at", nowIso);

    // Generate verification challenge
    const challengeToken = uuidv4();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create challenge record
    const { data: challenge, error: challengeError } = await supabase
      .from("push_verification_challenges")
      .insert({
        tenant_id: subscription.tenant_id,
        username: subscription.username,
        subscription_id: subscription.id,
        challenge_token: challengeToken,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (challengeError) {
      console.error("Challenge creation error:", challengeError);
      return NextResponse.json(
        { error: "Failed to create verification challenge" },
        { status: 500 }
      );
    }

    // TODO: Send test alert with challenge token embedded
    // This would integrate with the push sending system

    return NextResponse.json({
      ok: true,
      challengeId: challenge.id,
      challengeToken: challenge.challenge_token,
      expiresAt: challenge.expires_at,
      message: "Verification challenge created. Check your device for test alert.",
    });
  } catch (error) {
    console.error("Device verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Confirm verification (user clicked challenge in notification)
export async function PUT(req: NextRequest) {
  try {
    const appUser = await getAppSessionUser(req);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();

    const body: VerifyConfirmRequest = await req.json();

    if (!body.challengeToken) {
      return NextResponse.json(
        { error: "Missing challengeToken" },
        { status: 400 }
      );
    }

    // Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("push_verification_challenges")
      .select("id, subscription_id, tenant_id, username, expires_at, status")
      .eq("challenge_token", body.challengeToken)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json(
        { error: "Challenge not found" },
        { status: 404 }
      );
    }

    // Verify username matches (user can only confirm their own challenges)
    if (appUser.username !== challenge.username) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    if (challenge.status !== "pending") {
      return NextResponse.json(
        { error: `Challenge already ${challenge.status}` },
        { status: 400 }
      );
    }

    if (new Date(challenge.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "Challenge expired" },
        { status: 400 }
      );
    }

    // Mark challenge as confirmed
    const { error: updateChallengeError } = await supabase
      .from("push_verification_challenges")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", challenge.id);

    if (updateChallengeError) {
      console.error("Challenge update error:", updateChallengeError);
      return NextResponse.json(
        { error: "Failed to confirm challenge" },
        { status: 500 }
      );
    }

    // Mark subscription as verified
    const { error: updateSubscriptionError } = await supabase
      .from("maintenance_push_subscriptions")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        last_verification_attempt_at: new Date().toISOString(),
      })
      .eq("id", challenge.subscription_id);

    if (updateSubscriptionError) {
      console.error("Subscription update error:", updateSubscriptionError);
      return NextResponse.json(
        { error: "Failed to verify device" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Device verified! You'll now receive push notifications.",
      subscriptionId: challenge.subscription_id,
      status: "verified",
    });
  } catch (error) {
    console.error("Challenge confirmation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
