import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const SAMSARA_STATS_URL = "https://api.samsara.com/fleet/vehicles/stats";

const REQUESTED_STATS_TYPES = [
  "faultCodes",
  "engineCoolantTemperatureMilliC",
  "engineOilPressureKPa",
  "engineLoadPercent",
  "obdEngineSeconds",
  "gps",
  "fuelPercent",
  "obdOdometerMeters",
  "engineRpm",
  "batteryMilliVolts",
  "fuelConsumedMilliliters",
  "idlingDurationMilliseconds",
  "defLevelMilliPercent",
  "engineState",
  "barometricPressurePa",
  "ecuSpeedMph",
] as const;

const STATS_SNAPSHOT_TYPES = [
  "faultCodes",
  "engineCoolantTemperatureMilliC",
  "engineOilPressureKPa",
  "engineLoadPercent",
  "obdEngineSeconds",
  "gps",
  "fuelPercents",
  "obdOdometerMeters",
  "defLevelMilliPercent",
  "engineStates",
  "barometricPressurePa",
  "batteryMilliVolts",
  "fuelConsumedMilliliters",
  "idlingDurationMilliseconds",
  "engineRpm",
  "ecuSpeedMph",
] as const;

const MAX_TYPES_PER_REQUEST = 4;
const SAMSARA_REQUEST_TIMEOUT_MS = 15_000;

type FaultCodeEntry = {
  sourceKeyIndex: number;
  vehicleId: string;
  vehicleName?: string;
  faultCodes: unknown;
  stats: Record<string, unknown>;
  rawVehicle: Record<string, unknown>;
};

type TokenFetchSuccess = {
  sourceKeyIndex: number;
  pagesFetched: number;
  rawPages: Record<string, unknown>[];
  requestedBatches: string[][];
  faults: FaultCodeEntry[];
  failures: TokenFetchFailure[];
};

type TokenFetchFailure = {
  sourceKeyIndex: number;
  status?: number;
  requestedTypes?: string[];
  message: string;
};

type ChunkFetchResult = {
  rows: Record<string, unknown>[];
  rawPages: Record<string, unknown>[];
};

type ApiResult = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function extractRows(page: Record<string, unknown>): Record<string, unknown>[] {
  return asArray(page.data)
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

function extractFaultCodes(row: Record<string, unknown>): unknown {
  if (row.faultCodes !== undefined) return row.faultCodes;

  const stats = asRecord(row.stats);
  if (stats && stats.faultCodes !== undefined) return stats.faultCodes;

  return undefined;
}

function chunkTypes(types: readonly string[], chunkSize: number): string[][] {
  const uniqueTypes = Array.from(new Set(types));
  const safeChunkSize = Math.max(1, Math.min(chunkSize, 4));
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueTypes.length; index += safeChunkSize) {
    chunks.push(uniqueTypes.slice(index, index + safeChunkSize));
  }
  return chunks;
}

function extractStats(row: Record<string, unknown>): Record<string, unknown> {
  const fromStats = asRecord(row.stats);
  const stats: Record<string, unknown> = fromStats ? { ...fromStats } : {};

  if (row.engineState !== undefined) stats.engineState = row.engineState;
  if (row.fuelPercent !== undefined) stats.fuelPercent = row.fuelPercent;

  for (const type of REQUESTED_STATS_TYPES) {
    if (row[type] !== undefined) {
      stats[type] = row[type];
    }
  }

  return stats;
}

function getVehicleIdentity(row: Record<string, unknown>): { vehicleId: string; vehicleName?: string } {
  const vehicle = asRecord(row.vehicle);

  const vehicleId = String(row.vehicleId ?? vehicle?.id ?? row.id ?? "unknown");

  const vehicleName =
    typeof row.name === "string"
      ? row.name
      : typeof vehicle?.name === "string"
        ? vehicle.name
        : undefined;

  return { vehicleId, vehicleName };
}

function toFaultEntry(sourceKeyIndex: number, row: Record<string, unknown>): FaultCodeEntry {
  const { vehicleId, vehicleName } = getVehicleIdentity(row);
  const stats = extractStats(row);

  const statTypeSet = new Set<string>(REQUESTED_STATS_TYPES);
  const rawVehicleBase: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!statTypeSet.has(key) && key !== "stats") {
      rawVehicleBase[key] = value;
    }
  }

  return {
    sourceKeyIndex,
    vehicleId,
    vehicleName,
    faultCodes: stats.faultCodes ?? extractFaultCodes(row),
    stats,
    rawVehicle: {
      ...rawVehicleBase,
      stats,
    },
  };
}

async function fetchStatsChunkFromToken(token: string, requestedTypes: string[]): Promise<ChunkFetchResult> {
  const params = new URLSearchParams({
    types: requestedTypes.join(","),
    limit: "200",
  });

  const result = await callSamsara(token, `${SAMSARA_STATS_URL}?${params.toString()}`);
  if (!result.ok) {
    throw {
      status: result.status,
      requestedTypes,
      message: extractErrorMessage(result.payload, result.status, "Samsara stats request failed"),
    } as TokenFetchFailure;
  }

  return {
    rows: extractRows(result.payload),
    rawPages: [result.payload],
  };
}

function extractErrorMessage(payload: Record<string, unknown>, status: number, fallback: string) {
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  return `${fallback} (${status})`;
}

async function callSamsara(token: string, url: string): Promise<ApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAMSARA_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return {
        ok: false,
        status: 408,
        payload: { message: `Samsara request timed out after ${SAMSARA_REQUEST_TIMEOUT_MS}ms` },
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFaultCodesFromToken(token: string, sourceKeyIndex: number): Promise<TokenFetchSuccess> {
  const rawPages: Record<string, unknown>[] = [];
  const failures: TokenFetchFailure[] = [];
  const requestedBatches = chunkTypes(STATS_SNAPSHOT_TYPES, MAX_TYPES_PER_REQUEST);
  const vehicleMap = new Map<string, FaultCodeEntry>();
  const seenBatchSignatures = new Set<string>();

  for (const requestedTypes of requestedBatches) {
    const batchSignature = requestedTypes.join(",");
    if (seenBatchSignatures.has(batchSignature)) {
      continue;
    }
    seenBatchSignatures.add(batchSignature);

    try {
      const chunk = await fetchStatsChunkFromToken(token, requestedTypes);
      rawPages.push(...chunk.rawPages);

      for (const row of chunk.rows) {
        const entry = toFaultEntry(sourceKeyIndex, row);
        const mergeKey = `${entry.sourceKeyIndex}:${entry.vehicleId}`;
        const existing = vehicleMap.get(mergeKey);

        if (!existing) {
          vehicleMap.set(mergeKey, entry);
          continue;
        }

        const mergedStats = { ...existing.stats, ...entry.stats };
        const mergedRawVehicle = {
          ...existing.rawVehicle,
          ...entry.rawVehicle,
          stats: mergedStats,
        };

        vehicleMap.set(mergeKey, {
          ...existing,
          vehicleName: existing.vehicleName ?? entry.vehicleName,
          stats: mergedStats,
          faultCodes: mergedStats.faultCodes ?? existing.faultCodes,
          rawVehicle: mergedRawVehicle,
        });
      }
    } catch (error) {
      const failureRecord = asRecord(error);
      failures.push({
        sourceKeyIndex,
        status: typeof failureRecord?.status === "number" ? failureRecord.status : undefined,
        requestedTypes,
        message:
          typeof failureRecord?.message === "string"
            ? failureRecord.message
            : error instanceof Error
              ? error.message
              : "Unknown Samsara failure",
      });
    }
  }

  return {
    sourceKeyIndex,
    pagesFetched: rawPages.length,
    rawPages,
    requestedBatches,
    faults: Array.from(vehicleMap.values()),
    failures,
  };
}

export async function GET(request: Request) {
  const fallbackToken = process.env.SAMSARA_BEARER_TOKEN;

  try {
    const orgKeys = await getDistinctSamsaraKeys(request);
    const keys = orgKeys.length > 0 ? orgKeys : fallbackToken ? [fallbackToken] : [];

    if (keys.length === 0) {
      return NextResponse.json(
        {
          faults: [],
          keyCount: 0,
          error: "No Samsara API keys configured",
        },
        { status: 200 }
      );
    }

    const successes = await Promise.all(keys.map((token, sourceKeyIndex) => fetchFaultCodesFromToken(token, sourceKeyIndex)));

    const failures = successes.flatMap((result) => result.failures);

    const faults = successes.flatMap((result) => result.faults);
    const requestedBatches = successes[0]?.requestedBatches ?? chunkTypes(REQUESTED_STATS_TYPES, MAX_TYPES_PER_REQUEST);

    const allForbidden = failures.length > 0 && failures.every((failure) => failure.status === 401 || failure.status === 403);

    return NextResponse.json(
      {
        requestedTypes: REQUESTED_STATS_TYPES,
        requestedBatches,
        keyCount: keys.length,
        successCount: successes.length,
        failureCount: failures.length,
        faults,
        failures,
        guidance: allForbidden
          ? "Samsara token likely missing 'Read Vehicle Statistics' scope for one or more requested stats types."
          : undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to fetch Samsara fault codes",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
