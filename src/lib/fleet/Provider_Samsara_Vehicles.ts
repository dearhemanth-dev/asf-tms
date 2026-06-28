import { NextResponse } from "next/server";
import { lookupUsCoordinatesFromAddress } from "@/lib/us-zip-lookup";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

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
  assetLabel?: string;
  assetType?: string;
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

type TenantVehicleLookups = {
  driverByUnit: Map<string, string>;
  assetTypeByUnit: Map<string, string>;
};

function normalizeUnitKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/^TRUCK\s*#?\s*/i, "")
    .replace(/^UNIT\s*#?\s*/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function toDisplayName(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "";

  if (compact === compact.toUpperCase()) {
    return compact
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return compact;
}

function toAssetLabel(truckNo: string, assetType?: string): string {
  const unit = truckNo.trim();
  if (!unit) return truckNo;

  if (assetType && assetType.trim().toLowerCase() === "truck") {
    return `Truck#${unit.replace(/^TRUCK\s*#?/i, "").trim()}`;
  }

  return unit;
}

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

function normalizeVehicle(
  row: Record<string, unknown>,
  index: number,
  homeBase: HomeBaseLocation | null,
  lookups: TenantVehicleLookups,
  sourcePrefix = ""
): NormalizedVehicle {
  const gps = (row.gps as Record<string, unknown> | undefined) ?? {};
  const locationObj = (row.location as Record<string, unknown> | undefined) ?? {};
  const reverseGeo = (locationObj.reverseGeo as Record<string, unknown> | undefined) ?? {};

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

  const rawTruckNo = String(row.name ?? row.externalIds ?? row.vin ?? `Truck-${index + 1}`);
  const unitKey = normalizeUnitKey(rawTruckNo);
  const assetType = lookups.assetTypeByUnit.get(unitKey);

  const samsaraDriver = String((row.driverName as string | undefined) ?? (row.assignedDriver as string | undefined) ?? "").trim();
  const dbDriver = lookups.driverByUnit.get(unitKey) ?? "";
  const resolvedDriver =
    samsaraDriver && samsaraDriver.toLowerCase() !== "unassigned"
      ? samsaraDriver
      : dbDriver || "Unassigned";

  return {
    id: `${sourcePrefix}${String(row.id ?? row.vehicleId ?? `samsara-${index}`)}`,
    truckNo: rawTruckNo,
    driver: toDisplayName(resolvedDriver),
    assetType,
    assetLabel: toAssetLabel(rawTruckNo, assetType),
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

async function getTenantVehicleLookups(request: Request): Promise<TenantVehicleLookups> {
  const appUser = await getAppSessionUser(request);
  if (!appUser?.tenantId) {
    return { driverByUnit: new Map(), assetTypeByUnit: new Map() };
  }

  const supabase = await getSupabaseServerClient();
  const [{ data: drivers }, { data: assets }] = await Promise.all([
    supabase
      .from("drivers")
      .select("first_name, last_name, assigned_truck_unit_number")
      .eq("tenant_id", appUser.tenantId)
      .not("assigned_truck_unit_number", "is", null),
    supabase
      .from("assets")
      .select("asset_no, asset_unit_number, asset_type")
      .eq("tenant_id", appUser.tenantId),
  ]);

  const driverByUnit = new Map<string, string>();
  for (const row of drivers ?? []) {
    const unit = String(row.assigned_truck_unit_number ?? "").trim();
    const key = normalizeUnitKey(unit);
    if (!key) continue;

    const firstName = String(row.first_name ?? "").trim();
    const lastName = String(row.last_name ?? "").trim();
    const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();
    if (fullName) {
      driverByUnit.set(key, toDisplayName(fullName));
    }
  }

  const assetTypeByUnit = new Map<string, string>();
  for (const row of assets ?? []) {
    const assetType = String(row.asset_type ?? "").trim();
    if (!assetType) continue;

    const rawKeys = [String(row.asset_no ?? "").trim(), String(row.asset_unit_number ?? "").trim()];
    for (const rawKey of rawKeys) {
      const key = normalizeUnitKey(rawKey);
      if (!key) continue;
      if (!assetTypeByUnit.has(key)) {
        assetTypeByUnit.set(key, assetType);
      }
    }
  }

  return { driverByUnit, assetTypeByUnit };
}

async function getDistinctSamsaraKeys(request: Request): Promise<string[]> {
  const appUser = await getAppSessionUser(request);
  if (!appUser?.tenantId) return [];

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("samsara_api_key")
    .eq("tenant_id", appUser.tenantId)
    .not("samsara_api_key", "is", null);

  const uniqueKeys = new Set<string>();
  for (const row of data ?? []) {
    const candidate = typeof row.samsara_api_key === "string" ? row.samsara_api_key.trim() : "";
    if (candidate) uniqueKeys.add(candidate);
  }

  return Array.from(uniqueKeys);
}

async function fetchVehiclesFromToken(
  token: string,
  sourceIndex: number,
  homeBaseCoordinates: HomeBaseLocation | null,
  lookups: TenantVehicleLookups
): Promise<NormalizedVehicle[]> {
  const response = await fetch(`${SAMSARA_BASE_URL}?limit=50`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Samsara request failed with status ${response.status}`);
  }

  const data = await response.json();
  return extractVehicleRows(data).map((row, index) =>
    normalizeVehicle(row, index, homeBaseCoordinates, lookups, `org${sourceIndex}-`)
  );
}

export async function GET(request: Request) {
  const fallbackToken = process.env.SAMSARA_BEARER_TOKEN;

  try {
    const homeBaseCoordinates = await lookupUsCoordinatesFromAddress(HOME_BASE_ADDRESS);
    const lookups = await getTenantVehicleLookups(request);
    const orgKeys = await getDistinctSamsaraKeys(request);
    const keys = orgKeys.length > 0 ? orgKeys : fallbackToken ? [fallbackToken] : [];

    if (keys.length === 0) {
      return NextResponse.json({ vehicles: [], rawCount: 0, error: "No Samsara API keys configured" }, { status: 200 });
    }

    const settled = await Promise.allSettled(
      keys.map((token, sourceIndex) => fetchVehiclesFromToken(token, sourceIndex, homeBaseCoordinates, lookups))
    );

    const vehicles = settled
      .filter((result): result is PromiseFulfilledResult<NormalizedVehicle[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);

    if (vehicles.length === 0) {
      const failureCount = settled.filter((result) => result.status === "rejected").length;
      return NextResponse.json(
        {
          vehicles: [],
          rawCount: 0,
          error: failureCount > 0 ? "Unable to fetch from configured Samsara keys" : "No live vehicles found",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ vehicles, rawCount: vehicles.length, keyCount: keys.length });
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
