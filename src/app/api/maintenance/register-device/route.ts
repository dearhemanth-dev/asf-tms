import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { registerPushSubscription } from "@/lib/notifications/push";
import { recordPushAction } from "@/lib/notifications/push-audit";

type RegisterDeviceBody = {
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request): Promise<NextResponse> {
  let username = "unknown";
  let tenantId: string | null = null;
  let role = "unknown";
  const userAgent = asString(request.headers.get("user-agent"));

  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    username = appUser.username;
    tenantId = appUser.tenantId;
    role = appUser.role;

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as RegisterDeviceBody;
    const endpoint = asString(body.subscription?.endpoint);
    const p256dh = asString(body.subscription?.keys?.p256dh);
    const auth = asString(body.subscription?.keys?.auth);

    await recordPushAction({
      tenantId: appUser.tenantId,
      username: appUser.username,
      userRole: appUser.role,
      action: "register_device_attempt",
      status: "info",
      options: {
        endpointPresent: Boolean(endpoint),
        p256dhPresent: Boolean(p256dh),
        authPresent: Boolean(auth),
      },
      userAgent,
    });

    if (!endpoint || !p256dh || !auth) {
      await recordPushAction({
        tenantId: appUser.tenantId,
        username: appUser.username,
        userRole: appUser.role,
        action: "register_device_invalid_payload",
        status: "failed",
        options: {
          endpointPresent: Boolean(endpoint),
          p256dhPresent: Boolean(p256dh),
          authPresent: Boolean(auth),
        },
        errorMessage: "Invalid push subscription payload.",
        userAgent,
      });
      return NextResponse.json({ error: "Invalid push subscription payload." }, { status: 400 });
    }

    await registerPushSubscription({
      tenantId: appUser.tenantId,
      username: appUser.username,
      endpoint,
      p256dh,
      auth,
      userAgent,
    });

    await recordPushAction({
      tenantId: appUser.tenantId,
      username: appUser.username,
      userRole: appUser.role,
      action: "register_device_success",
      status: "success",
      options: {
        endpointHost: (() => {
          try {
            return new URL(endpoint).host;
          } catch {
            return "unknown";
          }
        })(),
      },
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[maintenance/register-device]", error);
    await recordPushAction({
      tenantId,
      username,
      userRole: role,
      action: "register_device_error",
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unexpected server error.",
      userAgent,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
