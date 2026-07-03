import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getHkMaintenancePhoneByTenant, sendSms, smsConfigured } from "@/lib/notifications/sms";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!smsConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: "SMS not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.",
        },
        { status: 200 }
      );
    }

    const targetPhone = await getHkMaintenancePhoneByTenant(appUser.tenantId);
    if (!targetPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "No phone_number found for hkmaintenance in this tenant.",
        },
        { status: 200 }
      );
    }

    const now = new Date().toLocaleString();
    const text = `ASF TMS test SMS (${now}) - tenant ${appUser.tenantId}.`;

    const result = await sendSms(text, targetPhone);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? "Unable to send SMS." }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Test SMS sent.",
        messageId: result.messageId ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
