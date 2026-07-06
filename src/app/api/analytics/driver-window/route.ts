import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * GET /api/analytics/driver-window
 * 
 * Query aggregated driver metrics for a configurable time window.
 * 
 * Query Parameters:
 *   days: 7 | 30 | 90 (default: 7)
 * 
 * Response:
 *   {
 *     drivers: [
 *       {
 *         driver_id: UUID,
 *         driver_name: string,
 *         truck_unit_number: string,
 *         window_days: number,
 *         days_with_data: number,
 * 
 *         // Pillar 1: Safety (35%)
 *         harsh_braking_total: number,
 *         harsh_accel_total: number,
 *         harsh_corner_total: number,
 *         speeding_violations_total: number,
 * 
 *         // Pillar 2: Idling (20%)
 *         engine_minutes_total: number,
 *         idling_minutes_total: number,
 *         idling_ratio_avg: number,
 * 
 *         // Pillar 3: Fuel (15%)
 *         avg_fuel_level_mean: number,
 *         fuel_consumed_total_liters: number,
 *         low_fuel_events_total: number,
 * 
 *         // Pillar 4: DVIR/Compliance (15%)
 *         dvir_defects_total: number,
 *         maintenance_alerts_total: number,
 * 
 *         // Pillar 5: Maintenance (15%)
 *         fault_codes_total: number,
 *         coolant_high_events_total: number,
 *         oil_low_events_total: number,
 *         rpm_high_events_total: number,
 *         load_high_events_total: number,
 *       }
 *     ],
 *     window_days: number,
 *     total_drivers: number,
 *     query_time_ms: number
 *   }
 */

type AggregatedDriverMetrics = {
  driver_id: string;
  driver_name: string;
  truck_unit_number: string;
  window_days: number;
  days_with_data: number;

  // Safety
  harsh_braking_total: number;
  harsh_accel_total: number;
  harsh_corner_total: number;
  speeding_violations_total: number;

  // Idling
  engine_minutes_total: number;
  idling_minutes_total: number;
  idling_ratio_avg: number;

  // Fuel
  avg_fuel_level_mean: number;
  fuel_consumed_total_liters: number;
  low_fuel_events_total: number;

  // DVIR
  dvir_defects_total: number;
  maintenance_alerts_total: number;

  // Maintenance
  fault_codes_total: number;
  coolant_high_events_total: number;
  oil_low_events_total: number;
  rpm_high_events_total: number;
  load_high_events_total: number;
};

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse query parameters first (no auth needed for now)
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get("days") || "7";
    const validDays = [7, 30, 90];
    const days = validDays.includes(parseInt(daysParam))
      ? parseInt(daysParam)
      : 7;

    // Get Supabase client
    const supabase = await getSupabaseServerClient();

    // Get the first tenant (demo setup uses single tenant)
    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);

    if (tenantsError || !tenants || tenants.length === 0) {
      return NextResponse.json(
        { error: "No tenants found" },
        { status: 400 }
      );
    }

    const tenantId = tenants[0].id;

    // Query analytics snapshots for the time window
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    const { data: snapshots, error } = await supabase
      .from("driver_analytics_snapshots")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("snapshot_date", cutoffDateStr)
      .order("snapshot_date", { ascending: true });

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json(
        { error: "Failed to query analytics data" },
        { status: 500 }
      );
    }

    // Aggregate by driver
    const aggregateByDriver = new Map<
      string,
      {
        driver_id: string;
        driver_name?: string;
        truck_unit_number?: string;
        snapshot_count: number;
        metrics: Record<string, number>;
      }
    >();

    for (const snap of snapshots || []) {
      const key = snap.driver_id;

      if (!aggregateByDriver.has(key)) {
        aggregateByDriver.set(key, {
          driver_id: key,
          driver_name: snap.driver_name || undefined,
          truck_unit_number: snap.truck_unit_number || "Unknown",
          snapshot_count: 0,
          metrics: {
            harsh_braking: 0,
            harsh_accel: 0,
            harsh_corner: 0,
            speeding: 0,
            engine_minutes: 0,
            idling_minutes: 0,
            idling_ratio_sum: 0,
            fuel_avg_sum: 0,
            fuel_consumed: 0,
            low_fuel_events: 0,
            dvir_defects: 0,
            maintenance_alerts: 0,
            fault_codes: 0,
            coolant_high: 0,
            oil_low: 0,
            rpm_high: 0,
            load_high: 0,
          },
        });
      }

      const bucket = aggregateByDriver.get(key)!;
      bucket.snapshot_count += 1;

      // Accumulate metrics
      bucket.metrics.harsh_braking += snap.harsh_braking_count || 0;
      bucket.metrics.harsh_accel += snap.harsh_accel_count || 0;
      bucket.metrics.harsh_corner += snap.harsh_corner_count || 0;
      bucket.metrics.speeding += snap.speeding_violations || 0;
      bucket.metrics.engine_minutes += snap.engine_minutes || 0;
      bucket.metrics.idling_minutes += snap.idling_minutes || 0;
      bucket.metrics.idling_ratio_sum += snap.idling_ratio || 0;
      bucket.metrics.fuel_avg_sum += snap.avg_fuel_level || 0;
      bucket.metrics.fuel_consumed += snap.fuel_consumed_liters || 0;
      bucket.metrics.low_fuel_events += snap.low_fuel_events || 0;
      bucket.metrics.dvir_defects += snap.dvir_defects_count || 0;
      bucket.metrics.maintenance_alerts +=
        snap.maintenance_alerts_count || 0;
      bucket.metrics.fault_codes += snap.fault_codes_count || 0;
      bucket.metrics.coolant_high += snap.high_temp_events || 0;
      bucket.metrics.oil_low += snap.low_oil_events || 0;
      bucket.metrics.rpm_high += snap.high_rpm_events || 0;
      bucket.metrics.load_high += snap.high_load_events || 0;
    }

    // Format response
    const drivers: AggregatedDriverMetrics[] = Array.from(
      aggregateByDriver.values()
    ).map((bucket) => ({
      driver_id: bucket.driver_id,
      driver_name: bucket.driver_name || `Driver ${bucket.driver_id.slice(0, 8)}`,
      truck_unit_number: bucket.truck_unit_number || "UNKNOWN",
      window_days: days,
      days_with_data: bucket.snapshot_count,

      harsh_braking_total: bucket.metrics.harsh_braking,
      harsh_accel_total: bucket.metrics.harsh_accel,
      harsh_corner_total: bucket.metrics.harsh_corner,
      speeding_violations_total: bucket.metrics.speeding,

      engine_minutes_total: bucket.metrics.engine_minutes,
      idling_minutes_total: bucket.metrics.idling_minutes,
      idling_ratio_avg:
        bucket.snapshot_count > 0
          ? bucket.metrics.idling_ratio_sum / bucket.snapshot_count
          : 0,

      avg_fuel_level_mean:
        bucket.snapshot_count > 0
          ? bucket.metrics.fuel_avg_sum / bucket.snapshot_count
          : 0,
      fuel_consumed_total_liters: bucket.metrics.fuel_consumed,
      low_fuel_events_total: bucket.metrics.low_fuel_events,

      dvir_defects_total: bucket.metrics.dvir_defects,
      maintenance_alerts_total: bucket.metrics.maintenance_alerts,

      fault_codes_total: bucket.metrics.fault_codes,
      coolant_high_events_total: bucket.metrics.coolant_high,
      oil_low_events_total: bucket.metrics.oil_low,
      rpm_high_events_total: bucket.metrics.rpm_high,
      load_high_events_total: bucket.metrics.load_high,
    }));

    const queryTime = Date.now() - startTime;

    return NextResponse.json({
      drivers,
      window_days: days,
      total_drivers: drivers.length,
      query_time_ms: queryTime,
    });
  } catch (err) {
    console.error("Analytics endpoint error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
