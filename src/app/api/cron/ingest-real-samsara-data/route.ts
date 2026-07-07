import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Cron job to ingest real Samsara data into analytics tables
 * 
 * Flow:
 * 1. Fetch distinct Samsara API keys from organizations table
 * 2. For each key, fetch safety events and vehicle stats from last N days
 * 3. Transform into driver_analytics_events and driver_analytics_snapshots
 * 4. Upsert to avoid duplicates (supports re-runs and different time windows)
 * 
 * GET /api/cron/ingest-real-samsara-data?days=30
 * POST /api/cron/ingest-real-samsara-data (body: { days: 30 })
 */

type SafetyEvent = {
  id: string;
  driverId: string;
  driverName?: string;
  vehicleId: string;
  vehicleName?: string;
  type: string;
  timestamp: string;
  location?: string;
  speed?: number;
  gForce?: number;
  postedLimit?: number;
  [key: string]: unknown;
};

type VehicleStats = {
  vehicleId: string;
  vehicleName?: string;
  timestamp: string;
  fuelEfficiency?: number;
  idlePercentage?: number;
  engineHours?: number;
  distance?: number;
  [key: string]: unknown;
};

async function getSamsaraKeys(): Promise<string[]> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("organizations")
    .select("samsara_api_key")
    .not("samsara_api_key", "is", null);

  const uniqueKeys = new Set<string>();
  for (const row of data ?? []) {
    const key = typeof row.samsara_api_key === "string" ? row.samsara_api_key.trim() : "";
    if (key) uniqueKeys.add(key);
  }

  return Array.from(uniqueKeys);
}

async function fetchSafetyEventsFromSamsara(
  apiKey: string,
  days: number
): Promise<SafetyEvent[]> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    limit: "1000",
  });

  try {
    const response = await fetch(`https://api.samsara.com/safety-events?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`Samsara safety-events failed: ${response.status}`, await response.text());
      return [];
    }

    const data = await response.json();
    return Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    console.error("Error fetching Samsara safety events:", error);
    return [];
  }
}

async function fetchVehicleStatsFromSamsara(
  apiKey: string,
  days: number
): Promise<VehicleStats[]> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    limit: "1000",
  });

  try {
    const response = await fetch(`https://api.samsara.com/fleet/vehicles/stats?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`Samsara vehicles/stats failed: ${response.status}`, await response.text());
      return [];
    }

    const data = await response.json();
    return Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    console.error("Error fetching Samsara vehicle stats:", error);
    return [];
  }
}

async function transformAndIngestEvents(
  tenantId: string,
  events: SafetyEvent[]
): Promise<{ ingested: number; errors: string[] }> {
  const supabase = await getSupabaseServerClient();
  const errors: string[] = [];
  let ingested = 0;

  // Map event types to driver_analytics_events format
  const eventTypeMap: Record<string, string> = {
    harshBraking: "harsh_brake_incident",
    harshAcceleration: "harsh_accel_incident",
    harshCorner: "harsh_corner_incident",
    speeding: "speeding_incident",
    followingDistance: "following_distance_incident",
    laneSwitch: "lane_switch_incident",
    distraction: "distraction_incident",
  };

  for (const event of events) {
    try {
      const eventType = eventTypeMap[event.type] || event.type.toLowerCase().replace(/([A-Z])/g, "_$1").substring(1);
      const eventDate = new Date(event.timestamp).toISOString().split("T")[0];

      // Extract details based on event type
      const details: Record<string, unknown> = {
        location: event.location || "Unknown",
        source: "samsara",
        severity: calculateSeverity(event.type),
      };

      if (event.gForce !== undefined) details.gforce_magnitude = event.gForce;
      if (event.speed !== undefined) details.speed = event.speed;
      if (event.postedLimit !== undefined) details.posted_limit = event.postedLimit;

      // Build insert object matching schema: tenant_id, driver_id, truck_unit_number, event_date, event_timestamp, event_type, data_source, source_id, status, details
      const insertData = {
        tenant_id: tenantId,
        driver_id: event.driverId,
        truck_unit_number: event.vehicleName || "Unknown",
        event_date: eventDate,
        event_timestamp: event.timestamp,
        event_type: eventType,
        data_source: "samsara",
        source_id: event.id,
        status: "confirmed",
        details,
      };

      // Upsert to driver_analytics_events
      const { error } = await supabase.from("driver_analytics_events").upsert(
        insertData,
        {
          onConflict: "tenant_id,driver_id,event_type,event_date,source_id", // Unique constraint
        }
      );

      if (error) {
        errors.push(`Event ${event.id}: ${error.message}`);
      } else {
        ingested++;
      }
    } catch (err) {
      errors.push(`Event ${event.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return { ingested, errors };
}

function calculateSeverity(eventType: string): "low" | "medium" | "high" {
  const highSeverity = ["harshBraking", "harshAcceleration", "speeding"];
  const mediumSeverity = ["harshCorner", "followingDistance"];
  
  if (highSeverity.some(t => eventType.includes(t))) return "high";
  if (mediumSeverity.some(t => eventType.includes(t))) return "medium";
  return "low";
}

async function aggregateDailySnapshots(
  tenantId: string,
  days: number
): Promise<{ updated: number; errors: string[] }> {
  const supabase = await getSupabaseServerClient();
  const errors: string[] = [];

  // Get all unique driver/date combinations from events in the last N days
  const { data: events, error: queryError } = await supabase
    .from("driver_analytics_events")
    .select("driver_id, event_date, event_type, event_count")
    .eq("tenant_id", tenantId)
    .eq("data_source", "samsara")
    .gte("event_date", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

  if (queryError) {
    errors.push(`Failed to query events: ${queryError.message}`);
    return { updated: 0, errors };
  }

  // Group by driver_id and event_date to count events
  const snapshotMap = new Map<string, { driver_id: string; event_date: string; event_counts: Record<string, number> }>();

  for (const event of events ?? []) {
    const key = `${event.driver_id}|${event.event_date}`;
    if (!snapshotMap.has(key)) {
      snapshotMap.set(key, {
        driver_id: event.driver_id,
        event_date: event.event_date,
        event_counts: {},
      });
    }

    const snapshot = snapshotMap.get(key)!;
    snapshot.event_counts[event.event_type] = (snapshot.event_counts[event.event_type] || 0) + (event.event_count || 1);
  }

  // Upsert snapshots into driver_analytics_snapshots
  let updated = 0;
  for (const snapshot of snapshotMap.values()) {
    const { error } = await supabase.from("driver_analytics_snapshots").upsert(
      {
        tenant_id: tenantId,
        driver_id: snapshot.driver_id,
        snapshot_date: snapshot.event_date,
        data_source: "samsara",
        raw_events_count: Object.values(snapshot.event_counts).reduce((a, b) => a + b, 0),
        details: snapshot.event_counts,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "tenant_id,driver_id,snapshot_date,data_source",
      }
    );

    if (error) {
      errors.push(`Snapshot ${snapshot.driver_id}/${snapshot.event_date}: ${error.message}`);
    } else {
      updated++;
    }
  }

  return { updated, errors };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get("days") || "30"), 90); // Cap at 90 days
  const dryRun = searchParams.get("dryRun") === "true";

  try {
    console.log(`[Ingestion] Starting real Samsara data ingestion for ${days} days (dryRun: ${dryRun})`);

    const apiKeys = await getSamsaraKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json(
        { error: "No Samsara API keys configured", message: "Add API keys to organizations table" },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // Get tenant_id from first user (assuming single tenant for now)
    const { data: firstOrg } = await supabase.from("organizations").select("tenant_id").limit(1);
    if (!firstOrg || !firstOrg[0]) {
      return NextResponse.json(
        { error: "No organizations found", message: "Set up organizations first" },
        { status: 400 }
      );
    }

    const tenantId = firstOrg[0].tenant_id;

    // Fetch from all Samsara API keys in parallel
    const allSafetyEvents: SafetyEvent[] = [];
    const allVehicleStats: VehicleStats[] = [];

    const results = await Promise.all(
      apiKeys.map(async (apiKey) => {
        const [safetyEvents, vehicleStats] = await Promise.all([
          fetchSafetyEventsFromSamsara(apiKey, days),
          fetchVehicleStatsFromSamsara(apiKey, days),
        ]);
        return { safetyEvents, vehicleStats };
      })
    );

    for (const result of results) {
      allSafetyEvents.push(...result.safetyEvents);
      allVehicleStats.push(...result.vehicleStats);
    }

    console.log(`[Ingestion] Fetched ${allSafetyEvents.length} safety events and ${allVehicleStats.length} vehicle stats`);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        days,
        apiKeysUsed: apiKeys.length,
        safetyEventsFetched: allSafetyEvents.length,
        vehicleStatsFetched: allVehicleStats.length,
        message: "Dry run complete - no data persisted",
      });
    }

    // Ingest events
    const { ingested, errors: eventErrors } = await transformAndIngestEvents(tenantId, allSafetyEvents);
    console.log(`[Ingestion] Ingested ${ingested} events`);

    // Aggregate daily snapshots
    const { updated, errors: snapshotErrors } = await aggregateDailySnapshots(tenantId, days);
    console.log(`[Ingestion] Updated ${updated} daily snapshots`);

    const allErrors = [...eventErrors, ...snapshotErrors];

    return NextResponse.json({
      success: true,
      days,
      apiKeysUsed: apiKeys.length,
      safetyEventsFetched: allSafetyEvents.length,
      eventsIngested: ingested,
      snapshotsUpdated: updated,
      errors: allErrors.length > 0 ? allErrors.slice(0, 10) : [], // Show first 10 errors
      errorCount: allErrors.length,
      message: `Ingested ${ingested} events and updated ${updated} snapshots from real Samsara data`,
    });
  } catch (error) {
    console.error("[Ingestion] Fatal error:", error);
    return NextResponse.json(
      {
        error: "Ingestion failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const days = Math.min(body.days || 30, 90); // Cap at 90 days
    const url = new URL(request.url);
    url.searchParams.set("days", String(days));

    // Call GET with days parameter
    return GET(new Request(url.toString()));
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
