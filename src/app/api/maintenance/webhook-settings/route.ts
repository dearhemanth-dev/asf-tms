import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppSessionUser } from "@/lib/app-session";

type UpdateWebhookSettingsBody = {
  organizationId?: string;
  webhookUrl?: string;
  webhookSecret?: string;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

function isHkMaintenance(username: string | null | undefined): boolean {
  return String(username ?? "").trim().toLowerCase() === "hkmaintenance";
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isHkMaintenance(appUser.username)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = getServiceRoleClient();
    const { data: rows, error } = await supabase
      .from("organizations")
      .select("id,organization_name,samsara_webhook_url,samsara_webhook_secret")
      .eq("tenant_id", appUser.tenantId)
      .order("organization_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message || "Unable to load webhook settings." }, { status: 500 });
    }

    const organizations = (rows ?? []).map((row) => ({
      id: String(row.id),
      organizationName: String(row.organization_name ?? ""),
      webhookUrl: String(row.samsara_webhook_url ?? ""),
      hasWebhookSecret: Boolean(String(row.samsara_webhook_secret ?? "").trim()),
    }));

    return NextResponse.json({
      tenantId: appUser.tenantId,
      organizations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isHkMaintenance(appUser.username)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as UpdateWebhookSettingsBody;
    const webhookUrl = asOptionalString(body.webhookUrl);
    const webhookSecret = asOptionalString(body.webhookSecret);

    if (!webhookUrl && !webhookSecret) {
      return NextResponse.json(
        { error: "Provide webhookUrl and/or webhookSecret." },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const { data: orgRows, error: orgError } = await supabase
      .from("organizations")
      .select("id,organization_name")
      .eq("tenant_id", appUser.tenantId)
      .order("organization_name", { ascending: true });

    if (orgError) {
      return NextResponse.json({ error: orgError.message || "Unable to load organizations." }, { status: 500 });
    }

    const targetId =
      asOptionalString(body.organizationId) ||
      ((orgRows ?? []).length === 1 ? String(orgRows?.[0]?.id ?? "") : "");

    if (!targetId) {
      return NextResponse.json(
        {
          error: "organizationId is required when multiple organizations exist.",
          organizations: orgRows ?? [],
        },
        { status: 400 }
      );
    }

    const updatePayload: { samsara_webhook_url?: string | null; samsara_webhook_secret?: string | null } = {};
    if (webhookUrl) updatePayload.samsara_webhook_url = webhookUrl;
    if (webhookSecret) updatePayload.samsara_webhook_secret = webhookSecret;

    const { data: updatedRow, error: updateError } = await supabase
      .from("organizations")
      .update(updatePayload)
      .eq("tenant_id", appUser.tenantId)
      .eq("id", targetId)
      .select("id,organization_name,samsara_webhook_url,samsara_webhook_secret")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message || "Unable to update webhook settings." }, { status: 500 });
    }

    return NextResponse.json({
      organization: {
        id: String(updatedRow.id),
        organizationName: String(updatedRow.organization_name ?? ""),
        webhookUrl: String(updatedRow.samsara_webhook_url ?? ""),
        hasWebhookSecret: Boolean(String(updatedRow.samsara_webhook_secret ?? "").trim()),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
