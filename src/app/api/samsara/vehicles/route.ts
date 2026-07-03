import { NextResponse } from "next/server";

const SAMSARA_BASE_URL = "https://api.samsara.com/fleet/vehicles/locations";
const HOME_BASE_ADDRESS = {
  streetAddress: "10967 Locust Avenue",
  city: "Bloomington",
  stateProvince: "CA",
} as const;
const HOME_RADIUS_MILES = 1.5;

type HomeBaseLocation = {
  latitude: number;
  longitude: number;
};

type NormalizedVehicle = {
  id: string;
  truckNo: string;
  driver: string;
  location: string;
  status: "moving" | "idle" | "alert";
  atHome: boolean;
  homeDistanceMiles?: number;
  mph?: number;
  fuelLevel?: number;
  eta?: string;
  latitude?: number;
  longitude?: number;
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickCoordinate(source: Record<string, unknown>, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const value = asNumber(source[key]);
    if (typeof value === "number") return value;
  }
  return undefined;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function distanceMiles(a: HomeBaseLocation, b: HomeBaseLocation): number {
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(b.latitude - a.latitude);
  const lonDelta = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function isNearHomeBase(
  vehicleLocation: HomeBaseLocation | null,
  homeBase: HomeBaseLocation | null
): { atHome: boolean; homeDistanceMiles?: number } {
  if (!vehicleLocation || !homeBase) {
    return { atHome: false };
  }

  const homeDistanceMiles = distanceMiles(homeBase, vehicleLocation);
  return {
    atHome: homeDistanceMiles <= HOME_RADIUS_MILES,
    homeDistanceMiles,
  };
}

function extractVehicleRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  if (Array.isArray(root.data)) {
    return root.data.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  }

  if (Array.isArray(root.vehicles)) {
    return root.vehicles.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  }

  return [];
}

function normalizeVehicle(row: Record<string, unknown>, index: number): NormalizedVehicle {
  const gps = (row.gps as Record<string, unknown> | undefined) ?? {};
  const locationObj = (row.location as Record<string, unknown> | undefined) ?? {};
  const reverseGeo = (locationObj.reverseGeo as Record<string, unknown> | undefined) ?? {};
  const homeBase: HomeBaseLocation | null = null;

  const latitude =
    pickCoordinate(row, ["latitude", "lat"]) ??
    pickCoordinate(gps, ["latitude", "lat"]) ??
    pickCoordinate(locationObj, ["latitude", "lat"]);

  const longitude =
    pickCoordinate(row, ["longitude", "lng", "lon"]) ??
    pickCoordinate(gps, ["longitude", "lng", "lon"]) ??
    pickCoordinate(locationObj, ["longitude", "lng", "lon"]);

  const mph =
    asNumber(row.speed) ??
    asNumber(row.speedMph) ??
    asNumber(gps.speed) ??
    asNumber(locationObj.speed);
  const fuelLevel = asNumber(row.fuelLevelPercent) ?? asNumber(row.fuelPercent);
  const hasAlert = Boolean(row.hasFaults) || Boolean(row.alert) || Boolean((row.faults as unknown[] | undefined)?.length);

  const formattedLocation = typeof reverseGeo.formattedLocation === "string" ? reverseGeo.formattedLocation : "";
  const city = typeof locationObj.city === "string" ? locationObj.city : "";
  const state = typeof locationObj.state === "string" ? locationObj.state : "";
  const locationHint = `${formattedLocation} ${city} ${state}`.toLowerCase();
  const atHomeFromHint = /bloomington|10967\s+locust|locust avenue|92316/.test(locationHint);
  const homePosition = latitude !== undefined && longitude !== undefined ? { latitude, longitude } : null;
  const proximity = isNearHomeBase(homePosition, homeBase);

  let status: "moving" | "idle" | "alert" = "idle";
  if (hasAlert) status = "alert";
  else if ((mph ?? 0) > 3) status = "moving";

  const atHome = status !== "moving" && (proximity.atHome || atHomeFromHint);

  return {
    id: String(row.id ?? row.vehicleId ?? `samsara-${index}`),
    truckNo: String(row.name ?? row.externalIds ?? row.vin ?? `Truck-${index + 1}`),
    driver: String((row.driverName as string | undefined) ?? (row.assignedDriver as string | undefined) ?? "Unassigned"),
    location: formattedLocation || (city || state ? `${city}${city && state ? ", " : ""}${state}` : "Location unavailable"),
    status,
    atHome,
    homeDistanceMiles: proximity.homeDistanceMiles,
    mph,
    fuelLevel,
    eta: typeof row.eta === "string" ? row.eta : undefined,
    latitude,
    longitude,
  };
}

export async function GET() {
  const token = process.env.SAMSARA_BEARER_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "Missing SAMSARA_BEARER_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${SAMSARA_BASE_URL}?limit=50`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: "Samsara request failed", details: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    const vehicles = extractVehicleRows(data).map(normalizeVehicle);
    return NextResponse.json({ vehicles, rawCount: vehicles.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to contact Samsara API",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
