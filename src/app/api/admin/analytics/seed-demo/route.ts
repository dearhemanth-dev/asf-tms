import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { seedAnalyticsData } from "@/lib/analytics/seed-demo-data";

export async function POST(request: NextRequest) {
  try {
    // Get Supabase client (uses service role key for admin operations)
    const supabase = await getSupabaseServerClient();

    // Get the first tenant (demo setup uses single tenant)
    const { data: tenants, error: tenantsError } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);

    if (tenantsError || !tenants || tenants.length === 0) {
      return NextResponse.json(
        { error: "No tenants found in database" },
        { status: 400 }
      );
    }

    const tenantId = tenants[0].id;

    // Create demo driver records with UUIDs
    // Using fixed UUIDs for consistent demo data
    const demoDrivers = [
      { id: "00000000-0000-0000-0000-000000000001", full_name: "PHILLIP WAYNE POINTER", assigned_truck_unit_number: "1103" },
      { id: "00000000-0000-0000-0000-000000000002", full_name: "LUIS ALFONSO SOZA RIVERA", assigned_truck_unit_number: "1106" },
      { id: "00000000-0000-0000-0000-000000000003", full_name: "DARREN EUGENE BROWN", assigned_truck_unit_number: "1125" },
      { id: "00000000-0000-0000-0000-000000000004", full_name: "RAJINDER S CHOUHAN", assigned_truck_unit_number: "1133" },
      { id: "00000000-0000-0000-0000-000000000005", full_name: "DANIEL A PAIZ", assigned_truck_unit_number: "1137" },
      { id: "00000000-0000-0000-0000-000000000006", full_name: "GUADALUPE A RAMIREZ", assigned_truck_unit_number: "1140" },
      { id: "00000000-0000-0000-0000-000000000007", full_name: "OCTAVIO SANCHEZ", assigned_truck_unit_number: "1141" },
      { id: "00000000-0000-0000-0000-000000000008", full_name: "JOSE CRUZ ROQUE", assigned_truck_unit_number: "1143" },
      { id: "00000000-0000-0000-0000-000000000009", full_name: "RICARDO BRAVO", assigned_truck_unit_number: "1145" },
      { id: "00000000-0000-0000-0000-000000000010", full_name: "AL JABBAR DOCKERY", assigned_truck_unit_number: "1124" },
      { id: "00000000-0000-0000-0000-000000000011", full_name: "BRANDON J HENDERSON", assigned_truck_unit_number: "1139" },
      { id: "00000000-0000-0000-0000-000000000012", full_name: "ALFONZO LEWIS MITCHELL", assigned_truck_unit_number: "1165" },
      { id: "00000000-0000-0000-0000-000000000013", full_name: "CLEVELAND S JOHNSON", assigned_truck_unit_number: "1166" },
      { id: "00000000-0000-0000-0000-000000000014", full_name: "ABELARDO R HERNANDEZ", assigned_truck_unit_number: "1110" },
      { id: "00000000-0000-0000-0000-000000000015", full_name: "JOHN KLIFTON BISHOP", assigned_truck_unit_number: "1149" },
      { id: "00000000-0000-0000-0000-000000000016", full_name: "FRANCISCO GUERRA", assigned_truck_unit_number: "1152" },
      { id: "00000000-0000-0000-0000-000000000017", full_name: "NEFTALI EDUARDO SOTELO", assigned_truck_unit_number: "1109" },
      { id: "00000000-0000-0000-0000-000000000018", full_name: "JOSHUA GRIFFIN", assigned_truck_unit_number: "1135" },
      { id: "00000000-0000-0000-0000-000000000019", full_name: "BARDALE RENE EDGARDO", assigned_truck_unit_number: "1131" },
      { id: "00000000-0000-0000-0000-000000000020", full_name: "LEE OTIS DAVIS", assigned_truck_unit_number: "1123" },
      { id: "00000000-0000-0000-0000-000000000021", full_name: "PETER EVERETT GARCIA", assigned_truck_unit_number: "1126" },
      { id: "00000000-0000-0000-0000-000000000022", full_name: "KENDALL TRAVIS CRAWFORD", assigned_truck_unit_number: "1127" },
      { id: "00000000-0000-0000-0000-000000000023", full_name: "DAVID LEE JACKSON", assigned_truck_unit_number: "1128" },
      { id: "00000000-0000-0000-0000-000000000024", full_name: "MARCUS ANTHONY SMITH", assigned_truck_unit_number: "1129" },
      { id: "00000000-0000-0000-0000-000000000025", full_name: "JAMES ROBERT WILSON", assigned_truck_unit_number: "1130" },
      { id: "00000000-0000-0000-0000-000000000026", full_name: "CHRISTOPHER PAUL JONES", assigned_truck_unit_number: "1132" },
      { id: "00000000-0000-0000-0000-000000000027", full_name: "KEVIN MICHAEL TAYLOR", assigned_truck_unit_number: "1134" },
      { id: "00000000-0000-0000-0000-000000000028", full_name: "RYAN ANDREW MOORE", assigned_truck_unit_number: "1136" },
      { id: "00000000-0000-0000-0000-000000000029", full_name: "STEVEN THOMAS MARTIN", assigned_truck_unit_number: "1138" },
      { id: "00000000-0000-0000-0000-000000000030", full_name: "BRIAN CHARLES ANDERSON", assigned_truck_unit_number: "1142" },
      { id: "00000000-0000-0000-0000-000000000031", full_name: "JASON CHRISTOPHER WHITE", assigned_truck_unit_number: "1144" },
      { id: "00000000-0000-0000-0000-000000000032", full_name: "MATTHEW DANIEL HARRIS", assigned_truck_unit_number: "1146" },
    ];

    console.log(`Seeding for ${demoDrivers.length} demo drivers to tenant ${tenantId.slice(0, 8)}`);

    // Seed analytics data
    const result = await seedAnalyticsData(supabase, tenantId, demoDrivers, 7);

    if (!result.success) {
      console.error("Seed analytics error:", result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: result.inserted,
      events_inserted: result.events_inserted,
      drivers_seeded: demoDrivers.length,
      tenant_id: tenantId,
      message: `Seeded ${result.inserted} snapshots and ${result.events_inserted} detail events for ${demoDrivers.length} drivers (7 days)`,
    });
  } catch (err) {
    console.error("Seed demo analytics error:", err);
    return NextResponse.json(
      { error: `Internal server error: ${String(err).slice(0, 150)}` },
      { status: 500 }
    );
  }
}
