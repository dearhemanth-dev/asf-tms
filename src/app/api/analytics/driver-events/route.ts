/**
 * /api/analytics/driver-events
 *
 * Fetches detailed event records for a driver within a date range
 * Used for drill-down UI - shows what drove the aggregated metrics
 *
 * Query params:
 *   - driver_id (required): UUID of driver
 *   - start_date (required): YYYY-MM-DD start date
 *   - end_date (required): YYYY-MM-DD end date
 *   - event_type (optional): Filter by specific event type
 *
 * Response: Array of event records with full details
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const driverId = searchParams.get("driver_id");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const eventType = searchParams.get("event_type");

    // Validate required params
    if (!driverId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required params: driver_id, start_date, end_date" },
        { status: 400 }
      );
    }

    // Validate date format (simple check for YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return NextResponse.json(
        { error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // Get first tenant (demo setup uses single tenant)
    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);

    if (tenantsError || !tenants || tenants.length === 0) {
      return NextResponse.json(
        { error: "No tenant found" },
        { status: 500 }
      );
    }

    const tenantId = tenants[0].id;

    // Build query
    let query = supabase
      .from("driver_analytics_events")
      .select(
        "id, driver_id, truck_unit_number, event_date, event_timestamp, event_type, metric_value, event_count, duration_minutes, data_source, source_id, status, details, latitude, longitude, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("driver_id", driverId)
      .gte("event_date", startDate)
      .lte("event_date", endDate)
      .order("event_date", { ascending: false })
      .order("event_timestamp", { ascending: false });

    // Filter by event_type if provided
    if (eventType) {
      query = query.eq("event_type", eventType);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error("Event query error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Group events by date and type for easier UI consumption
    const grouped: Record<string, Record<string, unknown[]>> = {};

    (events || []).forEach((event: Record<string, unknown>) => {
      const dateKey = event.event_date as string;
      const typeKey = event.event_type as string;

      if (!grouped[dateKey]) {
        grouped[dateKey] = {};
      }
      if (!grouped[dateKey][typeKey]) {
        grouped[dateKey][typeKey] = [];
      }

      grouped[dateKey][typeKey].push(event);
    });

    return NextResponse.json({
      driver_id: driverId,
      start_date: startDate,
      end_date: endDate,
      total_events: events?.length || 0,
      events_by_date: grouped,
      raw_events: events,
      query_time_ms: 0,
    });
  } catch (err) {
    console.error("Driver events API error:", err);
    return NextResponse.json(
      { error: `Internal server error: ${String(err).slice(0, 100)}` },
      { status: 500 }
    );
  }
}
