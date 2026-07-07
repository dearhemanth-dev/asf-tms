/**
 * ELD Provider Interface & Architecture
 * 
 * Defines contract for integrating multiple Electronic Logging Device (ELD) providers.
 * Currently: Samsara
 * Future: Geotab, Verizon Connect, J.J. Keller, etc.
 * 
 * PRINCIPLE: No assumed data - only display fields available from the provider
 */

// ============================================================================
// CORE DATA TYPES (Provider-Agnostic)
// ============================================================================

export interface ELDDriver {
  id: string;
  full_name: string;
  email?: string;
  phone?: string;
  license_number?: string;
  assigned_truck_unit_number?: string;
  source_driver_id?: string; // External provider's driver ID
  data_source: "samsara" | "geotab" | "verizon" | "jjkeller";
}

export interface ELDVehicle {
  id: string;
  truck_unit_number: string;
  vin: string;
  make?: string;
  model?: string;
  model_year?: number;
  fuel_tank_capacity_gallons: number; // REQUIRED for consumption calculation
  fuel_tank_capacity_liters?: number;
  data_source: string;
  source_vehicle_id?: string; // External provider's vehicle ID
}

export interface ELDEvent {
  event_id: string;
  driver_id: string;
  vehicle_id?: string;
  truck_unit_number: string;
  event_date: string; // YYYY-MM-DD
  event_timestamp: string; // ISO 8601
  event_type: "harsh_brake_incident" | "harsh_accel_incident" | "harsh_corner_incident" | 
              "speeding_incident" | "idling_episode" | "low_fuel_incident" | 
              "fault_code" | "dvir_defect" | "maintenance_alert" | 
              "high_temp_event" | "oil_low_event" | "rpm_high_event" | "load_high_event";
  metric_value?: number; // Event-specific value (e.g., speed in MPH)
  event_count?: number; // Count if aggregate
  duration_minutes?: number; // Duration if applicable
  latitude?: number;
  longitude?: number;
  details: Record<string, any>; // Event-specific metadata
  data_source: string;
  source_id?: string; // External provider's event ID
}

export interface ELDFuelLevel {
  vehicle_id: string;
  timestamp: string; // ISO 8601
  fuel_level_percent: number; // 0-100
  data_source: string;
}

export interface ELDDriverEfficiency {
  driver_id: string;
  date: string; // YYYY-MM-DD
  distance_miles: number;
  fuel_consumed_gallons: number;
  driving_time_minutes: number;
  idling_fuel_wasted_gallons: number; // Fuel consumed while stationary
  mpg: number; // Miles per gallon (calculated: distance / fuel)
  cruise_control_percent: number; // % of time cruise control was active
  green_band_driving_percent: number; // % of time in optimal RPM range
  data_source: string;
}

export interface ELDSnapshot {
  driver_id: string;
  snapshot_date: string; // YYYY-MM-DD
  engine_minutes: number;
  idling_minutes: number;
  harsh_braking_count: number;
  harsh_accel_count: number;
  harsh_corner_count: number;
  speeding_violations: number;
  fault_codes_count: number;
  dvir_defects_count: number;
  maintenance_alerts_count: number;
  high_temp_events: number;
  low_oil_events: number;
  high_rpm_events: number;
  high_load_events: number;
  low_fuel_events: number;
  data_source: string;
}

// ============================================================================
// PROVIDER INTERFACE (Implementation Contract)
// ============================================================================

export interface ELDProvider {
  /**
   * Initialize provider with credentials
   */
  init(config: Record<string, any>): Promise<void>;

  /**
   * Get all drivers for tenant
   * MUST return: id, full_name
   * SHOULD return: email, phone, license_number, assigned_truck_unit_number
   */
  getDrivers(tenantId: string): Promise<ELDDriver[]>;

  /**
   * Get all vehicles for tenant
   * MUST return: id, truck_unit_number, vin, fuel_tank_capacity_gallons
   * SHOULD return: make, model, model_year, fuel_tank_capacity_liters
   * 
   * NOTE: fuel_tank_capacity_gallons is critical for future fuel consumption calculation
   * If not available from provider, must be populated via VIN lookup service
   */
  getVehicles(tenantId: string): Promise<ELDVehicle[]>;

  /**
   * Get events for driver within date range
   * MUST return: event_type, event_timestamp, latitude, longitude
   * SHOULD return: metric_value, duration_minutes, severity context
   * 
   * DOES NOT return fuel_consumed (not available from any provider)
   * Use fuel level snapshots + vehicle.fuel_tank_capacity_gallons to calculate consumption
   */
  getEvents(
    driverId: string,
    startDate: string, // YYYY-MM-DD
    endDate: string,   // YYYY-MM-DD
    eventTypes?: string[]
  ): Promise<ELDEvent[]>;

  /**
   * Get fuel level history for vehicle
   * Can be used to calculate consumption: (level_start% - level_end%) * tank_capacity
   */
  getFuelLevels(
    vehicleId: string,
    startDate: string,
    endDate: string
  ): Promise<ELDFuelLevel[]>;

  /**
   * Get driver efficiency metrics (MPG, fuel consumed, driving behavior)
   * ACTUAL fuel consumption data from Samsara driver-efficiency endpoints
   * 
   * Provides:
   * - Distance covered (miles)
   * - Fuel consumed (gallons) — CUMULATIVE for the day/period
   * - Fuel wasted while idle (gallons)
   * - MPG (miles per gallon)
   * - Cruise control usage % (for fuel optimization)
   * - Green band driving % (optimal RPM range for efficiency)
   * 
   * Samsara Endpoints:
   * - GET /driver-efficiency/drivers
   * - GET /fleet/reports/drivers/fuel-energy
   */
  getDriverEfficiency(
    driverId: string,
    startDate: string, // YYYY-MM-DD
    endDate: string    // YYYY-MM-DD
  ): Promise<ELDDriverEfficiency[]>;

  /**
   * Get daily aggregated snapshot (optional optimization)
   */
  getSnapshot?(
    driverId: string,
    snapshotDate: string
  ): Promise<ELDSnapshot | null>;

  /**
   * Lookup vehicle specs by VIN (for fuel tank capacity, make/model/year)
   * Providers may have this integrated; fallback to NHTSA or other services
   */
  lookupVehicleByVIN?(vin: string): Promise<Partial<ELDVehicle> | null>;
}

// ============================================================================
// IMPLEMENTATION EXAMPLES
// ============================================================================

/**
 * Samsara Provider Implementation
 * https://developer.samsara.com/docs
 */
export class SamsaraProvider implements ELDProvider {
  private apiKey: string = "";
  private baseUrl = "https://api.samsara.com/v1";

  async init(config: Record<string, any>) {
    this.apiKey = config.apiKey;
    if (!this.apiKey) throw new Error("Samsara API key required");
  }

  async getDrivers(tenantId: string): Promise<ELDDriver[]> {
    // Samsara: GET /fleet/drivers
    // Maps: id → id, name → full_name, licenseNumber → license_number
    // Does NOT provide assigned_truck_unit_number; must join via assignments
    throw new Error("Not implemented - requires Samsara integration");
  }

  async getVehicles(tenantId: string): Promise<ELDVehicle[]> {
    // Samsara: GET /fleet/vehicles
    // Maps: id → source_vehicle_id, name → truck_unit_number, vin → vin
    // For fuel_tank_capacity_gallons: CALL lookupVehicleByVIN (Samsara VIN endpoint)
    throw new Error("Not implemented - requires Samsara integration");
  }

  async getEvents(
    driverId: string,
    startDate: string,
    endDate: string,
    eventTypes?: string[]
  ): Promise<ELDEvent[]> {
    // Samsara: POST /events/list
    // Provides: harsh braking, harsh accel, speeding, fault codes, etc.
    // DOES NOT provide: fuel_consumed
    // Latitude/Longitude from GPS in event metadata
    throw new Error("Not implemented - requires Samsara integration");
  }

  async getFuelLevels(
    vehicleId: string,
    startDate: string,
    endDate: string
  ): Promise<ELDFuelLevel[]> {
    // Samsara: GET /fleet/vehicles/{id}/fuel-status
    // Returns current fuel %; would need historical snapshots for comparison
    throw new Error("Not implemented - requires Samsara integration");
  }

  async getDriverEfficiency(
    driverId: string,
    startDate: string,
    endDate: string
  ): Promise<ELDDriverEfficiency[]> {
    // Samsara: GET /driver-efficiency/drivers or GET /fleet/reports/drivers/fuel-energy
    // Returns: distance_miles, fuel_consumed_gallons, mpg, cruise_control_%, green_band_%
    // THIS IS ACTUAL FUEL DATA from Samsara, not inferred or assumed
    throw new Error("Not implemented - requires Samsara integration");
  }

  async lookupVehicleByVIN(vin: string): Promise<Partial<ELDVehicle> | null> {
    // Samsara: GET /fleet/vehicles/vin/{vin}
    // Or fallback to NHTSA VIN decoder + fuel tank database
    throw new Error("Not implemented - requires Samsara integration");
  }
}

/**
 * Geotab Provider Implementation (Future)
 * https://geotab.com/developer/api/
 */
export class GeotabProvider implements ELDProvider {
  async init(config: Record<string, any>) {
    throw new Error("Geotab provider not yet implemented");
  }

  async getDrivers(tenantId: string): Promise<ELDDriver[]> {
    throw new Error("Geotab provider not yet implemented");
  }

  async getVehicles(tenantId: string): Promise<ELDVehicle[]> {
    throw new Error("Geotab provider not yet implemented");
  }

  async getEvents(
    driverId: string,
    startDate: string,
    endDate: string,
    eventTypes?: string[]
  ): Promise<ELDEvent[]> {
    throw new Error("Geotab provider not yet implemented");
  }

  async getFuelLevels(
    vehicleId: string,
    startDate: string,
    endDate: string
  ): Promise<ELDFuelLevel[]> {
    throw new Error("Geotab provider not yet implemented");
  }

  async getDriverEfficiency(
    driverId: string,
    startDate: string,
    endDate: string
  ): Promise<ELDDriverEfficiency[]> {
    throw new Error("Geotab provider not yet implemented");
  }
}

// ============================================================================
// USAGE IN APP
// ============================================================================

/**
 * Example: Get driver events with proper ELD provider abstraction
 * 
 * Usage:
 *   const provider = new SamsaraProvider();
 *   await provider.init({ apiKey: process.env.SAMSARA_API_KEY });
 *   
 *   const events = await provider.getEvents(driverId, startDate, endDate);
 *   // events will only contain fields actually available from Samsara
 *   // NO assumed/fake data
 */

// ============================================================================
// KEY ARCHITECTURAL DECISIONS
// ============================================================================

/**
 * 1. NO ASSUMED DATA
 *    - If a field is not available from the ELD provider, don't generate it
 *    - Remove from UI rather than assume/fake
 *    - Example: Fuel consumption → removed until vehicle fuel tank capacity is available
 * 
 * 2. PROVIDER-AGNOSTIC TYPES
 *    - Core types (ELDEvent, ELDDriver, etc.) don't reference Samsara specifics
 *    - All providers map to same types
 *    - Allows swapping providers without app code changes
 * 
 * 3. VEHICLE FUEL TANK CAPACITY IS CRITICAL
 *    - Required for calculating fuel consumption from tank level changes
 *    - Must be populated via VIN lookup (Samsara endpoint, NHTSA, etc.)
 *    - Stored in database for repeated use
 * 
 * 4. LAYERED ARCHITECTURE
 *    - Database layer (vehicles, driver_analytics_events, etc.)
 *    - ELD Provider layer (Samsara, Geotab, etc.)
 *    - API layer (normalizes across providers)
 *    - UI layer (displays provider-available data only)
 * 
 * 5. FUTURE-READY
 *    - Can swap SamsaraProvider with GeotabProvider without UI changes
 *    - Can support multiple providers simultaneously (multi-fleet)
 *    - New fields require schema migration, not code assumptions
 */
