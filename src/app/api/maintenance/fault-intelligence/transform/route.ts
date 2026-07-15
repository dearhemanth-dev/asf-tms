import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const SAMSARA_STATS_URL = "https://api.samsara.com/fleet/vehicles/stats";
const VPIC_DECODE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended";

const ALLOWED_SEVERITIES = new Set(["CRITICAL_SHUTDOWN", "INTERCEPT_NOW", "MONITOR_AND_RUN"]);
const ALLOWED_RESOURCES = new Set(["PARTS_REQUIRED", "LABOR_ONLY", "DIAGNOSTIC_SOFTWARE_FLASH"]);

const SYSTEM_PROMPT =
  "You are a Heavy-Duty Diesel Master Fleet Logician and Director of Maintenance. You are analyzing an active fault on a Class 8 OTR commercial asset(with mid to high odometer mileages, even over 1 million miles). You must synthesize the provided ground-truth mechanical manual text into four hyper-focused, trustworthy, and actionable perspective strings. If VIN-derived asset profile fields are present, use them to increase specificity without inventing unsupported details. Do not invent mechanical symptoms outside the provided reference text.\n\n" +
  "Your output must be a strict JSON object mapping exactly to these keys:\n" +
  "{\n" +
  '  "driver_speak": {\n' +
  '    "severity": "CRITICAL_SHUTDOWN", "INTERCEPT_NOW", or "MONITOR_AND_RUN",\n' +
  '    "safe_miles_remaining": "Strict integer estimate based ONLY on the operational danger context",\n' +
  '    "safety_details": "Short, clear safety message for the driver\'s mobile screen (e.g., \'Pull over if you see smoke\' or \'Keep engine running at next stop\')"\n' +
  "  },\n" +
  '  "mechanic_speak": {\n' +
  '    "required_resources": "Strict array containing combinations of: \'PARTS_REQUIRED\', \'LABOR_ONLY\', \'DIAGNOSTIC_SOFTWARE_FLASH\'",\n' +
  '    "inspection_focus": "1-sentence pinpoint instruction telling the shop mechanic exactly what physical valve, line, or circuit to test first to bypass generic troubleshooting",\n' +
  '    "likely_failure_chain": "Optional short plain-language sequence explaining probable failure progression from first fault to drivability impact",\n' +
  '    "first_30_minute_actions": "Optional concise numbered checklist for the first 30 minutes in-bay",\n' +
  '    "parts_to_pre_stage": "Optional concrete parts list (text or array) to pre-stage before teardown",\n' +
  '    "likely_parts_needed": "Optional plain-language list of the most likely replacement parts or kits",\n' +
  '    "labor_time_estimate_hours": "Optional estimated labor time window in hours for the first repair pass",\n' +
  '    "parts_specifics": "Optional plain-language details about which part family, connector, sensor, valve, or hose is most likely involved"\n' +
  "  },\n" +
  '  "dispatcher_speak": {\n' +
  '    "miles_vs_delivery_status": "Clear statement comparing the safe_miles_remaining ",\n' +
  '    "post_breakdown_timeline_hours": "Estimated down-time in hours if this truck is allowed to completely break down on the road, including towing, part sourcing, and active bay labor"\n' +
  "  },\n" +
  '  "manager_speak": {\n' +
  '    "estimated_roadside_cost_usd": "Realistic dollar amount range for an emergency OTR road-call repair vs an in-house shop fix",\n' +
  '    "likely_parts_costs_usd": "Optional likely parts cost range in USD broken out from the repair path",\n' +
  '    "likely_labor_costs_usd": "Optional likely labor cost range in USD broken out from the repair path",\n' +
  '    "estimated_labor_hours": "Optional estimated labor hours needed for the repair path",\n' +
  '    "standard_shop_rate_usd_per_hour": "Optional standard shop labor rate in USD per hour",\n' +
  '    "roadside_rate_usd_per_hour": "Optional roadside labor rate in USD per hour",\n' +
  '    "parts_cost_usd": "Optional estimated parts cost range in USD for the likely repair path",\n' +
  '    "labor_cost_usd": "Optional estimated labor cost range in USD for the likely repair path",\n' +
  '    "tow_cost_usd": "Optional estimated tow or recovery cost range in USD if the truck fails roadside",\n' +
  '    "roadside_fee_usd": "Optional estimated emergency road-call fee range in USD",\n' +
  '    "total_estimated_cost_usd": "Optional total estimated cost range in USD combining parts, labor, and roadside exposure",\n' +
  '    "cost_breakdown_summary": "Optional short plain-language summary of what is driving the bill",\n' +
  '    "root_cause_recurrence_intelligence": "An executive summary explaining why this engine repeats this failure (e.g., component fatigue, carbon buildup due to excessive idling, or sequential sensor degradation), guiding the manager on whether to patch or permanently overhaul the assembly"\n' +
  "  }\n" +
  "}";

type FaultInput = {
  spn: number;
  fmi: number;
  affected_system: string;
  mechanic_repair_steps: string;
  operational_danger: string;
  truck_mileage: number | null;
  remaining_trip_distance_miles: number | null;
  samsara_vehicle_id?: string;
  vin?: string;
};

type AssetProfile = {
  vin: string;
  year: string | null;
  make: string | null;
  model: string | null;
  body_class: string | null;
  fuel_type: string | null;
  engine_model: string | null;
  engine_manufacturer: string | null;
  vehicle_type: string | null;
  asset_no: string | null;
  asset_unit_number: string | null;
  source: "assets_table" | "vpic_decode" | "vin_only";
};

type ExecutionMode = "auto" | "ai" | "local";

type ModelProfile = "economy" | "balanced" | "trusted";

type ModelPlan = {
  profile: ModelProfile;
  primaryModel: string;
  verifierModel: string;
};

function normalizeModelProfile(value: unknown): ModelProfile {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "economy") return "economy";
  if (normalized === "trusted") return "trusted";
  return "balanced";
}

function normalizeExecutionMode(value: unknown): ExecutionMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "ai") return "ai";
  if (normalized === "local") return "local";
  return "auto";
}

function getModelPlan(profile: ModelProfile): ModelPlan {
  if (profile === "economy") {
    return {
      profile,
      primaryModel: "gpt-4o-mini",
      verifierModel: "gpt-4o-mini",
    };
  }

  if (profile === "trusted") {
    return {
      profile,
      primaryModel: "gpt-4o",
      verifierModel: "gpt-4o",
    };
  }

  return {
    profile: "balanced",
    primaryModel: "gpt-4o-mini",
    verifierModel: "gpt-4o",
  };
}

function containsAny(text: string, needles: string[]): boolean {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function inferSeverityFromDanger(operationalDanger: string): "CRITICAL_SHUTDOWN" | "INTERCEPT_NOW" | "MONITOR_AND_RUN" {
  const normalized = operationalDanger.toLowerCase();

  if (
    containsAny(normalized, [
      "catastrophic",
      "seizure",
      "pull over",
      "shutdown",
      "head gasket",
      "cylinder head damage",
      "overheat",
      "fire",
    ])
  ) {
    return "CRITICAL_SHUTDOWN";
  }

  if (
    containsAny(normalized, [
      "derate",
      "stall",
      "roadside",
      "lose power",
      "stranded",
      "no-start",
      "no restart",
      "cannot complete",
    ])
  ) {
    return "INTERCEPT_NOW";
  }

  return "MONITOR_AND_RUN";
}

function inferSafeMilesRemaining(operationalDanger: string, severity: string): string {
  const normalized = operationalDanger.toLowerCase();
  if (containsAny(normalized, ["very little warning", "rapidly", "short distance"])) return "25";
  if (severity === "CRITICAL_SHUTDOWN") return "50";
  if (containsAny(normalized, ["100-300 miles", "100 to 300 miles"])) return "150";
  if (severity === "INTERCEPT_NOW") return "150";
  return "300";
}

function inferSafetyDetails(affectedSystem: string, operationalDanger: string): string {
  const system = affectedSystem.toLowerCase();
  const danger = operationalDanger.toLowerCase();

  if (containsAny(system + " " + danger, ["coolant", "overheat"])) {
    return "Pull over immediately if temperature rises or coolant is visible.";
  }
  if (containsAny(system + " " + danger, ["oil pressure", "lubrication"])) {
    return "Shut the engine down immediately if the oil-pressure warning stays active.";
  }
  if (containsAny(system + " " + danger, ["fuel", "stall", "no-start"])) {
    return "Avoid shutting the truck down in an unsafe location until support is arranged.";
  }
  if (containsAny(system + " " + danger, ["battery", "charging", "voltage"])) {
    return "Limit extra electrical loads and do not ignore repeated warning lights.";
  }
  return "Reduce load, monitor warning behavior closely, and wait for dispatch instructions.";
}

function inferRequiredResources(mechanicRepairSteps: string, affectedSystem: string): string[] {
  const normalized = `${mechanicRepairSteps} ${affectedSystem}`.toLowerCase();
  const resources = new Set<string>();

  if (containsAny(normalized, ["replace", "sensor", "injector", "pump", "thermostat", "valve", "filter", "dpf", "catalyst"])) {
    resources.add("PARTS_REQUIRED");
  }
  if (containsAny(normalized, ["inspect", "pressure test", "check", "verify", "continuity", "load-test", "wiggle-test"])) {
    resources.add("LABOR_ONLY");
  }
  if (containsAny(normalized, ["diagnostic tool", "ecm", "command", "regen", "calibrate", "flash", "live data"])) {
    resources.add("DIAGNOSTIC_SOFTWARE_FLASH");
  }

  if (resources.size === 0) resources.add("LABOR_ONLY");
  return Array.from(resources);
}

function inferInspectionFocus(mechanicRepairSteps: string, affectedSystem: string): string {
  const normalized = `${mechanicRepairSteps} ${affectedSystem}`.toLowerCase();

  if (containsAny(normalized, ["coolant", "radiator", "fan clutch", "water pump"])) {
    return "Start by pressure-testing the cooling circuit and confirming fan-clutch and water-pump operation before wider teardown.";
  }
  if (containsAny(normalized, ["oil pressure", "pickup tube", "oil pump"])) {
    return "Start with a mechanical oil-pressure check at the engine and inspect the sender circuit before opening deeper engine components.";
  }
  if (containsAny(normalized, ["fuel", "lift pump", "separator", "rail"])) {
    return "Start at the fuel supply side by checking restriction across the filters, separator, and lift-pump feed circuit.";
  }
  if (containsAny(normalized, ["nox", "def", "scr", "dpf", "aftertreatment"])) {
    return "Start at the first affected aftertreatment sensor or dosing circuit and confirm connector integrity and live response before replacing hardware.";
  }
  if (containsAny(normalized, ["battery", "voltage", "alternator", "ground"])) {
    return "Start with voltage-drop testing across the main power, ground, and charging circuit before condemning modules.";
  }

  return "Start with the first named sensor, valve, line, or circuit in the repair steps and verify physical integrity before broader troubleshooting.";
}

function inferLikelyPartsNeeded(mechanicRepairSteps: string, affectedSystem: string): string {
  const normalized = `${mechanicRepairSteps} ${affectedSystem}`.toLowerCase();

  if (containsAny(normalized, ["coolant", "radiator", "fan clutch", "water pump"])) {
    return "Fan clutch assembly, thermostat, upper/lower coolant hoses, pressure cap, water pump kit, coolant temperature sensor";
  }
  if (containsAny(normalized, ["aftertreatment", "scr", "dpf", "nox", "def"])) {
    return "NOx sensor, dosing valve, DEF quality sensor, pressure sensor, harness connector kit, clamps and seals";
  }
  if (containsAny(normalized, ["fuel", "lift pump", "injector", "rail", "separator"])) {
    return "Fuel filters, water separator service kit, lift pump, pressure sensor, fuel lines or fittings, injector seals if leak is found";
  }
  if (containsAny(normalized, ["battery", "alternator", "ground", "voltage", "sensor"])) {
    return "Battery cables, ground straps, alternator regulator, fuses, connectors, terminal ends, damaged sensor pigtails";
  }

  return "Likely sensor or harness-related parts, connector repair materials, seals, clamps, and any component named in the fault tree.";
}

function inferLaborTimeEstimateHours(mechanicRepairSteps: string, affectedSystem: string): string {
  const normalized = `${mechanicRepairSteps} ${affectedSystem}`.toLowerCase();

  if (containsAny(normalized, ["coolant", "radiator", "fan clutch", "water pump"])) return "1.5-4.0 hours";
  if (containsAny(normalized, ["aftertreatment", "scr", "dpf", "nox", "def"])) return "2.5-6.5 hours";
  if (containsAny(normalized, ["fuel", "lift pump", "injector", "rail", "separator"])) return "1.5-5.0 hours";
  if (containsAny(normalized, ["battery", "alternator", "ground", "voltage", "sensor"])) return "1.0-3.5 hours";

  return "1.0-4.0 hours";
}

function parseHourRange(value: string): { min: number; max: number } {
  const match = value.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    const single = Number(value.match(/\d+(?:\.\d+)?/)?.[0] ?? "0");
    return { min: single, max: single };
  }

  return {
    min: Number(match[1]),
    max: Number(match[2]),
  };
}

function formatUsdRange(minValue: number, maxValue: number): string {
  const roundedMin = Math.max(0, Math.round(minValue / 25) * 25);
  const roundedMax = Math.max(0, Math.round(maxValue / 25) * 25);
  return `$${roundedMin.toLocaleString("en-US")}-${roundedMax.toLocaleString("en-US")}`;
}

function estimateLaborCostRange(hoursRange: string, rateMin: number, rateMax: number): string {
  const hours = parseHourRange(hoursRange);
  return formatUsdRange(hours.min * rateMin, hours.max * rateMax);
}

function inferPartsSpecifics(mechanicRepairSteps: string, affectedSystem: string): string {
  const normalized = `${mechanicRepairSteps} ${affectedSystem}`.toLowerCase();

  if (containsAny(normalized, ["coolant", "radiator", "fan clutch", "water pump"])) {
    return "Focus on the exact cooling-side component that failed first: fan clutch engagement, thermostat opening, hose integrity, and pump circulation.";
  }
  if (containsAny(normalized, ["aftertreatment", "scr", "dpf", "nox", "def"])) {
    return "The likely culprit is usually the sensor or dosing side first, then the harness, seals, and any plugged or contaminated aftertreatment component.";
  }
  if (containsAny(normalized, ["fuel", "lift pump", "injector", "rail", "separator"])) {
    return "Check for restriction, leaks, weak pressure, and contaminated supply hardware before swapping larger fuel system parts.";
  }
  if (containsAny(normalized, ["battery", "alternator", "ground", "voltage", "sensor"])) {
    return "Most repairs start with the connector, cable, or sensor pigtail before replacing the main module or charging unit.";
  }

  return "The most likely failure point is the first sensor, hose, connector, or valve named in the repair notes, not the entire assembly.";
}

function inferPostBreakdownTimelineHours(severity: string, affectedSystem: string): string {
  const system = affectedSystem.toLowerCase();
  if (severity === "CRITICAL_SHUTDOWN") {
    if (containsAny(system, ["aftertreatment", "scr", "dpf"])) return "18-36";
    return "12-24";
  }
  if (severity === "INTERCEPT_NOW") {
    if (containsAny(system, ["fuel", "oil", "cooling"])) return "10-20";
    return "8-18";
  }
  return "4-10";
}

function inferMilesVsDeliveryStatus(safeMilesRemaining: string, remainingTripDistanceMiles: number | null): string {
  if (remainingTripDistanceMiles === null) {
    return `Safe-miles estimate is ${safeMilesRemaining}; compare this against trip distance before dispatch commits the truck.`;
  }

  const safeMiles = Number(safeMilesRemaining);
  if (remainingTripDistanceMiles > safeMiles) {
    return `Remaining trip distance of ${remainingTripDistanceMiles} miles exceeds the safe-mile estimate of ${safeMilesRemaining}; reroute or intercept this unit.`;
  }

  return `Remaining trip distance of ${remainingTripDistanceMiles} miles is within the safe-mile estimate of ${safeMilesRemaining}, but dispatch should still manage the stop plan tightly.`;
}

function inferRoadsideCost(severity: string, affectedSystem: string): string {
  const system = affectedSystem.toLowerCase();
  if (severity === "CRITICAL_SHUTDOWN") {
    if (containsAny(system, ["aftertreatment", "scr", "dpf"])) return "$3,500-$8,500 roadside vs $1,500-$4,500 in-house";
    return "$2,500-$7,500 roadside vs $900-$3,500 in-house";
  }
  if (containsAny(system, ["sensor", "electrical", "voltage", "barometric"])) {
    return "$900-$2,200 roadside vs $250-$900 in-house";
  }
  return "$1,200-$3,500 roadside vs $400-$1,500 in-house";
}

function inferLikelyPartsCosts(severity: string, affectedSystem: string): string {
  const system = affectedSystem.toLowerCase();
  if (containsAny(system, ["aftertreatment", "scr", "dpf", "nox"])) return "$900-$3,200";
  if (containsAny(system, ["coolant", "radiator", "fan clutch", "water pump"])) return "$250-$1,400";
  if (containsAny(system, ["fuel", "lift pump", "injector", "rail", "separator"])) return "$300-$1,800";
  if (containsAny(system, ["battery", "alternator", "ground", "voltage", "sensor"])) return "$120-$650";
  return severity === "CRITICAL_SHUTDOWN" ? "$250-$1,500" : "$200-$900";
}

function inferLikelyLaborCosts(severity: string, affectedSystem: string): string {
  const system = affectedSystem.toLowerCase();
  const laborHours = inferLaborTimeEstimateHours("", affectedSystem);

  if (containsAny(system, ["aftertreatment", "scr", "dpf", "nox", "def"])) return estimateLaborCostRange(laborHours, 225, 300);
  if (containsAny(system, ["coolant", "radiator", "fan clutch", "water pump"])) return estimateLaborCostRange(laborHours, 215, 285);
  if (containsAny(system, ["fuel", "lift pump", "injector", "rail", "separator"])) return estimateLaborCostRange(laborHours, 210, 285);
  if (containsAny(system, ["battery", "alternator", "ground", "voltage", "sensor"])) return estimateLaborCostRange(laborHours, 200, 260);
  return estimateLaborCostRange(laborHours, severity === "CRITICAL_SHUTDOWN" ? 225 : 210, severity === "CRITICAL_SHUTDOWN" ? 300 : 240);
}

function inferManagerCostBreakdown(severity: string, affectedSystem: string): {
  likely_parts_costs_usd: string;
  likely_labor_costs_usd: string;
  estimated_labor_hours: string;
  standard_shop_rate_usd_per_hour: string;
  roadside_rate_usd_per_hour: string;
  parts_cost_usd: string;
  labor_cost_usd: string;
  tow_cost_usd: string;
  roadside_fee_usd: string;
  total_estimated_cost_usd: string;
  cost_breakdown_summary: string;
} {
  const system = affectedSystem.toLowerCase();
  const isAftertreatment = containsAny(system, ["aftertreatment", "scr", "dpf", "nox"]);
  const isCooling = containsAny(system, ["coolant", "radiator", "fan clutch", "water pump"]);
  const isFuel = containsAny(system, ["fuel", "lift pump", "injector", "rail"]);
  const isElectrical = containsAny(system, ["battery", "alternator", "ground", "voltage", "sensor"]);
  const laborHours = inferLaborTimeEstimateHours("", affectedSystem);
  const standardLaborCost = estimateLaborCostRange(laborHours, 210, 240);
  const roadsideLaborCost = estimateLaborCostRange(laborHours, 250, 325);
  const standardRate = "$210-$240/hr";
  const roadsideRate = "$250-$325/hr";

  if (severity === "CRITICAL_SHUTDOWN") {
    if (isAftertreatment) {
      return {
        likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
        likely_labor_costs_usd: roadsideLaborCost,
        estimated_labor_hours: laborHours,
        standard_shop_rate_usd_per_hour: standardRate,
        roadside_rate_usd_per_hour: roadsideRate,
        parts_cost_usd: "$900-$3,200",
        labor_cost_usd: standardLaborCost,
        tow_cost_usd: "$500-$1,500",
        roadside_fee_usd: "$400-$900",
        total_estimated_cost_usd: "$2,500-$7,600",
        cost_breakdown_summary: `Aftertreatment jobs usually stack parts, diagnostics, and roadside recovery because the truck may derate or park itself before the repair is complete. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
      };
    }

    if (isCooling) {
      return {
        likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
        likely_labor_costs_usd: roadsideLaborCost,
        estimated_labor_hours: laborHours,
        standard_shop_rate_usd_per_hour: standardRate,
        roadside_rate_usd_per_hour: roadsideRate,
        parts_cost_usd: "$250-$1,400",
        labor_cost_usd: standardLaborCost,
        tow_cost_usd: "$400-$1,200",
        roadside_fee_usd: "$350-$850",
        total_estimated_cost_usd: "$1,650-$5,250",
        cost_breakdown_summary: `Cooling failures are usually labor-heavy once the truck overheats, and towing becomes expensive if the driver has to stop roadside. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
      };
    }

    if (isFuel) {
      return {
        likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
        likely_labor_costs_usd: roadsideLaborCost,
        estimated_labor_hours: laborHours,
        standard_shop_rate_usd_per_hour: standardRate,
        roadside_rate_usd_per_hour: roadsideRate,
        parts_cost_usd: "$300-$1,800",
        labor_cost_usd: standardLaborCost,
        tow_cost_usd: "$350-$1,100",
        roadside_fee_usd: "$350-$850",
        total_estimated_cost_usd: "$1,600-$5,450",
        cost_breakdown_summary: `Fuel system repairs are often split between parts replacement, diagnostic labor, and tow exposure if the truck cannot restart. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
      };
    }

    return {
      likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
      likely_labor_costs_usd: roadsideLaborCost,
      estimated_labor_hours: laborHours,
      standard_shop_rate_usd_per_hour: standardRate,
      roadside_rate_usd_per_hour: roadsideRate,
      parts_cost_usd: "$250-$1,500",
      labor_cost_usd: standardLaborCost,
      tow_cost_usd: "$350-$1,200",
      roadside_fee_usd: "$350-$900",
      total_estimated_cost_usd: "$1,550-$5,400",
      cost_breakdown_summary: `Critical shutdown faults tend to be expensive because the truck stops generating revenue while diagnostics, parts, and recovery are all on the clock. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
    };
  }

  if (isElectrical) {
    return {
      likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
      likely_labor_costs_usd: roadsideLaborCost,
      estimated_labor_hours: laborHours,
      standard_shop_rate_usd_per_hour: standardRate,
      roadside_rate_usd_per_hour: roadsideRate,
      parts_cost_usd: "$120-$650",
      labor_cost_usd: standardLaborCost,
      tow_cost_usd: "$0-$500",
      roadside_fee_usd: "$250-$600",
      total_estimated_cost_usd: "$620-$2,700",
      cost_breakdown_summary: `Electrical faults can be cheaper on parts but still expensive when diagnosis takes time and roadside troubleshooting is needed. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
    };
  }

  return {
    likely_parts_costs_usd: inferLikelyPartsCosts(severity, affectedSystem),
    likely_labor_costs_usd: roadsideLaborCost,
    estimated_labor_hours: laborHours,
    standard_shop_rate_usd_per_hour: standardRate,
    roadside_rate_usd_per_hour: roadsideRate,
    parts_cost_usd: "$200-$900",
    labor_cost_usd: standardLaborCost,
    tow_cost_usd: "$200-$900",
    roadside_fee_usd: "$250-$700",
    total_estimated_cost_usd: "$950-$3,600",
    cost_breakdown_summary: `The bill is driven by diagnosis time, replacement parts, and whether the truck can make it back to the shop under its own power. Standard shop labor is usually about $210-$240 per hour; roadside work runs higher.`,
  };
}

function inferRootCauseRecurrence(affectedSystem: string, mechanicRepairSteps: string, truckMileage: number | null): string {
  const normalized = `${affectedSystem} ${mechanicRepairSteps}`.toLowerCase();
  const mileageText = truckMileage !== null && truckMileage >= 900000
    ? " On a high-mileage asset, cumulative fatigue and repeated heat cycling materially increase recurrence risk."
    : "";

  if (containsAny(normalized, ["aftertreatment", "def", "nox", "scr", "dpf"])) {
    return `This fault family commonly repeats because contamination, soot loading, heat damage, and sensor drift build on each other across the entire aftertreatment chain.${mileageText} Treat repeated events as an assembly-health issue, not a one-part event.`;
  }
  if (containsAny(normalized, ["coolant", "radiator", "water pump", "fan clutch"])) {
    return `This failure usually recurs because cooling-system weakness is cumulative: minor leaks, airflow loss, and mechanical wear compound until the next heat-load event exposes them.${mileageText} Management should correct the weakest subsystem, not just reset the symptom.`;
  }
  if (containsAny(normalized, ["oil", "lubrication"])) {
    return `This fault tends to repeat when the engine has underlying wear, degraded oil control, or a sender-versus-pressure mismatch that was not fully confirmed on the first repair.${mileageText} Repeat cases should trigger deeper engine-condition review.`;
  }
  if (containsAny(normalized, ["fuel", "lift pump", "separator"])) {
    return `This fault often repeats because restriction, contamination, or weak supply hardware remains in the system after a partial fix.${mileageText} Management should inspect the whole supply path instead of replacing one visible component at a time.`;
  }
  if (containsAny(normalized, ["battery", "alternator", "ground", "voltage", "sensor"])) {
    return `This failure class often repeats because wiring fatigue, connector corrosion, and charging instability create cascading sensor and module behavior.${mileageText} The permanent fix is circuit integrity restoration, not repeated symptom swaps.`;
  }

  return `This failure can recur when the original repair does not remove the underlying wear, contamination, or circuit instability behind the active code.${mileageText} Management should use recurrence as a signal to escalate from patch repair to subsystem-level correction.`;
}

function buildDeterministicOutput(context: FaultInput & { truck_mileage: number | null }): Record<string, unknown> {
  const severity = inferSeverityFromDanger(context.operational_danger);
  const safeMilesRemaining = inferSafeMilesRemaining(context.operational_danger, severity);

  return {
    driver_speak: {
      severity,
      safe_miles_remaining: safeMilesRemaining,
      safety_details: inferSafetyDetails(context.affected_system, context.operational_danger),
    },
    mechanic_speak: {
      required_resources: inferRequiredResources(context.mechanic_repair_steps, context.affected_system),
      inspection_focus: inferInspectionFocus(context.mechanic_repair_steps, context.affected_system),
      likely_parts_needed: inferLikelyPartsNeeded(context.mechanic_repair_steps, context.affected_system),
      labor_time_estimate_hours: inferLaborTimeEstimateHours(context.mechanic_repair_steps, context.affected_system),
      parts_specifics: inferPartsSpecifics(context.mechanic_repair_steps, context.affected_system),
    },
    dispatcher_speak: {
      miles_vs_delivery_status: inferMilesVsDeliveryStatus(safeMilesRemaining, context.remaining_trip_distance_miles),
      post_breakdown_timeline_hours: inferPostBreakdownTimelineHours(severity, context.affected_system),
    },
    manager_speak: {
      estimated_roadside_cost_usd: inferRoadsideCost(severity, context.affected_system),
      ...inferManagerCostBreakdown(severity, context.affected_system),
      root_cause_recurrence_intelligence: inferRootCauseRecurrence(
        context.affected_system,
        context.mechanic_repair_steps,
        context.truck_mileage
      ),
    },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeVin(value: unknown): string {
  return asString(value).toUpperCase();
}

function asIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function validateInput(payload: Record<string, unknown>): { ok: true; data: FaultInput } | { ok: false; message: string } {
  const spn = asIntegerOrNull(payload.spn);
  const fmi = asIntegerOrNull(payload.fmi);
  if (spn === null) return { ok: false, message: "spn must be an integer" };
  if (fmi === null) return { ok: false, message: "fmi must be an integer" };

  const affectedSystem = asString(payload.affected_system);
  const mechanicRepairSteps = asString(payload.mechanic_repair_steps);
  const operationalDanger = asString(payload.operational_danger);

  if (!affectedSystem) return { ok: false, message: "affected_system is required" };
  if (!mechanicRepairSteps) return { ok: false, message: "mechanic_repair_steps is required" };
  if (!operationalDanger) return { ok: false, message: "operational_danger is required" };

  const truckMileage = asIntegerOrNull(payload.truck_mileage);
  const remainingTripDistanceMiles = asIntegerOrNull(payload.remaining_trip_distance_miles);
  const samsaraVehicleId = asString(payload.samsara_vehicle_id);
  const vin = normalizeVin(payload.vin);
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return { ok: false, message: "vin must be a valid 17-character VIN" };
  }

  return {
    ok: true,
    data: {
      spn,
      fmi,
      affected_system: affectedSystem,
      mechanic_repair_steps: mechanicRepairSteps,
      operational_danger: operationalDanger,
      truck_mileage: truckMileage,
      remaining_trip_distance_miles: remainingTripDistanceMiles,
      samsara_vehicle_id: samsaraVehicleId || undefined,
      vin: vin || undefined,
    },
  };
}

async function deduceAssetProfileByVin(vin: string | undefined, tenantId: string | null): Promise<AssetProfile | null> {
  const normalizedVin = normalizeVin(vin);
  if (!normalizedVin) return null;

  if (tenantId) {
    try {
      const supabase = await getSupabaseServerClient();
      const { data } = await supabase
        .from("assets")
        .select("asset_no, asset_unit_number, year, make, model")
        .eq("tenant_id", tenantId)
        .eq("vin", normalizedVin)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          vin: normalizedVin,
          year: asString(data.year) || null,
          make: asString(data.make) || null,
          model: asString(data.model) || null,
          body_class: null,
          fuel_type: null,
          engine_model: null,
          engine_manufacturer: null,
          vehicle_type: null,
          asset_no: asString(data.asset_no) || null,
          asset_unit_number: asString(data.asset_unit_number) || null,
          source: "assets_table",
        };
      }
    } catch {
      // Fall back to VPIC decode.
    }
  }

  try {
    const response = await fetch(`${VPIC_DECODE_URL}/${encodeURIComponent(normalizedVin)}?format=json`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        vin: normalizedVin,
        year: null,
        make: null,
        model: null,
        body_class: null,
        fuel_type: null,
        engine_model: null,
        engine_manufacturer: null,
        vehicle_type: null,
        asset_no: null,
        asset_unit_number: null,
        source: "vin_only",
      };
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const rows = Array.isArray(payload.Results) ? payload.Results : [];
    const decoded = asObject(rows[0]);

    if (!decoded) {
      return {
        vin: normalizedVin,
        year: null,
        make: null,
        model: null,
        body_class: null,
        fuel_type: null,
        engine_model: null,
        engine_manufacturer: null,
        vehicle_type: null,
        asset_no: null,
        asset_unit_number: null,
        source: "vin_only",
      };
    }

    return {
      vin: normalizedVin,
      year: asString(decoded.ModelYear) || null,
      make: asString(decoded.Make) || null,
      model: asString(decoded.Model) || null,
      body_class: asString(decoded.BodyClass) || null,
      fuel_type: asString(decoded.FuelTypePrimary) || null,
      engine_model: asString(decoded.EngineModel) || null,
      engine_manufacturer: asString(decoded.EngineManufacturer) || null,
      vehicle_type: asString(decoded.VehicleType) || null,
      asset_no: null,
      asset_unit_number: null,
      source: "vpic_decode",
    };
  } catch {
    return {
      vin: normalizedVin,
      year: null,
      make: null,
      model: null,
      body_class: null,
      fuel_type: null,
      engine_model: null,
      engine_manufacturer: null,
      vehicle_type: null,
      asset_no: null,
      asset_unit_number: null,
      source: "vin_only",
    };
  }
}

async function deduceTruckMileage(input: FaultInput): Promise<number | null> {
  if (input.truck_mileage !== null) return input.truck_mileage;
  if (!input.samsara_vehicle_id) return null;

  const token = process.env.SAMSARA_BEARER_TOKEN;
  if (!token) return null;

  const params = new URLSearchParams({
    types: "obdOdometerMeters",
    vehicleIds: input.samsara_vehicle_id,
    limit: "1",
  });

  const response = await fetch(`${SAMSARA_STATS_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const first = asObject(rows[0]);
  if (!first) return null;

  const stats = asObject(first.stats);
  const metersCandidate =
    (typeof stats?.obdOdometerMeters === "number" ? stats.obdOdometerMeters : null) ??
    (typeof first.obdOdometerMeters === "number" ? first.obdOdometerMeters : null);

  if (metersCandidate === null || metersCandidate < 0) return null;

  return Math.round(metersCandidate / 1609.344);
}

function validateOutput(payload: Record<string, unknown>): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const expectedTop = ["driver_speak", "mechanic_speak", "dispatcher_speak", "manager_speak"];
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = [...expectedTop].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    return { ok: false, message: `Output keys must be exactly ${expectedTop.join(", ")}` };
  }

  const driver = asObject(payload.driver_speak);
  const mechanic = asObject(payload.mechanic_speak);
  const dispatcher = asObject(payload.dispatcher_speak);
  const manager = asObject(payload.manager_speak);

  if (!driver || !mechanic || !dispatcher || !manager) {
    return { ok: false, message: "All persona blocks must be objects" };
  }

  const severity = asString(driver.severity);
  if (!ALLOWED_SEVERITIES.has(severity)) {
    return { ok: false, message: "driver_speak.severity is invalid" };
  }

  const safeMiles = asString(driver.safe_miles_remaining);
  if (!/^\d+$/.test(safeMiles)) {
    return { ok: false, message: "driver_speak.safe_miles_remaining must be an integer-like string" };
  }

  const requiredResources = Array.isArray(mechanic.required_resources) ? mechanic.required_resources : null;
  if (!requiredResources || requiredResources.length === 0) {
    return { ok: false, message: "mechanic_speak.required_resources must be a non-empty array" };
  }

  for (const resource of requiredResources) {
    const normalized = asString(resource);
    if (!ALLOWED_RESOURCES.has(normalized)) {
      return { ok: false, message: "mechanic_speak.required_resources contains invalid value" };
    }
  }

  if (!asString(driver.safety_details)) return { ok: false, message: "driver_speak.safety_details is required" };
  if (!asString(mechanic.inspection_focus)) return { ok: false, message: "mechanic_speak.inspection_focus is required" };
  if (!asString(dispatcher.miles_vs_delivery_status)) {
    return { ok: false, message: "dispatcher_speak.miles_vs_delivery_status is required" };
  }
  if (!asString(dispatcher.post_breakdown_timeline_hours)) {
    return { ok: false, message: "dispatcher_speak.post_breakdown_timeline_hours is required" };
  }
  if (!asString(manager.estimated_roadside_cost_usd)) {
    return { ok: false, message: "manager_speak.estimated_roadside_cost_usd is required" };
  }
  if (!asString(manager.root_cause_recurrence_intelligence)) {
    return { ok: false, message: "manager_speak.root_cause_recurrence_intelligence is required" };
  }

  return { ok: true, data: payload };
}

function normalizeOutputForSchema(
  payload: Record<string, unknown>,
  context: FaultInput & { truck_mileage: number | null }
): Record<string, unknown> {
  // Start from deterministic baseline so required fields are always present.
  const baseline = buildDeterministicOutput(context);

  const normalized: Record<string, unknown> = {
    ...baseline,
    ...payload,
  };

  const baselineDriver = asObject(baseline.driver_speak) ?? {};
  const baselineMechanic = asObject(baseline.mechanic_speak) ?? {};
  const baselineDispatcher = asObject(baseline.dispatcher_speak) ?? {};
  const baselineManager = asObject(baseline.manager_speak) ?? {};

  const mergedDriver = {
    ...baselineDriver,
    ...(asObject(normalized.driver_speak) ?? {}),
  };
  const mergedMechanic = {
    ...baselineMechanic,
    ...(asObject(normalized.mechanic_speak) ?? {}),
  };
  const mergedDispatcher = {
    ...baselineDispatcher,
    ...(asObject(normalized.dispatcher_speak) ?? {}),
  };
  const mergedManager = {
    ...baselineManager,
    ...(asObject(normalized.manager_speak) ?? {}),
  };

  normalized.driver_speak = mergedDriver;
  normalized.mechanic_speak = mergedMechanic;
  normalized.dispatcher_speak = mergedDispatcher;
  normalized.manager_speak = mergedManager;

  // Numeric estimates are authoritative from the deterministic engine, not the model.
  const trustedManagerFields = [
    "estimated_roadside_cost_usd",
    "likely_parts_costs_usd",
    "likely_labor_costs_usd",
    "estimated_labor_hours",
    "standard_shop_rate_usd_per_hour",
    "roadside_rate_usd_per_hour",
    "parts_cost_usd",
    "labor_cost_usd",
    "tow_cost_usd",
    "roadside_fee_usd",
    "total_estimated_cost_usd",
    "cost_breakdown_summary",
  ] as const;

  for (const field of trustedManagerFields) {
    if (field in mergedManager || field in baselineManager) {
      (mergedManager as Record<string, unknown>)[field] = (baselineManager as Record<string, unknown>)[field];
    }
  }

  const trustedMechanicFields = [
    "likely_parts_needed",
    "labor_time_estimate_hours",
    "parts_specifics",
  ] as const;

  for (const field of trustedMechanicFields) {
    if (field in mergedMechanic || field in baselineMechanic) {
      (mergedMechanic as Record<string, unknown>)[field] = (baselineMechanic as Record<string, unknown>)[field];
    }
  }

  normalized.manager_speak = mergedManager;
  normalized.mechanic_speak = mergedMechanic;

  const driver = asObject(normalized.driver_speak);
  if (driver) {
    const safeMilesRaw = driver.safe_miles_remaining;
    if (typeof safeMilesRaw === "number" && Number.isFinite(safeMilesRaw) && safeMilesRaw >= 0) {
      driver.safe_miles_remaining = String(Math.round(safeMilesRaw));
    } else if (typeof safeMilesRaw === "string") {
      const trimmed = safeMilesRaw.trim();
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        driver.safe_miles_remaining = String(Math.round(Number(trimmed)));
      }
    }

    normalized.driver_speak = driver;
  }

  const dispatcher = asObject(normalized.dispatcher_speak);
  if (dispatcher) {
    const timeline = asString(dispatcher.post_breakdown_timeline_hours);
    if (!timeline) {
      dispatcher.post_breakdown_timeline_hours = baselineDispatcher.post_breakdown_timeline_hours;
    }
    normalized.dispatcher_speak = dispatcher;
  }

  const mechanic = asObject(normalized.mechanic_speak);
  if (mechanic) {
    const resources = mechanic.required_resources;
    if (typeof resources === "string" && resources.trim()) {
      mechanic.required_resources = resources
        .split(/[|,]/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    normalized.mechanic_speak = mechanic;
  }

  return normalized;
}

function getResponseMode(executionMode: ExecutionMode, openAiKeyPresent: boolean): string {
  if (executionMode === "local" || !openAiKeyPresent) return "deterministic_local";
  return executionMode === "ai" ? "hybrid_trusted" : "hybrid_trusted";
}

async function callOpenAiJson(
  openAiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user"; content: string }>
): Promise<Record<string, unknown>> {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  const completion = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const details = typeof completion.error === "object" ? completion.error : completion;
    throw new Error(`OpenAI request failed for model ${model}: ${JSON.stringify(details)}`);
  }

  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const first = asObject(choices[0]);
  const message = asObject(first?.message);
  const content = asString(message?.content);

  if (!content) {
    throw new Error(`OpenAI returned empty content for model ${model}`);
  }

  const parsedUnknown = JSON.parse(content) as unknown;
  const parsed = asObject(parsedUnknown);
  if (!parsed) {
    throw new Error(`OpenAI returned non-object JSON for model ${model}`);
  }

  return parsed;
}

async function runAiTwoPassTransform(
  openAiKey: string,
  plan: ModelPlan,
  context: FaultInput & { truck_mileage: number | null }
): Promise<Record<string, unknown>> {
  const baseUserPrompt =
    "Use ONLY this ground-truth context and produce strict JSON output matching the required schema.\n" +
    `Context JSON:\n${JSON.stringify(context)}`;

  const draft = await callOpenAiJson(openAiKey, plan.primaryModel, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: baseUserPrompt },
  ]);

  const verifyPrompt =
    "You are a strict quality gate for fleet fault persona output. " +
    "Repair the draft so it remains fully grounded in the supplied context, remove unsupported claims, and keep the schema exact. " +
    "Return JSON only with the required keys.\n\n" +
    `Ground-truth context JSON:\n${JSON.stringify(context)}\n\n` +
    `Draft output JSON:\n${JSON.stringify(draft)}`;

  return callOpenAiJson(openAiKey, plan.verifierModel, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: verifyPrompt },
  ]);
}

export async function POST(request: Request): Promise<NextResponse> {
  const sessionUser = await getAppSessionUser(request);
  const username = (sessionUser?.username ?? "").trim().toLowerCase();

  if (username !== "hkmaintenance") {
    return NextResponse.json({ error: "This test endpoint is restricted to hkmaintenance." }, { status: 403 });
  }

  const openAiKey = process.env.OPENAI_API_KEY;

  const rawBody = (await request.json().catch(() => null)) as unknown;
  const body = asObject(rawBody);
  if (!body) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const inputCheck = validateInput(body);
  if (!inputCheck.ok) {
    return NextResponse.json({ error: inputCheck.message }, { status: 400 });
  }

  const profile = normalizeModelProfile(body.model_profile);
  const executionMode = normalizeExecutionMode(body.execution_mode);
  const modelPlan = getModelPlan(profile);

  const resolvedTruckMileage = await deduceTruckMileage(inputCheck.data);
  const assetProfile = await deduceAssetProfileByVin(inputCheck.data.vin, sessionUser?.tenantId ?? null);

  const context = {
    ...inputCheck.data,
    truck_mileage: resolvedTruckMileage,
    asset_profile: assetProfile,
  };

  const forceLocal = executionMode === "local";
  const forceAi = executionMode === "ai";

  if (forceAi && !openAiKey) {
    return NextResponse.json(
      {
        error: "AI mode requested but OPENAI_API_KEY is not configured.",
        mode: "ai_unavailable",
      },
      { status: 400 }
    );
  }

  if (forceLocal || !openAiKey) {
    const localOutput = buildDeterministicOutput(context);
    const outputCheck = validateOutput(localOutput);
    if (!outputCheck.ok) {
      return NextResponse.json({ error: outputCheck.message }, { status: 500 });
    }

    return NextResponse.json({
      input_context: context,
      output: outputCheck.data,
      mode: "deterministic_local",
      requested_execution_mode: executionMode,
      model_plan: {
        profile: modelPlan.profile,
        primary_model: null,
        verifier_model: null,
      },
      note: "Test-only transform complete in deterministic local mode. No database writes performed. Numeric estimates are deterministic.",
    });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = await runAiTwoPassTransform(openAiKey, modelPlan, context);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OpenAI transform failed",
      },
      { status: 502 }
    );
  }

  const normalizedParsed = normalizeOutputForSchema(parsed, context);
  const outputCheck = validateOutput(normalizedParsed);
  if (!outputCheck.ok) {
    return NextResponse.json({ error: outputCheck.message, raw: normalizedParsed }, { status: 502 });
  }

  return NextResponse.json({
    input_context: context,
    output: outputCheck.data,
    mode: getResponseMode(executionMode, Boolean(openAiKey)),
    requested_execution_mode: executionMode,
    model_plan: {
      profile: modelPlan.profile,
      primary_model: modelPlan.primaryModel,
      verifier_model: modelPlan.verifierModel,
    },
    note: "Test-only transform complete. No database writes performed. Numeric estimates are deterministic; AI is narrative-only.",
  });
}
