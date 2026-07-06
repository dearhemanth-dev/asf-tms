/**
 * lib/analytics/seed-demo-data.ts
 * 
 * Utility to seed analytics tables with realistic 7-day demo data.
 * Generates:
 *   - driver_analytics_snapshots: aggregated daily metrics per driver
 *   - driver_analytics_events: detailed event records backing each snapshot
 * 
 * Used for testing reporting UI without depending on ELD API.
 * Provider-agnostic: events generated with data_source="demo_seed"
 * 
 * Usage:
 *   const { seedAnalyticsData } = await import('@/lib/analytics/seed-demo-data');
 *   await seedAnalyticsData(supabaseClient, tenantId, drivers);
 */

import { SupabaseClient } from "@supabase/supabase-js";

type InsertPayload = {
  tenant_id: string;
  driver_id: string;
  driver_name: string;
  truck_unit_number: string;
  snapshot_date: string;
  harsh_braking_count: number;
  harsh_accel_count: number;
  harsh_corner_count: number;
  speeding_violations: number;
  speeding_minutes: number;
  engine_minutes: number;
  idling_minutes: number;
  idling_ratio: number;
  avg_fuel_level: number;
  fuel_consumed_liters: number;
  low_fuel_events: number;
  dvir_defects_count: number;
  maintenance_alerts_count: number;
  fault_codes_count: number;
  high_temp_events: number;
  low_oil_events: number;
  high_rpm_events: number;
  high_load_events: number;
  data_source: string;
};

type MetricsPayload = Omit<InsertPayload, "tenant_id" | "driver_id" | "driver_name" | "truck_unit_number" | "snapshot_date" | "data_source">;

type EventPayload = {
  tenant_id: string;
  driver_id: string;
  truck_unit_number: string;
  event_date: string;
  event_timestamp: string;
  event_type: string;
  metric_value: number | null;
  event_count: number | null;
  duration_minutes: number | null;
  data_source: string;
  source_id: string | null;
  status: string;
  details: Record<string, unknown> | null;
};

/**
 * Generate deterministic but varied metrics for a driver
 */
function generateDriverMetrics(
  driverId: string,
  dayOffset: number
): MetricsPayload {
  // Use last segment of UUID which contains the unique part (e.g. "000000000015")
  const segments = driverId.split("-");
  const hash = segments[segments.length - 1];
  const hashCode = parseInt(hash, 16) || hash
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  // Base values per driver (seeded by ID) - increased to ensure non-zero counts
  const harshBrakeBase = 1 + (hashCode % 3); // 1-3 (always at least 1)
  const harshAccelBase = 2 + ((hashCode * 7) % 3); // 2-4 (always at least 2)
  const harshCornerBase = ((hashCode * 11) % 2); // 0-1
  const speedingBase = 2 + ((hashCode * 13) % 5); // 2-6 (always at least 2)
  const idleRatioBase = (hashCode % 50) / 100 + 0.02; // 0.02-0.52
  const fuelBase = (hashCode % 40) + 40; // 40-80%

  // Driver-specific cycle offsets so DVIR/maintenance events fall on different days per driver
  const dvirCycle = (hashCode % 7);           // shifts which day gets dvir hit
  const maintenanceCycle = (hashCode % 7);    // shifts which day gets maintenance alert
  const faultCycle = (hashCode % 4);          // shifts which day gets fault
  const tempCycle = (hashCode % 5);           // shifts high-temp day
  const oilCycle = (hashCode % 6);            // shifts low-oil day
  const rpmCycle = (hashCode % 3);            // shifts high-rpm day
  const loadCycle = (hashCode % 4);           // shifts high-load day

  // Driver-specific frequency: some drivers get more events than others
  const dvirFreq = (hashCode % 3);            // 0=none, 1=occasional, 2=frequent
  const faultFreq = 1 + (hashCode % 2);       // 1=occasional, 2=frequent (always at least occasional)
  const maintenanceFreq = (hashCode % 2);     // 0=none, 1=occasional

  return {
    harsh_braking_count: harshBrakeBase + (dayOffset % 2),
    harsh_accel_count: harshAccelBase + ((dayOffset + 1) % 2),
    harsh_corner_count: harshCornerBase,
    speeding_violations: speedingBase + (dayOffset % 2),
    speeding_minutes: (speedingBase + (dayOffset % 3)) * 15 + (dayOffset % 20),
    engine_minutes: (9 + (dayOffset % 3)) * 60, // 540-720 min (~9-12 hours)
    idling_minutes: Math.round((9 + (dayOffset % 3)) * idleRatioBase * 60),
    idling_ratio: idleRatioBase,
    avg_fuel_level: fuelBase + (((dayOffset * 3 - 9) % 20) / 20),
    fuel_consumed_liters: (9 + (dayOffset % 3)) * 6.5, // ~6.5L/hr typical
    low_fuel_events: fuelBase + (((dayOffset * 3 - 9) % 20) / 20) < 20 ? 1 : 0,
    dvir_defects_count: dvirFreq === 0 ? 0 : (dayOffset % 7 === dvirCycle ? (dvirFreq === 2 ? 2 : 1) : 0),
    maintenance_alerts_count: maintenanceFreq === 0 ? 0 : (dayOffset % 7 === maintenanceCycle ? 1 : 0),
    fault_codes_count: faultFreq === 0 ? 0 : (dayOffset % 4 === faultCycle ? 1 : (faultFreq === 2 && dayOffset % 4 === (faultCycle + 2) % 4 ? 1 : 0)),
    high_temp_events: (dayOffset % 5 === tempCycle && hashCode % 3 !== 0) ? 1 : 0,
    low_oil_events: (dayOffset % 6 === oilCycle && hashCode % 4 === 0) ? 1 : 0,
    high_rpm_events: (dayOffset % 3 === rpmCycle && hashCode % 2 !== 0) ? 1 : 0,
    high_load_events: (dayOffset % 4 === loadCycle && hashCode % 3 !== 2) ? 1 : 0,
  };
}

/**
 * Generate event records from aggregated metrics
 * Maps each metric value to one or more detail events
 */
function generateEventRecords(
  tenantId: string,
  driverId: string,
  truckUnit: string,
  snapshotDate: string,
  metrics: {
    harsh_braking_count: number;
    harsh_accel_count: number;
    harsh_corner_count: number;
    speeding_violations: number;
    speeding_minutes: number;
    engine_minutes: number;
    idling_minutes: number;
    idling_ratio: number;
    avg_fuel_level: number;
    fuel_consumed_liters: number;
    low_fuel_events: number;
    dvir_defects_count: number;
    maintenance_alerts_count: number;
    fault_codes_count: number;
    high_temp_events: number;
    low_oil_events: number;
    high_rpm_events: number;
    high_load_events: number;
  },
  dayOffset: number
): EventPayload[] {
  const events: EventPayload[] = [];
  const dateObj = new Date(snapshotDate);

  // Helper: create event timestamp at a specific time during the day
  function createTimestamp(hourOfDay: number, minuteOfHour = 0): string {
    const ts = new Date(dateObj);
    ts.setHours(hourOfDay, minuteOfHour, 0, 0);
    return ts.toISOString();
  }

  // Harsh brake incidents (one event per count)
  for (let i = 0; i < metrics.harsh_braking_count; i++) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(6 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60)),
      event_type: "harsh_brake_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_brake_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity: ["high", "moderate", "low"][i % 3],
        location: ["I-5 Exit 42", "US-101 Mile 15", "CA-99 Downtown"][i % 3],
        speed: 55 + Math.floor(Math.random() * 20),
        description: "Rapid deceleration event",
      },
    });
  }

  // Harsh acceleration incidents
  for (let i = 0; i < metrics.harsh_accel_count; i++) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(7 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60)),
      event_type: "harsh_accel_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_accel_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity: ["moderate", "low"][i % 2],
        location: ["Traffic light restart", "Merge acceleration"][i % 2],
        speed: 20 + Math.floor(Math.random() * 15),
        description: "Rapid acceleration event",
      },
    });
  }

  // Harsh corner incidents
  if (metrics.harsh_corner_count > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60)),
      event_type: "harsh_corner_incident",
      metric_value: metrics.harsh_corner_count,
      event_count: metrics.harsh_corner_count,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_corner_${snapshotDate}`,
      status: "confirmed",
      details: {
        severity: "moderate",
        location: "Urban/suburban turns",
        speed: 35 + Math.floor(Math.random() * 15),
        description: `${metrics.harsh_corner_count} harsh corner event(s)`,
      },
    });
  }

  // Speeding incidents
  for (let i = 0; i < metrics.speeding_violations; i++) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60)),
      event_type: "speeding_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: Math.floor(Math.random() * 10) + 2,
      data_source: "demo_seed",
      source_id: `demo_speeding_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity: i === 0 ? "high" : "moderate",
        location: ["Interstate", "Highway 99", "Local streets"][i % 3],
        speed: 70 + Math.floor(Math.random() * 15),
        posted_limit: 65,
        description: `Speeding event: ${5 + Math.floor(Math.random() * 10)} mph over limit`,
      },
    });
  }

  // Idling episode
  if (metrics.idling_minutes > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)),
      event_type: "idling_episode",
      metric_value: metrics.idling_ratio,
      event_count: null,
      duration_minutes: metrics.idling_minutes,
      data_source: "demo_seed",
      source_id: `demo_idling_${snapshotDate}`,
      status: "confirmed",
      details: {
        total_idling_minutes: metrics.idling_minutes,
        engine_hours: Math.round(metrics.engine_minutes / 60),
        idle_percentage: Math.round(metrics.idling_ratio * 100),
        location: "Rest area",
        description: `${metrics.idling_minutes} minutes idle (${Math.round(metrics.idling_ratio * 100)}% of active engine time)`,
      },
    });
  }

  // Low fuel events
  if (metrics.low_fuel_events > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(12 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60)),
      event_type: "low_fuel_incident",
      metric_value: metrics.avg_fuel_level,
      event_count: metrics.low_fuel_events,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_low_fuel_${snapshotDate}`,
      status: "confirmed",
      details: {
        fuel_level_percent: metrics.avg_fuel_level,
        events: metrics.low_fuel_events,
        location: "Fuel station",
        description: `Fuel level dropped to ${Math.round(metrics.avg_fuel_level)}% (${metrics.low_fuel_events} alert(s))`,
      },
    });
  }

  // Fuel consumption
  events.push({
    tenant_id: tenantId,
    driver_id: driverId,
    truck_unit_number: truckUnit,
    event_date: snapshotDate,
    event_timestamp: createTimestamp(23, 0),
    event_type: "fuel_consumption",
    metric_value: metrics.fuel_consumed_liters,
    event_count: null,
    duration_minutes: null,
    data_source: "demo_seed",
    source_id: `demo_fuel_consumption_${snapshotDate}`,
    status: "confirmed",
    details: {
      liters_consumed: metrics.fuel_consumed_liters,
      engine_hours: Math.round(metrics.engine_minutes / 60),
      consumption_rate_per_hour: Math.round((metrics.fuel_consumed_liters / (metrics.engine_minutes / 60)) * 10) / 10,
      location: "Daily route",
      description: `${Math.round(metrics.fuel_consumed_liters)} L consumed (${Math.round((metrics.fuel_consumed_liters / (metrics.engine_minutes / 60)) * 10) / 10} L/hr)`,
    },
  });

  // DVIR defects
  if (metrics.dvir_defects_count > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(7, 30),
      event_type: "dvir_defect",
      metric_value: metrics.dvir_defects_count,
      event_count: metrics.dvir_defects_count,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_dvir_${snapshotDate}`,
      status: "confirmed",
      details: {
        defect_count: metrics.dvir_defects_count,
        components: ["Brake system", "Tire condition", "Lights"][
          Math.floor(Math.random() * 3)
        ],
        severity: "medium",
        location: "Fleet yard",
        description: `${metrics.dvir_defects_count} DVIR defect(s) reported`,
      },
    });
  }

  // Maintenance alerts
  if (metrics.maintenance_alerts_count > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(8, 0),
      event_type: "maintenance_alert",
      metric_value: metrics.maintenance_alerts_count,
      event_count: metrics.maintenance_alerts_count,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_maint_${snapshotDate}`,
      status: "confirmed",
      details: {
        alert_count: metrics.maintenance_alerts_count,
        alert_type: "Scheduled service due",
        location: "Service center",
        description: `${metrics.maintenance_alerts_count} maintenance alert(s)`,
      },
    });
  }

  // Fault codes
  if (metrics.fault_codes_count > 0) {
    for (let i = 0; i < metrics.fault_codes_count; i++) {
      events.push({
        tenant_id: tenantId,
        driver_id: driverId,
        truck_unit_number: truckUnit,
        event_date: snapshotDate,
        event_timestamp: createTimestamp(10 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60)),
        event_type: "fault_code",
        metric_value: null,
        event_count: 1,
        duration_minutes: null,
        data_source: "demo_seed",
        source_id: `demo_fault_${snapshotDate}_${i}`,
        status: "confirmed",
        details: {
          fault_code: ["P0101", "P0107", "P0108"][i % 3],
          component: ["Mass Air Flow", "Manifold Absolute Pressure", "Engine Control"][i % 3],
          location: ["I-5 North", "US-101", "Local streets"][i % 3],
          description: "Engine diagnostic fault code",
        },
      });
    }
  }

  // High temperature events
  if (metrics.high_temp_events > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(14, 30),
      event_type: "high_temp_event",
      metric_value: null,
      event_count: metrics.high_temp_events,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_temp_${snapshotDate}`,
      status: "confirmed",
      details: {
        event_count: metrics.high_temp_events,
        component: "Coolant system",
        temp_celsius: 105 + Math.floor(Math.random() * 10),
        location: "Desert highway",
        description: `High coolant temperature (${metrics.high_temp_events} event(s))`,
      },
    });
  }

  // Low oil events
  if (metrics.low_oil_events > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(15, 0),
      event_type: "oil_low_event",
      metric_value: null,
      event_count: metrics.low_oil_events,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_oil_${snapshotDate}`,
      status: "confirmed",
      details: {
        event_count: metrics.low_oil_events,
        component: "Engine oil",
        oil_level: "Low",
        location: "On road",
        description: `Low oil pressure detected (${metrics.low_oil_events} event(s))`,
      },
    });
  }

  // High RPM events
  if (metrics.high_rpm_events > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(16, 15),
      event_type: "rpm_high_event",
      metric_value: null,
      event_count: metrics.high_rpm_events,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_rpm_${snapshotDate}`,
      status: "confirmed",
      details: {
        event_count: metrics.high_rpm_events,
        max_rpm: 2200 + Math.floor(Math.random() * 400),
        location: "Hill climb",
        description: `Engine running at high RPM (${metrics.high_rpm_events} event(s))`,
      },
    });
  }

  // High load events
  if (metrics.high_load_events > 0) {
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(17, 30),
      event_type: "load_high_event",
      metric_value: null,
      event_count: metrics.high_load_events,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_load_${snapshotDate}`,
      status: "confirmed",
      details: {
        event_count: metrics.high_load_events,
        load_percent: 85 + Math.floor(Math.random() * 15),
        location: "Loaded route",
        description: `Engine load at high level (${metrics.high_load_events} event(s))`,
      },
    });
  }

  return events;
}

/**
 * Seed analytics tables with 7 days of demo data for given drivers
 * Creates both snapshots (daily aggregates) and events (detailed records)
 */
export async function seedAnalyticsData(
  supabase: SupabaseClient,
  tenantId: string,
  driverIds: Array<{ id: string; full_name?: string; assigned_truck_unit_number?: string }>,
  windowDays: number = 7
): Promise<{
  success: boolean;
  inserted: number;
  events_inserted: number;
  error?: string;
}> {
  try {
    if (!driverIds || driverIds.length === 0) {
      return {
        success: false,
        inserted: 0,
        events_inserted: 0,
        error: "No drivers provided",
      };
    }

    const snapshots: InsertPayload[] = [];
    const events: EventPayload[] = [];
    const today = new Date();

    for (let idx = 0; idx < driverIds.length; idx++) {
      const driver = driverIds[idx];
      
      // Generate truck unit number if not provided
      const truckUnit = driver.assigned_truck_unit_number || `${1100 + idx}`;

      for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
        const snapshotDate = new Date(today);
        snapshotDate.setDate(snapshotDate.getDate() - (windowDays - 1 - dayOffset));
        const dateStr = snapshotDate.toISOString().split("T")[0];

        const metrics = generateDriverMetrics(driver.id, dayOffset);

        // Add snapshot record
        const snapshot: InsertPayload = {
          tenant_id: tenantId,
          driver_id: driver.id,
          driver_name: driver.full_name || `Driver ${driver.id}`,
          truck_unit_number: truckUnit,
          snapshot_date: dateStr,
          harsh_braking_count: metrics.harsh_braking_count,
          harsh_accel_count: metrics.harsh_accel_count,
          harsh_corner_count: metrics.harsh_corner_count,
          speeding_violations: metrics.speeding_violations,
          speeding_minutes: metrics.speeding_minutes,
          engine_minutes: metrics.engine_minutes,
          idling_minutes: metrics.idling_minutes,
          idling_ratio: metrics.idling_ratio,
          avg_fuel_level: metrics.avg_fuel_level,
          fuel_consumed_liters: metrics.fuel_consumed_liters,
          low_fuel_events: metrics.low_fuel_events,
          dvir_defects_count: metrics.dvir_defects_count,
          maintenance_alerts_count: metrics.maintenance_alerts_count,
          fault_codes_count: metrics.fault_codes_count,
          high_temp_events: metrics.high_temp_events,
          low_oil_events: metrics.low_oil_events,
          high_rpm_events: metrics.high_rpm_events,
          high_load_events: metrics.high_load_events,
          data_source: "demo_seed",
        };
        snapshots.push(snapshot);

        // Add detail event records for this snapshot
        const dayEvents = generateEventRecords(
          tenantId,
          driver.id,
          truckUnit,
          dateStr,
          metrics,
          dayOffset
        );
        events.push(...dayEvents);
      }
    }

    if (snapshots.length === 0) {
      return {
        success: false,
        inserted: 0,
        events_inserted: 0,
        error: "No payloads generated",
      };
    }

    // Insert snapshots
    const { error: snapshotError } = await supabase
      .from("driver_analytics_snapshots")
      .upsert(snapshots, {
        onConflict: "tenant_id,driver_id,snapshot_date",
      });

    if (snapshotError) {
      return {
        success: false,
        inserted: 0,
        events_inserted: 0,
        error: `Snapshot insert error: ${snapshotError.message}`,
      };
    }

    // Insert events
    let eventsInserted = 0;
    if (events.length > 0) {
      const { error: eventError, data } = await supabase
        .from("driver_analytics_events")
        .insert(events)
        .select();

      if (eventError) {
        return {
          success: false,
          inserted: snapshots.length,
          events_inserted: 0,
          error: `Event insert error: ${eventError.message}`,
        };
      }

      eventsInserted = data?.length || events.length;
    }

    return {
      success: true,
      inserted: snapshots.length,
      events_inserted: eventsInserted,
    };
  } catch (err) {
    return {
      success: false,
      inserted: 0,
      events_inserted: 0,
      error: `Seed error: ${String(err).slice(0, 100)}`,
    };
  }
}
