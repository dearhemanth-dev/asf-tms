/**
 * /api/analytics/fleet-average-mpg
 *
 * Calculates real fleet average MPG from actual fuel_consumption events
 * Uses current organization's seeded/actual data in driver_analytics_events table
 *
 * Query params:
 *   - None (uses tenant_id from session)
 *
 * Response: { fleet_average_mpg: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  try {
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

    // Query all fuel_consumption events for this tenant
    // Extract mpg from details JSON, calculate average
    const { data: events, error } = await supabase
      .from("driver_analytics_events")
      .select("details")
      .eq("tenant_id", tenantId)
      .eq("event_type", "fuel_consumption");

    if (error) {
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    if (!events || events.length === 0) {
      // No fuel consumption events - return null to signal fallback
      return NextResponse.json({ fleet_average_mpg: null }, { status: 200 });
    }

    // Extract MPG values from details and calculate average
    const mpgValues = events
      .map((event: any) => event.details?.mpg)
      .filter((mpg: any) => typeof mpg === "number" && mpg > 0);

    if (mpgValues.length === 0) {
      return NextResponse.json({ fleet_average_mpg: null }, { status: 200 });
    }

    const fleetAverageMpg =
      mpgValues.reduce((sum: number, mpg: number) => sum + mpg, 0) / mpgValues.length;

    return NextResponse.json(
      { fleet_average_mpg: Math.round(fleetAverageMpg * 10) / 10 }, // Round to 1 decimal
      { status: 200 }
    );
  } catch (error) {
    console.error("Error calculating fleet average MPG:", error);
    return NextResponse.json(
      { error: "Failed to calculate fleet average MPG" },
      { status: 500 }
    );
  }
}
