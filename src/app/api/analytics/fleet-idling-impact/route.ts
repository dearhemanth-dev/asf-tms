import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Fleet Idling Impact Analysis
 * Calculates manager-friendly idling metrics:
 * - Total gallons wasted across fleet
 * - Dollar cost impact
 * - Percentage of engine hours lost to idling
 * - CO2 equivalent emissions
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Auth required" }, { status: 401 });
    }

    // Get all organizations for the current user
    const { data: userOrgs } = await supabase.from("organizations").select("id").limit(1);
    if (!userOrgs || userOrgs.length === 0) {
      return NextResponse.json({ error: "No organization found" }, { status: 404 });
    }

    const tenantId = userOrgs[0].id;

    // Query driver metrics with idling data
    const { data: metrics, error } = await supabase
      .from("driver_analytics_snapshots")
      .select("idling_minutes, engine_minutes, fuel_consumed_liters, snapshot_date")
      .eq("tenant_id", tenantId);

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json(
        { error: "Failed to fetch idling metrics" },
        { status: 500 }
      );
    }

    if (!metrics || metrics.length === 0) {
      return NextResponse.json({
        fleet_idling_gallons_wasted_per_day: 0,
        fleet_idling_cost_per_day: 0,
        fleet_idle_percentage_of_engine_time: 0,
        fleet_co2_equivalent_lbs_per_day: 0,
        data_points: 0,
      });
    }

    // Calculate aggregate idling impact
    let totalIdlingMinutes = 0;
    let totalEngineMinutes = 0;
    let totalFuelLiters = 0;

    metrics.forEach((m: any) => {
      if (m.idling_minutes) totalIdlingMinutes += m.idling_minutes;
      if (m.engine_minutes) totalEngineMinutes += m.engine_minutes;
      if (m.fuel_consumed_liters) totalFuelLiters += m.fuel_consumed_liters;
    });

    // Idling typically burns 0.3-0.4 gallons per hour (approx)
    const idlingHours = totalIdlingMinutes / 60;
    const idlingGallonsWasted = idlingHours * 0.35; // 0.35 gal/hr is realistic for idling

    // Fuel cost estimation (~$3.50/gal average truck diesel)
    const FUEL_COST_PER_GALLON = 3.5;
    const idlingCostPerDay = idlingGallonsWasted * FUEL_COST_PER_GALLON;

    // Idle percentage of total engine time
    const idlePercentage =
      totalEngineMinutes > 0
        ? (totalIdlingMinutes / totalEngineMinutes) * 100
        : 0;

    // CO2 emissions: ~22.4 lbs CO2 per gallon of diesel
    const CO2_PER_GALLON = 22.4;
    const idleCo2Equivalent = idlingGallonsWasted * CO2_PER_GALLON;

    return NextResponse.json({
      fleet_idling_gallons_wasted_per_day: Math.round(idlingGallonsWasted * 10) / 10,
      fleet_idling_cost_per_day: Math.round(idlingCostPerDay * 100) / 100,
      fleet_idle_percentage_of_engine_time: Math.round(idlePercentage * 10) / 10,
      fleet_co2_equivalent_lbs_per_day: Math.round(idleCo2Equivalent * 10) / 10,
      data_points: metrics.length,
    });
  } catch (err) {
    console.error("Fleet idling impact calculation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
