import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type CreateOrganizationBody = {
  organizationName?: string;
  mcNumber?: string;
  usdotNumber?: string;
  streetAddress?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  managerName?: string;
  phone?: string;
  email?: string;
  website?: string;
  ein?: string;
  scac?: string;
  samsaraApiKey?: string;
  samsaraWebhookUrl?: string;
  samsaraWebhookSecret?: string;
  fuelguruFleetId?: string;
  notes?: string;
};

function asOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();

    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("organizations")
      .select("id, organization_name")
      .eq("tenant_id", appUser.tenantId)
      .order("organization_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ organizations: data ?? [] }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();

    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as CreateOrganizationBody;

    const organizationName = asOptionalString(body.organizationName);
    if (!organizationName) {
      return NextResponse.json({ error: "Organization name is required." }, { status: 400 });
    }

    const payload = {
      tenant_id: appUser.tenantId,
      organization_name: organizationName,
      mc_number: asOptionalString(body.mcNumber),
      usdot_number: asOptionalString(body.usdotNumber),
      street_address: asOptionalString(body.streetAddress),
      city: asOptionalString(body.city),
      state_province: asOptionalString(body.stateProvince),
      postal_code: asOptionalString(body.postalCode),
      country: asOptionalString(body.country),
      manager_name: asOptionalString(body.managerName),
      phone: asOptionalString(body.phone),
      email: asOptionalString(body.email),
      website: asOptionalString(body.website),
      ein: asOptionalString(body.ein),
      scac: asOptionalString(body.scac),
      samsara_api_key: asOptionalString(body.samsaraApiKey),
      samsara_webhook_url: asOptionalString(body.samsaraWebhookUrl),
      samsara_webhook_secret: asOptionalString(body.samsaraWebhookSecret),
      fuelguru_fleet_id: asOptionalString(body.fuelguruFleetId),
      notes: asOptionalString(body.notes),
      created_by: null,
    };

    const { data, error } = await supabase
      .from("organizations")
      .insert(payload)
      .select("id, organization_name")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ organization: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
