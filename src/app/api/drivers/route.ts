import { getAppSessionUser } from "@/lib/app-session";
import {
  DRIVER_CITY_COUNTRY_PATTERN,
  DRIVER_LICENSE_PATTERN,
  DRIVER_NOTES_MAX_LENGTH,
  DRIVER_STREET_MAX_LENGTH,
  DRIVER_TEXT_MAX_LENGTH,
  US_ZIP_PATTERN,
  isValidDriverEmail,
  isValidDriverName,
} from "@/lib/driver-validation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeCompact, normalizeDigits, normalizeSingleSpaces, normalizeUpperSingleSpaces } from "@/lib/text-normalization";
import { lookupUsZipFromAddress } from "@/lib/us-zip-lookup";

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();

    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("drivers")
      .select("first_name, last_name, assigned_truck_unit_number, status")
      .eq("tenant_id", appUser.tenantId)
      .not("assigned_truck_unit_number", "is", null)
      .order("first_name", { ascending: true });

    if (error) {
      return Response.json({ error: error.message || "Unable to load drivers." }, { status: 400 });
    }

    const drivers = (data ?? []).map((row) => {
      const firstName = String(row.first_name ?? "").trim();
      const lastName = String(row.last_name ?? "").trim();
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();

      return {
        assignedTruckUnitNumber: String(row.assigned_truck_unit_number ?? "").trim(),
        fullName: fullName || "Unassigned",
        status: String(row.status ?? "active"),
      };
    });

    return Response.json({ drivers });
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

    const firstNameInput = String(body.firstName ?? "").trim();
    const lastNameInput = String(body.lastName ?? "").trim();
    const fullNameInput = String(body.fullName ?? "").trim();

    const fullNameParts = fullNameInput.split(/\s+/).filter(Boolean);
    const firstName = (firstNameInput || fullNameParts[0] || "").toUpperCase();
    const lastName = (lastNameInput || (fullNameParts.length > 1 ? fullNameParts.slice(1).join(" ") : "")).toUpperCase();

    if (!firstName) {
      return Response.json({ error: "Driver first name is required." }, { status: 400 });
    }

    if (!isValidDriverName(firstName)) {
      return Response.json(
        { error: "Driver first name is not valid. Use letters, spaces, apostrophe, or dash." },
        { status: 400 }
      );
    }

    if (lastName && !isValidDriverName(lastName)) {
      return Response.json(
        { error: "Driver last name is not valid. Use letters, spaces, apostrophe, or dash." },
        { status: 400 }
      );
    }

    const streetAddress = normalizeUpperSingleSpaces(String(body.streetAddress ?? ""));
    if (streetAddress.length > DRIVER_STREET_MAX_LENGTH) {
      return Response.json(
        { error: `Street Address must be ${DRIVER_STREET_MAX_LENGTH} characters or less.` },
        { status: 400 }
      );
    }

    const city = normalizeUpperSingleSpaces(String(body.city ?? ""));
    if (city) {
      if (city.length > DRIVER_TEXT_MAX_LENGTH || !DRIVER_CITY_COUNTRY_PATTERN.test(city)) {
        return Response.json(
          { error: "City is not valid. Use letters, spaces, apostrophe, dot, or dash." },
          { status: 400 }
        );
      }
    }

    const country = "USA";
    const stateProvince = normalizeUpperSingleSpaces(String(body.stateProvince ?? ""));

    let postalCode = normalizeCompact(String(body.postalCode ?? ""));
    if (!postalCode) {
      const inferredZip = await lookupUsZipFromAddress({
        streetAddress,
        city,
        stateProvince,
      });
      if (inferredZip) {
        postalCode = inferredZip;
      }
    }

    if (!postalCode) {
      return Response.json(
        { error: "Enter Zip or provide Street Address, City, and State for auto ZIP lookup." },
        { status: 400 }
      );
    }
    const normalizedCountry = country.toUpperCase();
    if (normalizedCountry === "USA" || normalizedCountry === "US" || !normalizedCountry) {
      if (!US_ZIP_PATTERN.test(postalCode)) {
        return Response.json(
          { error: "Zip is not valid. Use 5 digits or ZIP+4 format." },
          { status: 400 }
        );
      }
    } else if (postalCode.length > 12) {
      return Response.json(
        { error: "Postal code must be 12 characters or less." },
        { status: 400 }
      );
    }

    const phone = normalizeSingleSpaces(String(body.phone ?? ""));
    if (phone) {
      const phoneDigits = normalizeDigits(phone);
      if (phoneDigits.length !== 10) {
        return Response.json(
          { error: "Phone is not valid. Use a 10-digit US phone number." },
          { status: 400 }
        );
      }
    }

    const email = String(body.email ?? "").trim();
    if (email && !isValidDriverEmail(email)) {
      return Response.json({ error: "Email is not valid." }, { status: 400 });
    }

    const onlyLocal = String(body.onlyLocal ?? "no").trim().toLowerCase();
    if (onlyLocal !== "yes" && onlyLocal !== "no") {
      return Response.json({ error: "Only Local must be Yes or No." }, { status: 400 });
    }

    const assignedTruckUnitNumber = String(body.assignedTruckUnitNumber ?? "").trim();
    if (assignedTruckUnitNumber.length > 20) {
      return Response.json(
        { error: "Assigned Truck Unit# must be 20 characters or less." },
        { status: 400 }
      );
    }

    const licenseNumber = String(body.licenseNumber ?? "").trim().toUpperCase();
    if (licenseNumber && !DRIVER_LICENSE_PATTERN.test(licenseNumber)) {
      return Response.json(
        { error: "License Number is not valid. Use 5-20 letters/numbers only." },
        { status: 400 }
      );
    }

    const notes = String(body.notes ?? "").trim();
    if (notes.length > DRIVER_NOTES_MAX_LENGTH) {
      return Response.json(
        { error: `Notes must be ${DRIVER_NOTES_MAX_LENGTH} characters or less.` },
        { status: 400 }
      );
    }

    const driverData = {
      tenant_id: appUser.tenantId,
      first_name: normalizeSingleSpaces(firstName),
      last_name: normalizeSingleSpaces(lastName) || null,
      street_address: streetAddress || null,
      city: city || null,
      state_province: stateProvince || null,
      postal_code: postalCode || null,
      country: country || null,
      phone: phone || null,
      email: email || null,
      only_local: onlyLocal,
      assigned_truck_unit_number: assignedTruckUnitNumber || null,
      license_number: licenseNumber || null,
      cdl_class: String(body.cdlClass ?? "A"),
      status: String(body.status ?? "active"),
      notes: notes || null,
      created_by: null,
    };

    const { data, error } = await supabase.from("drivers").insert([driverData]).select().single();

    if (error) {
      return Response.json({ error: error.message || "Unable to create driver." }, { status: 400 });
    }

    return Response.json(data, { status: 201 });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}
