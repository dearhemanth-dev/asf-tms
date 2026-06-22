import { getAppSessionUser } from "@/lib/app-session";
import { DRIVER_CITY_COUNTRY_PATTERN, DRIVER_STREET_MAX_LENGTH, DRIVER_TEXT_MAX_LENGTH } from "@/lib/driver-validation";
import { normalizeUpperSingleSpaces } from "@/lib/text-normalization";
import { lookupUsZipFromAddress } from "@/lib/us-zip-lookup";

export async function POST(request: Request) {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const streetAddress = normalizeUpperSingleSpaces(String(body.streetAddress ?? ""));
    const city = normalizeUpperSingleSpaces(String(body.city ?? ""));
    const stateProvince = normalizeUpperSingleSpaces(String(body.stateProvince ?? ""));

    if (!streetAddress || !city || !stateProvince) {
      return Response.json({ error: "Street Address, City, and State are required." }, { status: 400 });
    }

    if (streetAddress.length > DRIVER_STREET_MAX_LENGTH) {
      return Response.json(
        { error: `Street Address must be ${DRIVER_STREET_MAX_LENGTH} characters or less.` },
        { status: 400 }
      );
    }

    if (city.length > DRIVER_TEXT_MAX_LENGTH || !DRIVER_CITY_COUNTRY_PATTERN.test(city)) {
      return Response.json(
        { error: "City is not valid. Use letters, spaces, apostrophe, dot, or dash." },
        { status: 400 }
      );
    }

    const zip = await lookupUsZipFromAddress({
      streetAddress,
      city,
      stateProvince,
    });

    if (!zip) {
      return Response.json({ error: "Unable to auto-detect Zip from the provided address." }, { status: 404 });
    }

    return Response.json({ zip }, { status: 200 });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}
