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
import {
  calculateSeverityFromGForce,
  generateEventDescription,
  fetchSamsaraSafetyEvents,
  type SamsaraSafetyEvent,
} from "@/lib/fleet/fetch-samsara-safety-events";

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
  latitude: number | null;
  longitude: number | null;
};

/**
 * GPS Coordinate Reference System
 * Realistic waypoints for North American truck corridors
 * Format: { name, lat, lon, region }
 */
const ROUTE_WAYPOINTS = [
  // I-5 Corridor (West Coast: CA, OR, WA, BC)
  { name: "Los Angeles, CA", lat: 34.0522, lon: -118.2437, region: "I-5-CA" },
  { name: "Bakersfield, CA", lat: 35.3733, lon: -119.0187, region: "I-5-CA" },
  { name: "Fresno, CA", lat: 36.7469, lon: -119.7726, region: "I-5-CA" },
  { name: "Stockton, CA", lat: 37.9577, lon: -121.2911, region: "I-5-CA" },
  { name: "Sacramento, CA", lat: 38.5816, lon: -121.4944, region: "I-5-CA" },
  { name: "Red Bluff, CA", lat: 40.1737, lon: -121.2353, region: "I-5-CA" },
  { name: "Salem, OR", lat: 44.9429, lon: -123.3351, region: "I-5-OR" },
  { name: "Portland, OR", lat: 45.5152, lon: -122.6784, region: "I-5-OR" },
  { name: "Seattle, WA", lat: 47.6062, lon: -122.3321, region: "I-5-WA" },
  { name: "Bellingham, WA", lat: 48.7519, lon: -122.4787, region: "I-5-WA" },
  { name: "Vancouver, BC", lat: 49.2827, lon: -123.1207, region: "I-5-BC" },
  
  // I-80 Corridor (Cross-country: CA, NV, UT, WY, NE, IA, IL)
  { name: "San Francisco Bay, CA", lat: 37.5483, lon: -121.9886, region: "I-80-CA" },
  { name: "Sacramento, CA", lat: 38.5816, lon: -121.4944, region: "I-80-CA" },
  { name: "Reno, NV", lat: 39.5296, lon: -119.8138, region: "I-80-NV" },
  { name: "Salt Lake City, UT", lat: 40.7608, lon: -111.8910, region: "I-80-UT" },
  { name: "Cheyenne, WY", lat: 41.1400, lon: -104.8202, region: "I-80-WY" },
  { name: "Omaha, NE", lat: 41.2565, lon: -95.9345, region: "I-80-NE" },
  { name: "Des Moines, IA", lat: 41.5868, lon: -93.6250, region: "I-80-IA" },
  { name: "Chicago, IL", lat: 41.8781, lon: -87.6298, region: "I-80-IL" },
  
  // I-40 Corridor (Southern route: CA, AZ, NM, TX, OK, AR, TN, NC)
  { name: "Barstow, CA", lat: 34.8926, lon: -117.0235, region: "I-40-CA" },
  { name: "Flagstaff, AZ", lat: 35.1945, lon: -111.6553, region: "I-40-AZ" },
  { name: "Albuquerque, NM", lat: 35.0844, lon: -106.6504, region: "I-40-NM" },
  { name: "Amarillo, TX", lat: 35.3733, lon: -101.5337, region: "I-40-TX" },
  { name: "Oklahoma City, OK", lat: 35.4676, lon: -97.5164, region: "I-40-OK" },
  { name: "Memphis, TN", lat: 35.1264, lon: -90.0043, region: "I-40-TN" },
  { name: "Asheville, NC", lat: 35.5951, lon: -82.5515, region: "I-40-NC" },
  
  // I-10 Corridor (Southern: CA, AZ, NM, TX, LA, MS, AL, FL)
  { name: "Los Angeles, CA", lat: 34.0522, lon: -118.2437, region: "I-10-CA" },
  { name: "Phoenix, AZ", lat: 33.4484, lon: -112.0742, region: "I-10-AZ" },
  { name: "Tucson, AZ", lat: 32.2226, lon: -110.9747, region: "I-10-AZ" },
  { name: "El Paso, TX", lat: 31.7619, lon: -106.4850, region: "I-10-TX" },
  { name: "San Antonio, TX", lat: 29.4241, lon: -98.4936, region: "I-10-TX" },
  { name: "Houston, TX", lat: 29.7604, lon: -95.3698, region: "I-10-TX" },
  { name: "Lafayette, LA", lat: 30.2345, lon: -92.0198, region: "I-10-LA" },
  { name: "New Orleans, LA", lat: 29.9511, lon: -90.2623, region: "I-10-LA" },
  { name: "Mobile, AL", lat: 30.6954, lon: -88.0399, region: "I-10-AL" },
  { name: "Jacksonville, FL", lat: 30.3322, lon: -81.6557, region: "I-10-FL" },
  
  // CA-99 (Central Valley)
  { name: "Bakersfield, CA", lat: 35.3733, lon: -119.0187, region: "CA-99" },
  { name: "Fresno, CA", lat: 36.7469, lon: -119.7726, region: "CA-99" },
  { name: "Visalia, CA", lat: 36.1699, lon: -119.2881, region: "CA-99" },
  
  // US-101 (Pacific Coast)
  { name: "San Diego, CA", lat: 32.7157, lon: -117.1611, region: "US-101-CA" },
  { name: "Los Angeles, CA", lat: 34.0522, lon: -118.2437, region: "US-101-CA" },
  { name: "San Francisco, CA", lat: 37.7749, lon: -122.4194, region: "US-101-CA" },
  { name: "Portland, OR", lat: 45.5152, lon: -122.6784, region: "US-101-OR" },
  { name: "Seattle, WA", lat: 47.6062, lon: -122.3321, region: "US-101-WA" },
  
  // Mexico Corridors (Northern Border & Baja)
  { name: "Tijuana, Mexico", lat: 32.5149, lon: -117.0382, region: "MEX-BORDER" },
  { name: "Ensenada, Mexico", lat: 31.8585, lon: -116.6168, region: "MEX-BAJA" },
  { name: "Mexicali, Mexico", lat: 32.6392, lon: -115.4526, region: "MEX-BORDER" },
  { name: "Hermosillo, Mexico", lat: 29.0729, lon: -110.9559, region: "MEX-SONORA" },
  { name: "Ciudad Juárez, Mexico", lat: 31.7356, lon: -106.4888, region: "MEX-BORDER" },
  { name: "Nuevo Laredo, Mexico", lat: 27.4369, lon: -99.5305, region: "MEX-BORDER" },
  { name: "Monterrey, Mexico", lat: 25.6866, lon: -100.3161, region: "MEX-NORTE" },
  
  // Canada Corridors (BC, AB, ON)
  { name: "Vancouver, BC", lat: 49.2827, lon: -123.1207, region: "CAN-BC" },
  { name: "Calgary, AB", lat: 51.0447, lon: -114.0719, region: "CAN-AB" },
  { name: "Edmonton, AB", lat: 53.5461, lon: -113.4938, region: "CAN-AB" },
  { name: "Toronto, ON", lat: 43.6532, lon: -79.3832, region: "CAN-ON" },
  
  // Additional major hubs
  { name: "Denver, CO", lat: 39.7392, lon: -104.9903, region: "HUB" },
  { name: "Kansas City, MO", lat: 39.0997, lon: -94.5786, region: "HUB" },
  { name: "Dallas, TX", lat: 32.7767, lon: -96.7970, region: "HUB" },
  { name: "Atlanta, GA", lat: 33.7490, lon: -84.3880, region: "HUB" },
];

/**
 * Helper: Get realistic GPS coordinates based on seeded randomness
 * Ensures deterministic but varied coordinates per event
 */
function getEventCoordinates(
  eventType: string,
  driverId: string,
  dayOffset: number,
  eventIndex: number
): { latitude: number; longitude: number; region: string; name: string } {
  // Use driver ID and day to seed coordinate selection
  const segments = driverId.split("-");
  const hash = segments[segments.length - 1];
  const hashCode = parseInt(hash, 16) || hash
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  // Select base waypoint based on hash + day + event type
  const seed = (hashCode + dayOffset * 7 + eventIndex * 13) % ROUTE_WAYPOINTS.length;
  const baseWaypoint = ROUTE_WAYPOINTS[seed];

  // Add realistic GPS jitter (±0.1 degrees ≈ ±11km at equator)
  const latJitter = (Math.sin(hashCode + dayOffset + eventIndex) * 0.08);
  const lonJitter = (Math.cos(hashCode + dayOffset + eventIndex) * 0.08);

  return {
    latitude: parseFloat((baseWaypoint.lat + latJitter).toFixed(6)),
    longitude: parseFloat((baseWaypoint.lon + lonJitter).toFixed(6)),
    region: baseWaypoint.region,
    name: baseWaypoint.name,
  };
}

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
  const idleRatioBase = (hashCode % 30) / 100 + 0.02; // 0.02-0.32 base, varies by day
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

  // Daily variation for idle ratio (add ±0.05 variance day-to-day)
  const dailyIdleVariance = ((dayOffset * 7 + hashCode) % 11) / 100 - 0.05; // -0.05 to +0.05
  const idlingRatio = Math.max(0.01, Math.min(0.45, idleRatioBase + dailyIdleVariance)); // Clamp to realistic range

  return {
    harsh_braking_count: harshBrakeBase + (dayOffset % 2),
    harsh_accel_count: harshAccelBase + ((dayOffset + 1) % 2),
    harsh_corner_count: harshCornerBase,
    speeding_violations: speedingBase + (dayOffset % 2),
    speeding_minutes: (speedingBase + (dayOffset % 3)) * 15 + (dayOffset % 20),
    engine_minutes: (9 + (dayOffset % 3)) * 60, // 540-720 min (~9-12 hours)
    idling_minutes: Math.round((9 + (dayOffset % 3)) * idlingRatio * 60),
    idling_ratio: idlingRatio,
    avg_fuel_level: fuelBase + (((dayOffset * 3 - 9) % 20) / 20),
    fuel_consumed_liters: (9 + (dayOffset % 3)) * 19, // ~19L/hr realistic (4.8-5.3 gal/hr)
    low_fuel_events: (hashCode % 5 === 0) ? 1 : 0, // Generate low fuel events for ~20% of drivers on every day
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

  // Harsh brake incidents (one event per count) — with realistic G-force physics
  for (let i = 0; i < metrics.harsh_braking_count; i++) {
    const coords = getEventCoordinates("harsh_brake_incident", driverId, dayOffset, i);
    
    // Generate realistic G-force value (0.65-0.95G range)
    const gForceMagnitude = 0.65 + (Math.random() * 0.30);
    const severity = calculateSeverityFromGForce(gForceMagnitude);
    
    // Determine road type from coordinates
    const roadType = coords.region === "I-5-CA" || coords.region === "I-5-OR" || coords.region === "I-5-WA"
      ? "Interstate 5"
      : coords.region === "US-101" ? "Highway 101"
      : "Local streets";
    
    // Speed context varies by road type
    let speed: number;
    let postedLimit: number;
    if (roadType.includes("Interstate")) {
      speed = 65 + Math.floor(Math.random() * 15);
      postedLimit = 65;
    } else if (roadType.includes("Highway")) {
      speed = 50 + Math.floor(Math.random() * 10);
      postedLimit = 55;
    } else {
      speed = 30 + Math.floor(Math.random() * 10);
      postedLimit = 35;
    }
    
    const durationSeconds = 0.8 + Math.random() * 1.4; // 0.8-2.2 seconds
    const timestamp = createTimestamp(6 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60));
    
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: timestamp,
      event_type: "harsh_brake_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_brake_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity,
        location: roadType,
        speed,
        posted_limit: postedLimit,
        gforce_magnitude: parseFloat(gForceMagnitude.toFixed(2)),
        duration_seconds: parseFloat(durationSeconds.toFixed(1)),
        description: generateEventDescription(
          {
            eventType: "harshBraking",
            gForceMagnitude,
            speedMph: speed,
            occurredAt: timestamp,
          } as any,
          roadType,
          coords.name
        ),
      },
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Harsh acceleration incidents — with realistic G-force physics
  for (let i = 0; i < metrics.harsh_accel_count; i++) {
    const coords = getEventCoordinates("harsh_accel_incident", driverId, dayOffset, i);
    
    // Generate realistic G-force value (0.50-0.75G range, typically lower than braking)
    const gForceMagnitude = 0.50 + (Math.random() * 0.25);
    const severity = calculateSeverityFromGForce(gForceMagnitude);
    
    // Determine road type from coordinates
    const roadType = coords.region === "I-5-CA" || coords.region === "I-5-OR" || coords.region === "I-5-WA"
      ? "Interstate 5"
      : coords.region === "US-101" ? "Highway 101"
      : "Local streets";
    
    // Speed context varies by road type (acceleration typically from lower speeds)
    let speed: number;
    if (roadType.includes("Interstate")) {
      speed = 45 + Math.floor(Math.random() * 15);
    } else if (roadType.includes("Highway")) {
      speed = 35 + Math.floor(Math.random() * 15);
    } else {
      speed = 15 + Math.floor(Math.random() * 20); // Lower speeds in city for acceleration
    }
    
    const durationSeconds = 1.0 + Math.random() * 1.5; // 1.0-2.5 seconds
    const timestamp = createTimestamp(7 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60));
    
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: timestamp,
      event_type: "harsh_accel_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: null,
      data_source: "demo_seed",
      source_id: `demo_accel_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity,
        location: roadType,
        speed,
        gforce_magnitude: parseFloat(gForceMagnitude.toFixed(2)),
        duration_seconds: parseFloat(durationSeconds.toFixed(1)),
        description: generateEventDescription(
          {
            eventType: "harshAcceleration",
            gForceMagnitude,
            speedMph: speed,
            occurredAt: timestamp,
          } as any,
          roadType,
          coords.name
        ),
      },
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Harsh corner incidents
  if (metrics.harsh_corner_count > 0) {
    const coords = getEventCoordinates("harsh_corner_incident", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Speeding incidents
  // Distribute total speeding_minutes across violations (manager-realistic duration)
  const avgSpeedingDurationMinutes = Math.max(5, Math.floor(metrics.speeding_minutes / Math.max(1, metrics.speeding_violations)));
  
  for (let i = 0; i < metrics.speeding_violations; i++) {
    const coords = getEventCoordinates("speeding_incident", driverId, dayOffset, i);
    const location = ["Interstate", "Highway 99", "Local streets"][i % 3];
    const postedLimit = location === "Interstate" ? 65 : location === "Local streets" ? 35 : 55; // Realistic by road type
    const actualSpeed = postedLimit + 5 + Math.floor(Math.random() * 15); // 5-19 mph over posted limit
    const overspeeding = actualSpeed - postedLimit; // 5-19 mph over
    
    // Classify severity based on overspeed amount (manager-realistic: ticket risk)
    const severity = overspeeding >= 10 ? "high" : overspeeding >= 5 ? "moderate" : "low";
    
    // Duration: distribute daily speeding_minutes across violations with ±25% variance
    const durationVariance = -0.25 + Math.random() * 0.5; // -25% to +25%
    const duration = Math.max(3, Math.floor(avgSpeedingDurationMinutes * (1 + durationVariance)));
    
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(9 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60)),
      event_type: "speeding_incident",
      metric_value: 1,
      event_count: 1,
      duration_minutes: duration,
      data_source: "demo_seed",
      source_id: `demo_speeding_${snapshotDate}_${i}`,
      status: "confirmed",
      details: {
        severity: severity,
        location: location,
        speed: actualSpeed,
        posted_limit: postedLimit,
        description: `${actualSpeed} mph in ${postedLimit} zone for ${duration} min (${overspeeding} mph over)`,
      },
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Idling episode
  if (metrics.idling_minutes > 0) {
    const coords = getEventCoordinates("idling_episode", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Low fuel events
  if (metrics.low_fuel_events > 0) {
    const coords = getEventCoordinates("low_fuel_incident", driverId, dayOffset, 0);
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
        fuel_efficiency_mpg: (5.5 + Math.random() * 2).toFixed(1), // Realistic truck range: 5-7.5 MPG
      },
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Fuel Consumption (from driver-efficiency metrics)
  // Samsara endpoints: GET /driver-efficiency/drivers, GET /fleet/reports/drivers/fuel-energy
  // Data: Distance covered + actual fuel consumed = calculated MPG
  // Realistic truck metrics: 5-7 MPG typical
  
  // Deterministic distance per driver per day (miles)
  const hashBase = parseInt(driverId.split("-")[4], 16) || 500;
  const distanceMiles = 300 + ((hashBase + dayOffset * 7) % 250); // 300-550 miles
  const mpg = 5.5 + ((hashBase % 40) / 40); // 5.5 - 5.9 MPG realistic range
  const fuelGallons = Math.round((distanceMiles / mpg) * 100) / 100;
  
  // Idle fuel waste (fuel burned while stationary)
  const idleFuelWasted = Math.round(metrics.idling_minutes / 60 * 0.3 * 100) / 100; // ~0.3 gal/hour idle
  
  const fuelCoords = getEventCoordinates("fuel_consumption", driverId, dayOffset, 0);
  const engineHours = Math.round(metrics.engine_minutes / 60);
  
  events.push({
    tenant_id: tenantId,
    driver_id: driverId,
    truck_unit_number: truckUnit,
    event_date: snapshotDate,
    event_timestamp: createTimestamp(23, 0),
    event_type: "fuel_consumption",
    metric_value: fuelGallons,
    event_count: null,
    duration_minutes: null,
    data_source: "demo_seed",
    source_id: `demo_fuel_consumption_${snapshotDate}`,
    status: "confirmed",
    details: {
      distance_miles: distanceMiles,
      gallons_consumed: fuelGallons,
      mpg: mpg,
      engine_hours: engineHours,
      idling_fuel_wasted_gallons: idleFuelWasted,
      cruise_control_percent: Math.round(15 + (dayOffset % 30)), // 15-45% cruise usage
      green_band_driving_percent: Math.round(40 + (dayOffset % 45)), // 40-85% optimal RPM
      location: "Daily route",
      description: `${distanceMiles} mi • ${fuelGallons} gal @ ${mpg.toFixed(1)} MPG • ${engineHours}h active`,
    },
    latitude: fuelCoords.latitude,
    longitude: fuelCoords.longitude,
  });

  // Idling events - Daily aggregated view (manager-focused: cost & impact)
  if (metrics.idling_minutes > 0) {
    const idlingHours = metrics.idling_minutes / 60;
    const idlingGallonsWasted = Math.round(idlingHours * 0.35 * 100) / 100; // 0.35 gal/hour idle burn rate
    const idlePercentage = Math.round((metrics.idling_minutes / metrics.engine_minutes) * 1000) / 10; // % with 1 decimal
    const fuelCostImpact = Math.round(idlingGallonsWasted * 3.5 * 100) / 100; // $3.50/gal diesel
    const co2Equivalent = Math.round(idlingGallonsWasted * 22.4 * 10) / 10; // 22.4 lbs CO2 per gallon
    
    const idleCoords = getEventCoordinates("idling_episode", driverId, dayOffset, 0);
    events.push({
      tenant_id: tenantId,
      driver_id: driverId,
      truck_unit_number: truckUnit,
      event_date: snapshotDate,
      event_timestamp: createTimestamp(23, 30),
      event_type: "idling_episode",
      metric_value: metrics.idling_minutes,
      event_count: null,
      duration_minutes: metrics.idling_minutes,
      data_source: "demo_seed",
      source_id: `demo_idling_${snapshotDate}`,
      status: "confirmed",
      details: {
        total_idling_minutes: metrics.idling_minutes,
        idle_percentage_of_engine_time: idlePercentage,
        idling_hours: Math.round(idlingHours * 10) / 10,
        engine_minutes: metrics.engine_minutes,
        fuel_wasted_gallons: idlingGallonsWasted,
        cost_impact_usd: fuelCostImpact,
        co2_equivalent_lbs: co2Equivalent,
        severity: idlePercentage > 25 ? "high" : idlePercentage > 15 ? "medium" : "low",
        location: "Daily shift",
        description: `${Math.round(idlingHours * 10) / 10}h idle (${idlePercentage}% of shift) • ${idlingGallonsWasted} gal wasted • $${fuelCostImpact} cost`,
      },
      latitude: idleCoords.latitude,
      longitude: idleCoords.longitude,
    });
  }

  // DVIR defects
  if (metrics.dvir_defects_count > 0) {
    const coords = getEventCoordinates("dvir_defect", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Maintenance alerts
  if (metrics.maintenance_alerts_count > 0) {
    const coords = getEventCoordinates("maintenance_alert", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Fault codes
  if (metrics.fault_codes_count > 0) {
    for (let i = 0; i < metrics.fault_codes_count; i++) {
      const coords = getEventCoordinates("fault_code", driverId, dayOffset, i);
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
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    }
  }

  // High temperature events
  if (metrics.high_temp_events > 0) {
    const coords = getEventCoordinates("high_temp_event", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // Low oil events
  if (metrics.low_oil_events > 0) {
    const coords = getEventCoordinates("oil_low_event", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // High RPM events
  if (metrics.high_rpm_events > 0) {
    const coords = getEventCoordinates("rpm_high_event", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  // High load events
  if (metrics.high_load_events > 0) {
    const coords = getEventCoordinates("load_high_event", driverId, dayOffset, 0);
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
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  }

  return events;
}

/**
 * Fetch real Samsara safety events and transform to EventPayload format
 * Falls back to empty array if API key not found or request fails
 */
async function fetchRealSamsaraSafetyEvents(
  supabase: SupabaseClient,
  tenantId: string,
  startDate: string,
  endDate: string
): Promise<EventPayload[]> {
  try {
    // Get Samsara API key from organizations table
    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("samsara_api_key")
      .eq("tenant_id", tenantId)
      .limit(1);

    if (orgsError || !orgs || orgs.length === 0 || !orgs[0].samsara_api_key) {
      console.log("[samsara-integration] No Samsara API key configured");
      return [];
    }

    const apiKey = orgs[0].samsara_api_key as string;

    // Fetch real safety events
    const safetyEvents = await fetchSamsaraSafetyEvents(apiKey, {
      startTime: new Date(startDate).toISOString(),
      endTime: new Date(endDate).toISOString(),
      limit: 1000,
    });

    if (safetyEvents.length === 0) {
      console.log("[samsara-integration] No safety events found from Samsara");
      return [];
    }

    if (safetyEvents.length > 0) {
      console.log(`[seed] Added ${safetyEvents.length} real Samsara safety events`);
    }

    // Transform Samsara events to EventPayload format
    const eventPayloads: EventPayload[] = safetyEvents.map((event: SamsaraSafetyEvent) => {
      // Find matching driver in fleet (use Samsara driver name)
      // For demo purposes, we'll map to our internal format
      const driverId = event.driver.id || `samsara_${event.driver.id}`;
      const truckUnit = event.vehicle.name || "Unknown";

      // Determine road type from coordinates (rough approximation)
      const lat = event.location.latitude;
      const lon = event.location.longitude;
      let roadType = "Interstate 80";
      
      if (lat < 34) {
        roadType = "Interstate 10";
      } else if (lat < 40) {
        roadType = "Interstate 40";
      } else {
        roadType = "Interstate 5";
      }

      // Calculate severity from G-force
      const severity = calculateSeverityFromGForce(event.gForceMagnitude);

      // Generate event date/time
      const eventDate = new Date(event.occurredAt).toISOString().split("T")[0];
      const eventTimestamp = event.occurredAt;

      // Determine event type name
      const eventType = event.eventType === "harshBraking"
        ? "harsh_brake_incident"
        : event.eventType === "harshAcceleration"
          ? "harsh_accel_incident"
          : "harsh_corner_incident";

      // Generate manager-friendly description
      const description = generateEventDescription(
        event,
        roadType,
        `${event.location.latitude.toFixed(4)}, ${event.location.longitude.toFixed(4)}`
      );

      return {
        tenant_id: tenantId,
        driver_id: driverId,
        truck_unit_number: truckUnit,
        event_date: eventDate,
        event_timestamp: eventTimestamp,
        event_type: eventType,
        metric_value: 1,
        event_count: 1,
        duration_minutes: null,
        data_source: "samsara_api",
        source_id: event.id,
        status: "confirmed",
        details: {
          severity,
          location: roadType,
          speed: event.speedMph,
          gforce_magnitude: parseFloat(event.gForceMagnitude.toFixed(2)),
          duration_seconds: event.durationSeconds,
          samsara_severity_score: event.scores?.severity,
          description,
        },
        latitude: event.location.latitude,
        longitude: event.location.longitude,
      };
    });

    return eventPayloads;
  } catch (error) {
    console.warn("[seed] Samsara API unavailable, using seeded data");
    return [];
  }
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

    // Fetch real Samsara safety events first
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (windowDays - 1));
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 1); // Include today

    const realSamsaraEvents = await fetchRealSamsaraSafetyEvents(
      supabase,
      tenantId,
      startDate.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0]
    );



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

        // Add real Samsara events for this day (if available)
        // Filter to only harsh brake/accel for this driver and date
        const daySamsaraEvents = realSamsaraEvents.filter(
          (evt) =>
            evt.event_date === dateStr &&
            (evt.event_type === "harsh_brake_incident" || evt.event_type === "harsh_accel_incident")
        );

        if (daySamsaraEvents.length > 0) {
          events.push(...daySamsaraEvents);
        }
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

    // Clear old demo events before reseeding (prevent duplicates)
    // Clear both demo_seed and samsara_api sources
    const { error: deleteError } = await supabase
      .from("driver_analytics_events")
      .delete()
      .eq("tenant_id", tenantId)
      .in("data_source", ["demo_seed", "samsara_api"]);

    if (deleteError) {
      console.warn(`Warning: Failed to clear old demo events: ${deleteError.message}`);
      // Don't return error - proceed with insert anyway
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
