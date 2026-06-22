export async function lookupUsZipFromAddress(input: {
  streetAddress: string;
  city: string;
  stateProvince: string;
}) {
  const result = await lookupUsAddressDetails(input);
  return result?.zip ?? null;
}

export async function lookupUsCoordinatesFromAddress(input: {
  streetAddress: string;
  city: string;
  stateProvince: string;
}) {
  const result = await lookupUsAddressDetails(input);
  if (!result) return null;
  return {
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

async function lookupUsAddressDetails(input: {
  streetAddress: string;
  city: string;
  stateProvince: string;
}) {
  const streetAddress = input.streetAddress.trim();
  const city = input.city.trim();
  const stateProvince = input.stateProvince.trim();

  if (!streetAddress || !city || !stateProvince) {
    return null;
  }

  const oneLineAddress = `${streetAddress}, ${city}, ${stateProvince}`;
  const query = new URLSearchParams({
    address: oneLineAddress,
    benchmark: "Public_AR_Current",
    format: "json",
  });

  try {
    const response = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query.toString()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: {
            x?: number;
            y?: number;
          };
          addressComponents?: {
            zip?: string;
          };
        }>;
      };
    };

    const match = payload.result?.addressMatches?.[0];
    const latitude = typeof match?.coordinates?.y === "number" ? match.coordinates.y : null;
    const longitude = typeof match?.coordinates?.x === "number" ? match.coordinates.x : null;
    const zip = match?.addressComponents?.zip?.trim() || null;

    if (latitude === null || longitude === null) {
      return null;
    }

    return { latitude, longitude, zip };
  } catch {
    return null;
  }
}
