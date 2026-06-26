import { getAppSessionUser } from "@/lib/app-session";
import {
  LICENSE_PLATE_ERROR_MESSAGE,
  isValidUsLicensePlate,
  isValidUsVin,
} from "@/lib/asset-validation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeSingleSpaces, normalizeUpperSingleSpaces } from "@/lib/text-normalization";

const ASSET_UNIT_NUMBER_MAX_LENGTH = 20;
const ASSET_UNIT_NUMBER_PATTERN = /^[A-Z0-9 -]{1,20}$/;
const ASSET_UNIT_NUMBER_ERROR_MESSAGE = "Asset Unit# is not valid. Use letters/numbers, spaces, or dash only.";

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();

    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("assets")
      .select("asset_no, asset_unit_number, ownership_type, vin, year, make, model")
      .eq("tenant_id", appUser.tenantId)
      .not("asset_no", "is", null)
      .order("asset_no", { ascending: true });

    if (error) {
      return Response.json({ error: error.message || "Unable to load assets." }, { status: 500 });
    }

    const assetMap = new Map<
      string,
      {
        asset_no: string;
        asset_unit_number: string;
        ownership_type: string;
        vin: string | null;
        year: string | null;
        make: string | null;
        model: string | null;
      }
    >();

    for (const row of data ?? []) {
      const assetNo = String(row.asset_no ?? "").trim();
      if (!assetNo) continue;

      if (!assetMap.has(assetNo)) {
        assetMap.set(assetNo, {
          asset_no: assetNo,
          asset_unit_number: String(row.asset_unit_number ?? "").trim() || assetNo,
          ownership_type: String(row.ownership_type ?? "company").trim() || "company",
          vin: String(row.vin ?? "").trim().toUpperCase() || null,
          year: String(row.year ?? "").trim() || null,
          make: String(row.make ?? "").trim() || null,
          model: String(row.model ?? "").trim() || null,
        });
      }
    }

    return Response.json(
      {
        assets: Array.from(assetMap.values()),
      },
      { status: 200 }
    );
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();

    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    const assetUnitNumber = String(body.assetUnitNumber ?? "").trim();
    if (!assetUnitNumber) {
      return Response.json(
        { error: "Asset Unit# is required." },
        { status: 400 }
      );
    }

    if (assetUnitNumber.length > ASSET_UNIT_NUMBER_MAX_LENGTH) {
      return Response.json(
        { error: `Asset Unit# must be ${ASSET_UNIT_NUMBER_MAX_LENGTH} characters or less.` },
        { status: 400 }
      );
    }

    const normalizedAssetUnitNumber = normalizeUpperSingleSpaces(assetUnitNumber);
    if (!ASSET_UNIT_NUMBER_PATTERN.test(normalizedAssetUnitNumber)) {
      return Response.json(
        { error: ASSET_UNIT_NUMBER_ERROR_MESSAGE },
        { status: 400 }
      );
    }

    const organizationName = String(body.organizationName ?? "").trim();
    if (!organizationName) {
      return Response.json(
        { error: "Organization is required." },
        { status: 400 }
      );
    }

    const { data: organizationRecord, error: organizationLookupError } = await supabase
      .from("organizations")
      .select("id")
      .eq("tenant_id", appUser.tenantId)
      .eq("organization_name", organizationName)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (organizationLookupError) {
      console.error("Organization lookup error:", organizationLookupError);
      return Response.json(
        { error: "Unable to validate organization." },
        { status: 500 }
      );
    }

    if (!organizationRecord?.id) {
      return Response.json(
        { error: "Selected organization was not found." },
        { status: 400 }
      );
    }

    const vin = String(body.vin ?? "").trim();
    if (vin && !isValidUsVin(vin)) {
      return Response.json(
        { error: "VIN is not valid. Use 17 letters/numbers (no I, O, Q)." },
        { status: 400 }
      );
    }

    const licensePlate = String(body.licensePlate ?? "").trim();
    if (licensePlate && !isValidUsLicensePlate(licensePlate)) {
      return Response.json(
        { error: LICENSE_PLATE_ERROR_MESSAGE },
        { status: 400 }
      );
    }

    // Convert form fields and trim values
    const assetData = {
      tenant_id: appUser.tenantId,
      asset_no: normalizedAssetUnitNumber,
      asset_unit_number: normalizedAssetUnitNumber,
      organization_id: organizationRecord.id,
      organization_name: organizationName,
      asset_type: String(body.assetType ?? "truck"),
      vin: vin ? vin.toUpperCase() : null,
      year: String(body.year ?? "").trim() || null,
      make: String(body.make ?? "").trim() || null,
      model: String(body.model ?? "").trim() || null,
      license_plate: licensePlate ? normalizeUpperSingleSpaces(licensePlate) : null,
      ownership_type: String(body.ownershipType ?? "company"),
      allowed_outside_home_state: normalizeSingleSpaces(String(body.allowedOutsideHomeState ?? "no")) || "no",
      status: String(body.status ?? "active"),
      notes: String(body.notes ?? "").trim() || null,
      created_by: null,
    };

    const { data, error } = await supabase
      .from("assets")
      .insert([assetData])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return Response.json(
          {
            error: "Asset Unit# already exists for this organization.",
          },
          { status: 409 }
        );
      }

      console.error("Supabase error:", error);
      return Response.json(
        {
          error: error.message || "Unable to create asset.",
        },
        { status: 500 }
      );
    }

    return Response.json(data, { status: 201 });
  } catch (err) {
    console.error("Unexpected error:", err);
    return Response.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
