import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const SAMSARA_STATS_URL = "https://api.samsara.com/fleet/vehicles/stats";

type FaultCodeEntry = {
  sourceKeyIndex: number;
  vehicleId: string;
  vehicleName?: string;
  faultCodes: unknown;
  rawVehicle: Record<string, unknown>;
};

type TokenFetchSuccess = {
  sourceKeyIndex: number;
  pagesFetched: number;
  rawPages: Record<string, unknown>[];
  faults: FaultCodeEntry[];
};

type TokenFetchFailure = {
  sourceKeyIndex: number;
  status?: number;
  message: string;
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

function extractAfterCursor(page: Record<string, unknown>): string | null {
  const pagination = asRecord(page.pagination);
  if (!pagination) return null;

  const endCursor = pagination.endCursor;
  if (typeof endCursor === "string" && endCursor.trim().length > 0) {
    return endCursor;
  }

  return null;
}

function extractFaultCodes(row: Record<string, unknown>): unknown {
  if (row.faultCodes !== undefined) return row.faultCodes;

  const stats = asRecord(row.stats);
  if (stats && stats.faultCodes !== undefined) return stats.faultCodes;

  return undefined;
}

function toFaultEntry(sourceKeyIndex: number, row: Record<string, unknown>): FaultCodeEntry {
  const vehicle = asRecord(row.vehicle);

  const vehicleId =
    String(
      row.vehicleId ??
        vehicle?.id ??
        row.id ??
        "unknown"
    );

  const vehicleName =
    typeof row.name === "string"
      ? row.name
      : typeof vehicle?.name === "string"
        ? vehicle.name
        : undefined;

  return {
    sourceKeyIndex,
    vehicleId,
    vehicleName,
    faultCodes: extractFaultCodes(row),
    rawVehicle: row,
  };
}

async function fetchFaultCodesFromToken(token: string, sourceKeyIndex: number): Promise<TokenFetchSuccess> {
  const rawPages: Record<string, unknown>[] = [];
  const faults: FaultCodeEntry[] = [];

  let after: string | null = null;
  let pageGuard = 0;

  while (pageGuard < 50) {
    const params = new URLSearchParams({
      types: "faultCodes",
      limit: "200",
    });

    if (after) params.set("after", after);

    const response = await fetch(`${SAMSARA_STATS_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.error === "string"
            ? payload.error
            : `Samsara stats request failed (${response.status})`;

      const failure: TokenFetchFailure = {
        sourceKeyIndex,
        status: response.status,
        message,
      };

      throw failure;
    }

    rawPages.push(payload);

    const rows = extractRows(payload);
    for (const row of rows) {
      faults.push(toFaultEntry(sourceKeyIndex, row));
    }

    const nextAfter = extractAfterCursor(payload);
    if (!nextAfter) break;

    after = nextAfter;
    pageGuard += 1;
  }

  return {
    sourceKeyIndex,
    pagesFetched: rawPages.length,
    rawPages,
    faults,
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

    const settled = await Promise.allSettled(
      keys.map((token, sourceKeyIndex) => fetchFaultCodesFromToken(token, sourceKeyIndex))
    );

    const successes = settled
      .filter((result): result is PromiseFulfilledResult<TokenFetchSuccess> => result.status === "fulfilled")
      .map((result) => result.value);

    const failures = settled
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => {
        const reason = result.reason as TokenFetchFailure | Error | unknown;

        const record = asRecord(reason);
        const sourceKeyIndex = typeof record?.sourceKeyIndex === "number" ? record.sourceKeyIndex : -1;
        const status = typeof record?.status === "number" ? record.status : undefined;
        const message =
          typeof record?.message === "string"
            ? record.message
            : reason instanceof Error
              ? reason.message
              : "Unknown Samsara failure";

        return { sourceKeyIndex, status, message };
      });

    const faults = successes.flatMap((result) => result.faults);

    const allForbidden = failures.length > 0 && failures.every((failure) => failure.status === 401 || failure.status === 403);

    return NextResponse.json(
      {
        keyCount: keys.length,
        successCount: successes.length,
        failureCount: failures.length,
        faults,
        failures,
        guidance: allForbidden
          ? "Samsara token likely missing 'Read Vehicle Statistics' scope for faultCodes."
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
