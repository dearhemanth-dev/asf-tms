"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { FLEET_API_ROUTES } from "@/lib/fleet-api";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";

type UserProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
  username?: string | null;
};

type FaultRecord = {
  sourceKeyIndex: number;
  vehicleId: string;
  vehicleName?: string;
  faultCodes: unknown;
  rawVehicle: Record<string, unknown>;
};

type FaultCodesResponse = {
  keyCount: number;
  successCount: number;
  failureCount: number;
  faults: FaultRecord[];
  failures?: Array<{ sourceKeyIndex: number; status?: number; message: string }>;
  guidance?: string;
  error?: string;
};

type WebhookMonitorResponse = {
  stale: boolean;
  staleThresholdHours: number;
  lastReceivedAt: string | null;
  lastSuccessAt: string | null;
  webhookConfig?: {
    organizationCount: number;
    webhookUrlCount: number;
    webhookSecretCount: number;
    configured: boolean;
  };
  signatureTotalsLast24h?: {
    valid: number;
    invalid: number;
  };
  totalsLast24h: {
    received: number;
    inserted: number;
    duplicates: number;
    errors: number;
  };
  topEventTypes: Array<{ eventType: string; count: number }>;
  fallbackActive?: boolean;
  fallbackAlertCountLast24h?: number;
  lastAlertAt?: string | null;
  lastAlertSource?: string | null;
  error?: string;
};

type BackfillAlertsResponse = {
  ok?: boolean;
  mode?: "dry-run" | "insert";
  date?: string;
  matchedVehicles?: number;
  snapshotFallbackUsed?: boolean;
  faultEntriesScanned?: number;
  dtcRowsSeen?: number;
  lightOnEntries?: number;
  candidateAlerts?: number;
  inserted?: number;
  duplicates?: number;
  errors?: number;
  sourceErrors?: string[];
  error?: string;
};

type ResetTestDataResponse = {
  ok?: boolean;
  deletedAlerts?: number;
  deletedIngestionLogs?: number;
  remainingAlerts?: number;
  remainingIngestionLogs?: number;
  error?: string;
};

type TestPushResponse = {
  ok?: boolean;
  attempted?: number;
  sent?: number;
  removed?: number;
  staleRemoved?: number;
  errors?: string[];
  targets?: string[];
  error?: string;
};

type SelfTestPushResponse = {
  ok?: boolean;
  tier?: "critical" | "warning" | "info";
  attempted?: number;
  sent?: number;
  removed?: number;
  errors?: string[];
  error?: string;
};

type PushDiagnosticsResponse = {
  ok?: boolean;
  username?: string;
  tenantId?: string | null;
  subscriptionCount?: number;
  error?: string;
};

type WebhookSettingsOrganization = {
  id: string;
  organizationName: string;
  webhookUrl: string;
  hasWebhookSecret: boolean;
};

type WebhookSettingsResponse = {
  tenantId?: string | null;
  organizations?: WebhookSettingsOrganization[];
  error?: string;
};

type SimulateSamsaraResponse = {
  ok?: boolean;
  simulatedEventId?: string;
  webhookStatus?: number;
  webhookResult?: {
    received?: number;
    inserted?: number;
    duplicates?: number;
    errors?: number;
    error?: string;
  };
  error?: string;
};

type PushActionAuditEntry = {
  id: string;
  username: string | null;
  user_role: string | null;
  action: string;
  status: "success" | "failed" | "info";
  options: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
};

type PushActionLogResponse = {
  ok?: boolean;
  rows?: PushActionAuditEntry[];
  error?: string;
};

type FaultDetail = {
  code: string;
  spn: string;
  fmi: string;
  spnDescription: string;
  fmiDescription: string;
  severity: string;
  alertRank: number;
  description: string;
  protocol: string;
  timestamp: string;
  raw: unknown;
};

type AlertLevel = {
  rank: number;
  label: string;
  action: string;
  className: string;
};

type DateTimeDisplay = {
  locale?: string;
  timeZone?: string;
};

type VehicleFaultView = {
  vehicleKey: string;
  vehicleLabel: string;
  sourceKeyIndex: number;
  faultCount: number;
  lastSeen: string;
  lastSeenLocation: string;
  latitude: number | null;
  longitude: number | null;
  alertLevel: AlertLevel | null;
  faults: FaultDetail[];
  health: {
    faultCodeCount: string;
    engineState: string;
    oilPressureKPa: string;
    coolantTempF: string;
    engineLoadPercent: string;
    engineHours: string;
    fuelPercent: string;
    odometerMiles: string;
    engineRpm: string;
    batteryVolts: string;
    fuelConsumedGallons: string;
    idlingHours: string;
    defLevelPercent: string;
    barometricPressurePa: string;
    ecuSpeedMph: string;
  };
  rawVehicle: Record<string, unknown>;
};

type HealthStatus = "good" | "warning" | "critical";

type ComponentHealth = {
  label: string;
  status: HealthStatus;
  summary: string;
  issues: FaultDetail[];
};

type RepairAlertCard = {
  title: string;
  timestamp: string;
  mechanicSpeak: string;
  managerSpeak: string;
  laborHours: string;
  partsRange: string;
  estimateConfidence: "Low" | "Medium" | "High";
  estimateBasis: string;
  estimateProviderPath?: string;
  urgency: "Immediate" | "High" | "Planned";
  source: string;
  occurrenceCount: number;
};

type LiveEstimateOverride = {
  laborHours: string;
  partsRange: string;
  estimateConfidence: "Low" | "Medium" | "High";
  estimateBasis: string;
  estimateProviderPath: string;
};

type NearbyDealer = {
  name: string;
  phone: string | null;
  distanceMiles: number;
  projectedParts: string;
  address: string;
  website: string | null;
  tip: string;
};

type PartEstimateLine = {
  part: string;
  range: string;
};

type NominatimDealerResult = {
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
};

type AssetVehicleMeta = {
  asset_no: string;
  asset_unit_number: string;
  vin: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
};

const DEALER_SEARCH_TERMS = [
  "AutoZone",
  "O'Reilly Auto Parts",
  "Advance Auto Parts",
  "NAPA Auto Parts",
  "Pep Boys",
  "Carquest",
  "FleetPride",
  "TruckPro",
  "auto parts",
  "car dealership",
];

const REPAIR_CARD_PILOT_TRUCKS = new Set(["1133", "1146", "1137", "1141"]);

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = asRecord(entry);
      if (record) return record;
    }
    return null;
  }

  return asRecord(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function findVin(rawVehicle: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    rawVehicle.vin,
    rawVehicle.VIN,
    rawVehicle.vehicleVin,
    rawVehicle.vehicle_vin,
    asRecord(rawVehicle.vehicle)?.vin,
    asRecord(rawVehicle.asset)?.vin,
    asRecord(rawVehicle.meta)?.vin,
  ];

  for (const candidate of candidates) {
    const normalized = toText(candidate).trim().toUpperCase();
    if (normalized.length >= 8) return normalized;
  }

  return null;
}

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  const record = asRecord(value);
  if (!record) return [];

  const candidateKeys = ["faults", "codes", "active", "items", "data", "dtcs", "faultCodes"];
  for (const key of candidateKeys) {
    const maybeList = record[key];
    if (Array.isArray(maybeList)) return maybeList;
  }

  return [value];
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeText(value: unknown): string | null {
  const text = toText(value).trim();
  return text.length > 0 ? text : null;
}

function estimateProjectedParts(partsRange: string, index: number): string {
  const parsed = parseUsdRange(partsRange);
  if (!parsed) return partsRange;

  const anchor = (parsed.low + parsed.high) / 2;
  const spreadFactor = [0.92, 1, 1.08][index % 3];
  const projection = Math.round(anchor * spreadFactor);
  return `$${projection.toLocaleString()} target`;
}

function buildTip(
  dealer: { name: string; brand?: string },
  index: number
): string {
  const label = (dealer.brand ?? dealer.name).trim();
  const tips = [
    `Call ${label} first and confirm VIN-specific stock before dispatching a tech.`,
    `Ask ${label} for same-day pickup window to reduce downtime.`,
    `Request core-return and warranty details from ${label} before purchase.`,
  ];
  return tips[index % tips.length];
}

function buildDealerViewBox(lat: number, lon: number): string {
  const latDelta = 1.1;
  const lonDelta = 1.5;
  const left = lon - lonDelta;
  const right = lon + lonDelta;
  const top = lat + latDelta;
  const bottom = lat - latDelta;
  return `${left},${top},${right},${bottom}`;
}

function normalizeNearbyDealerResult(
  result: NominatimDealerResult,
  index: number,
  lat: number,
  lon: number,
  partsRange: string
): NearbyDealer | null {
  const dealerLat = Number.parseFloat(result.lat ?? "");
  const dealerLon = Number.parseFloat(result.lon ?? "");
  if (!Number.isFinite(dealerLat) || !Number.isFinite(dealerLon)) return null;

  const address = result.address ?? {};
  const tags = result.extratags ?? {};
  const name = result.name?.trim() || result.namedetails?.brand?.trim() || result.display_name?.split(",")[0]?.trim() || "Auto parts dealer";
  const addressText =
    [address.house_number, address.road, address.city, address.state, address.postcode]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part && part.length > 0))
      .join(", ") || result.display_name || "Address unavailable";

  return {
    name,
    phone: normalizeText(tags.phone ?? tags["contact:phone"] ?? address.phone),
    distanceMiles: haversineMiles(lat, lon, dealerLat, dealerLon),
    projectedParts: estimateProjectedParts(partsRange, index),
    address: addressText,
    website: normalizeText(tags.website ?? tags["contact:website"]),
    tip: buildTip({ name, brand: result.namedetails?.brand ?? result.name ?? name }, index),
  };
}

function conciseFaultDescription(title: string): string {
  return title.includes(":") ? title.split(":").slice(1).join(":").trim() : title;
}

function summarizeManufacturerAssignedSpn(faults: FaultDetail[]): string {
  const withDescriptions = faults
    .map((fault) => `${fault.spn}${fault.spnDescription ? `: ${fault.spnDescription}` : ""}`.trim())
    .filter((value) => value.length > 0);

  if (withDescriptions.length === 0) return "SPN not available";
  return withDescriptions.slice(0, 3).join(" | ");
}

function formatDistanceMiles(value: number): string {
  if (!Number.isFinite(value)) return "Distance unavailable";
  if (value < 1) return `${value.toFixed(1)} mi`;
  if (value < 10) return `${value.toFixed(1)} mi`;
  return `${Math.round(value)} mi`;
}

function formatPhoneNumber(phone: string | null): string {
  const raw = (phone ?? "").trim();
  if (raw.length === 0) return "Not available";

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function summarizeFaultCodes(faults: FaultDetail[]): string[] {
  const unique = new Set<string>();
  for (const fault of faults) {
    const codeText = `${fault.code} (SPN ${fault.spn} / FMI ${fault.fmi})`;
    unique.add(codeText);
    if (unique.size >= 4) break;
  }
  return Array.from(unique);
}

function inferExpectedParts(cardTitle: string): string[] {
  const blob = cardTitle.toLowerCase();

  if (blob.includes("brake") || blob.includes("abs")) {
    return ["ABS wheel speed sensor", "Brake harness/pigtail", "Brake switch/relay (as needed)"];
  }
  if (blob.includes("coolant") || blob.includes("temperature") || blob.includes("overheat")) {
    return ["Coolant temp sensor", "Thermostat", "Coolant hose/clamps (inspection-based)"];
  }
  if (blob.includes("oil") || blob.includes("pressure")) {
    return ["Oil pressure sensor", "Oil filter and oil", "Sensor connector/pigtail"];
  }
  if (blob.includes("battery") || blob.includes("voltage") || blob.includes("alternator")) {
    return ["Alternator", "Battery terminals/cables", "Voltage regulator (if external)"];
  }
  if (blob.includes("def") || blob.includes("dpf") || blob.includes("scr") || blob.includes("nox")) {
    return ["NOx sensor", "DEF quality/level sensor", "Aftertreatment harness"];
  }

  return ["Likely sensor/connector", "Fuse or relay", "Vehicle-specific repair kit by VIN"];
}

function parseUsdRange(value: string): { low: number; high: number } | null {
  const match = value.match(/\$(\d[\d,]*)\s*-\s*\$(\d[\d,]*)/);
  if (!match) return null;

  const low = Number.parseInt(match[1].replace(/,/g, ""), 10);
  const high = Number.parseInt(match[2].replace(/,/g, ""), 10);

  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return null;
  return { low, high };
}

function formatUsdRange(low: number, high: number): string {
  return `$${Math.round(low).toLocaleString()} - $${Math.round(high).toLocaleString()}`;
}

function getPartWeight(part: string): number {
  const blob = part.toLowerCase();

  if (blob.includes("alternator")) return 0.5;
  if (blob.includes("nox sensor")) return 0.38;
  if (blob.includes("quality/level sensor")) return 0.28;
  if (blob.includes("sensor")) return 0.3;
  if (blob.includes("thermostat")) return 0.24;
  if (blob.includes("harness") || blob.includes("pigtail")) return 0.2;
  if (blob.includes("battery terminals") || blob.includes("cables")) return 0.16;
  if (blob.includes("hose") || blob.includes("clamps")) return 0.14;
  if (blob.includes("oil filter") || blob.includes("oil")) return 0.12;
  if (blob.includes("switch") || blob.includes("relay")) return 0.1;
  if (blob.includes("fuse")) return 0.08;
  if (blob.includes("kit")) return 0.4;
  return 0.2;
}

function buildPartEstimateLines(expectedParts: string[], partsRange: string): PartEstimateLine[] {
  const parsed = parseUsdRange(partsRange);
  if (!parsed || expectedParts.length === 0) return [];

  const weights = expectedParts.map((part) => getPartWeight(part));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return [];

  return expectedParts.map((part, index) => {
    const share = weights[index] / totalWeight;
    return {
      part,
      range: formatUsdRange(parsed.low * share, parsed.high * share),
    };
  });
}

function getCardLookupKey(vehicleKey: string, card: RepairAlertCard): string {
  return `${vehicleKey}|${card.title}|${card.source}`;
}

function getEstimateQualifier(confidence: "Low" | "Medium" | "High"): string {
  if (confidence === "High") return "Verified";
  return "Quote Needed";
}

function textToBullets(value: string): string[] {
  const normalized = value
    .split(/\r?\n|•|\u2022|;/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (normalized.length > 0) return normalized;
  return [value.trim()].filter((segment) => segment.length > 0);
}

function buildDealerTip(index: number): string {
  const tips = [
    "Ask for fleet, pro, or commercial pricing before you mention urgency.",
    "Request online price match and ask whether the part has a core charge.",
    "Confirm same-day availability and have the VIN or part number ready.",
    "Ask for tax-exempt or account pricing if your company qualifies.",
    "If the price is close, ask about pickup timing and return policy.",
  ];
  return tips[Math.min(index, tips.length - 1)];
}


function extractVehicleProfile(rawVehicle: Record<string, unknown>, vehicleLabel: string): string {
  const vehicle = asRecord(rawVehicle.vehicle);
  const stats = asRecord(rawVehicle.stats);

  const year = toText(vehicle?.year ?? rawVehicle.year ?? stats?.year).trim();
  const make = toText(vehicle?.make ?? rawVehicle.make ?? stats?.make).trim();
  const model = toText(vehicle?.model ?? rawVehicle.model ?? stats?.model).trim();

  const profile = [year, make, model].filter((part) => part.length > 0).join(" ").trim();
  return profile.length > 0 ? profile : vehicleLabel;
}

function buildAssetVehicleProfile(asset: AssetVehicleMeta | null, fallbackProfile: string): string {
  if (!asset) return fallbackProfile;

  const profile = [asset.year ?? "", asset.make ?? "", asset.model ?? ""]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .trim();

  return profile.length > 0 ? profile : fallbackProfile;
}

function getNumericStat(value: unknown, depth = 0): number | null {
  if (depth > 4 || value === null || value === undefined) return null;

  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = getNumericStat(item, depth + 1);
      if (candidate !== null) return candidate;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const preferredKeys = ["value", "current", "percent", "kPa", "milliC", "seconds", "latitude", "longitude"];
  for (const key of preferredKeys) {
    if (key in record) {
      const candidate = getNumericStat(record[key], depth + 1);
      if (candidate !== null) return candidate;
    }
  }

  for (const candidateValue of Object.values(record)) {
    const candidate = getNumericStat(candidateValue, depth + 1);
    if (candidate !== null) return candidate;
  }

  return null;
}

function getTextStat(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = getTextStat(item, depth + 1);
      if (text !== "-") return text;
    }
    return "-";
  }

  const record = asRecord(value);
  if (!record) return "-";

  const preferredKeys = ["state", "status", "name", "label", "value"];
  for (const key of preferredKeys) {
    if (key in record) {
      const text = getTextStat(record[key], depth + 1);
      if (text !== "-") return text;
    }
  }

  return "-";
}

function formatDecimal(value: number | null, precision = 1): string {
  if (value === null) return "-";
  return value.toFixed(precision);
}

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function hasTrueFlag(value: unknown, keys: string[], depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) return false;

  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  if (Array.isArray(value)) {
    return value.some((item) => hasTrueFlag(item, keys, depth + 1));
  }

  const record = asRecord(value);
  if (!record) return false;

  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (keySet.has(recordKey.toLowerCase()) && toBoolean(recordValue)) {
      return true;
    }
  }

  return Object.values(record).some((nestedValue) => hasTrueFlag(nestedValue, keys, depth + 1));
}

function deriveAlertLevel(row: Record<string, unknown>): AlertLevel | null {
  if (hasTrueFlag(row, ["stopEngineLightIsOn", "stopIsOn"])) {
    return {
      rank: 3,
      label: "RED ALERT",
      action: "Pull Over / Stop Truck immediately.",
      className: "border-rose-400/40 bg-rose-500/10 text-rose-200",
    };
  }

  if (hasTrueFlag(row, ["warningLightIsOn", "warningIsOn"])) {
    return {
      rank: 2,
      label: "ORANGE ALERT",
      action: "Needs Shop Attention. Book a repair block at end of shift.",
      className: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    };
  }

  if (hasTrueFlag(row, ["checkEngineLightIsOn", "checkIsOn", "emissionsIsOn", "malfunctionIndicatorLampIsOn"])) {
    return {
      rank: 1,
      label: "YELLOW ALERT",
      action: "Non-Urgent Diagnostic Required.",
      className: "border-yellow-400/40 bg-yellow-500/10 text-yellow-200",
    };
  }

  return null;
}

function findFirstValueByKeys(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return undefined;

  const keySet = new Set(keys.map((key) => key.toLowerCase()));

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstValueByKeys(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  for (const [recordKey, recordValue] of Object.entries(record)) {
    if (keySet.has(recordKey.toLowerCase()) && recordValue !== null && recordValue !== undefined) {
      return recordValue;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const found = findFirstValueByKeys(nestedValue, keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function expandFaultCodeEntries(faultCodes: unknown): unknown[] {
  const root = asRecord(faultCodes);
  if (!root) return toList(faultCodes);

  const j1939 = asRecord(root.j1939);
  const dtcs = asArray(j1939?.diagnosticTroubleCodes);
  const checkEngineLights = asRecord(j1939?.checkEngineLights);
  const canBusType = root.canBusType ?? j1939?.canBusType;
  const faultTime = root.time ?? j1939?.time;

  if (dtcs.length > 0) {
    return dtcs.map((entry) => {
      const row = asRecord(entry);
      if (!row) return entry;

      return {
        ...row,
        checkEngineLights,
        canBusType,
        faultTime,
      };
    });
  }

  return [
    {
      ...root,
      checkEngineLights,
      canBusType,
      faultTime,
    },
  ];
}

function summarizeJ1939Status(value: unknown): string {
  const numeric = getNumericStat(value);
  if (numeric !== null) return `${numeric}`;

  const text = getTextStat(value);
  if (text !== "-") return text;

  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length} record${value.length === 1 ? "" : "s"}` : "-";
  }

  const record = asRecord(value);
  if (record) {
    const count = getNumericStat(record.activeDtcCount ?? record.activeCount ?? record.count);
    if (count !== null) return `${count} active`;
  }

  return "-";
}

function normalizeFaultDetail(value: unknown): FaultDetail {
  const row = asRecord(value) ?? {};
  const alert = deriveAlertLevel(row);

  const code =
    toText(findFirstValueByKeys(row, ["code", "dtc", "diagnosticTroubleCode", "sid", "cid", "pid"])) ||
    "-";

  const spn =
    toText(findFirstValueByKeys(row, ["spn", "suspectParameterNumber", "spnId", "suspect_parameter_number"])) ||
    "-";

  const fmi =
    toText(findFirstValueByKeys(row, ["fmi", "failureModeIdentifier", "failure_mode_identifier", "fmiId"])) ||
    "-";

  const spnDescription =
    toText(findFirstValueByKeys(row, ["spnDescription", "suspectParameterDescription", "spn_description"])) ||
    "-";

  const fmiDescription =
    toText(findFirstValueByKeys(row, ["fmiDescription", "failureModeDescription", "fmi_description"])) ||
    "-";

  const severity = alert
    ? `${alert.label}: ${alert.action}`
    : toText(findFirstValueByKeys(row, ["severity", "level", "priority", "status", "criticality"])) || "-";

  const description =
    toText(findFirstValueByKeys(row, ["description", "label", "message", "name", "faultDescription"])) ||
    "No description";

  const protocol =
    toText(findFirstValueByKeys(row, ["protocol", "sourceProtocol", "standard", "network", "bus", "canBusType", "j1939"])) ||
    "-";

  const timestamp =
    toText(findFirstValueByKeys(row, ["detectedAtTime", "startTime", "time", "timestamp", "endTime", "occurredAt", "faultTime"])) ||
    "-";

  return {
    code,
    spn,
    fmi,
    spnDescription,
    fmiDescription,
    severity,
    alertRank: alert?.rank ?? 0,
    description,
    protocol,
    timestamp,
    raw: value,
  };
}

function formatTime(value: string, display?: DateTimeDisplay): string {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(display?.locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: display?.timeZone,
    }).format(date);
  } catch {
    return date.toLocaleString(display?.locale);
  }
}

function pickLatestTimestamp(currentValue: string, nextValue: string): string {
  if (!nextValue || nextValue === "-") return currentValue;
  if (!currentValue || currentValue === "-") return nextValue;

  const currentDate = new Date(currentValue);
  const nextDate = new Date(nextValue);
  if (Number.isNaN(currentDate.getTime())) return nextValue;
  if (Number.isNaN(nextDate.getTime())) return currentValue;
  return nextDate.getTime() > currentDate.getTime() ? nextValue : currentValue;
}

function getDisplayName(username: string): string {
  return username || "User";
}

function getTopAlertLevel(faults: FaultDetail[], engineState: string): AlertLevel | null {
  const normalizedState = engineState.trim().toLowerCase();
  const isStoppedState = ["idle", "off", "parked"].includes(normalizedState);
  const enginePowerText = engineState === "-" ? "Engine state unknown." : isStoppedState ? "Engine is OFF." : "Engine is ON.";

  const hasRed = faults.some((fault) => fault.alertRank === 3);
  if (hasRed) {
    return {
      rank: 3,
      label: "RED ALERT",
      action: isStoppedState
        ? `${enginePowerText} Keep truck out of service and call shop dispatch now.`
        : `${enginePowerText} Pull over safely and stop truck immediately.`,
      className: "border-rose-400/40 bg-rose-500/10 text-rose-200",
    };
  }

  const hasOrange = faults.some((fault) => fault.alertRank === 2);
  if (hasOrange) {
    return {
      rank: 2,
      label: "ORANGE ALERT",
      action: isStoppedState
        ? `${enginePowerText} Send this unit for shop attention before next dispatch.`
        : `${enginePowerText} Needs shop attention; book repair at end of shift.`,
      className: "border-amber-400/40 bg-amber-500/10 text-amber-200",
    };
  }

  const hasYellow = faults.some((fault) => fault.alertRank === 1);
  if (hasYellow) {
    return {
      rank: 1,
      label: "YELLOW ALERT",
      action: `${enginePowerText} Non-urgent diagnostic required at next maintenance window.`,
      className: "border-yellow-400/40 bg-yellow-500/10 text-yellow-200",
    };
  }

  return null;
}

function getStatusClass(status: HealthStatus): string {
  if (status === "critical") return "border-rose-400/45 bg-rose-500/10 text-rose-100";
  if (status === "warning") return "border-amber-400/45 bg-amber-500/10 text-amber-100";
  return "border-emerald-400/45 bg-emerald-500/10 text-emerald-100";
}

function getHeatWidth(status: HealthStatus): string {
  if (status === "critical") return "100%";
  if (status === "warning") return "60%";
  return "25%";
}

function classifyComponentHealth(label: string, faults: FaultDetail[], keywords: string[]): ComponentHealth {
  const matches = faults.filter((fault) => {
    const blob = `${fault.code} ${fault.description} ${fault.protocol} ${fault.severity}`.toLowerCase();
    return keywords.some((keyword) => blob.includes(keyword));
  });

  const highestRank = matches.reduce((max, fault) => Math.max(max, fault.alertRank), 0);
  const status: HealthStatus = highestRank >= 3 ? "critical" : highestRank >= 1 ? "warning" : "good";

  if (matches.length === 0) {
    return {
      label,
      status,
      summary: `No active ${label.toLowerCase()}-related fault signals detected.`,
      issues: [],
    };
  }

  if (status === "critical") {
    return {
      label,
      status,
      summary: `${matches.length} critical ${label.toLowerCase()} issue${matches.length === 1 ? "" : "s"} require immediate attention.`,
      issues: matches,
    };
  }

  return {
    label,
    status,
    summary: `${matches.length} ${label.toLowerCase()} issue${matches.length === 1 ? "" : "s"} detected. Schedule service soon.`,
    issues: matches,
  };
}

function normalizeFaultBlob(fault: FaultDetail): string {
  return `${fault.code} ${fault.spn} ${fault.fmi} ${fault.spnDescription} ${fault.fmiDescription} ${fault.description} ${fault.protocol} ${fault.severity}`.toLowerCase();
}

type FaultSituation = {
  key: string;
  profileLabel: string;
  spnDescription: string;
  highestRank: number;
  count: number;
  latestTimestamp: string;
  blob: string;
  variantMap: Map<string, { spn: string; fmi: string; fmiDescription: string; count: number }>;
};

type SituationProfile = {
  label: string;
  weight: number;
  mechanicAction: string;
  managerAction: string;
  laborHours: string;
  partsRange: string;
};

function getSituationProfile(blob: string): SituationProfile {
  if (
    blob.includes("tire") ||
    blob.includes("tyre") ||
    blob.includes("tpms") ||
    blob.includes("wheel-end") ||
    blob.includes("wheel end") ||
    blob.includes("wheel speed")
  ) {
    return {
      label: "Tire / Wheel-End",
      weight: 95,
      mechanicAction: "Verify tire pressure with a calibrated gauge, inspect TPMS or wheel-end sensors, and confirm harness/connectors at the wheel ends.",
      managerAction: "Wheel-end fault can impact safety and availability. Route this truck for prompt inspection before long-haul dispatch.",
      laborHours: "1.0 - 3.0 hrs (~$180 - $630 labor)",
      partsRange: "$120 - $900",
    };
  }

  if (blob.includes("brake") || blob.includes("abs") || blob.includes("retarder") || blob.includes("wheel speed")) {
    return {
      label: "Brake / ABS",
      weight: 90,
      mechanicAction: "Start at the wheel ends: check sensor gap, tone ring condition, and harness rub-through. Confirm fix with an ABS-enabled road test.",
      managerAction: "Safety-impacting brake warning. Prioritize this unit for shop clearance before normal dispatch.",
      laborHours: "1.5 - 4.0 hrs (~$275 - $840 labor)",
      partsRange: "$350 - $1,450",
    };
  }

  if (blob.includes("oil") || blob.includes("pressure") || blob.includes("lubrication") || blob.includes("coolant") || blob.includes("overheat")) {
    return {
      label: "Engine Protection",
      weight: 85,
      mechanicAction: "Verify the reading is real first (mechanical gauge or known-good value), then inspect sensor, connector pins, and harness before deeper tear-down.",
      managerAction: "Possible engine-damage exposure if delayed. Move this truck into same-shift diagnostics before heavy duty assignments.",
      laborHours: "2.0 - 8.0 hrs (~$360 - $1,680 labor)",
      partsRange: "$300 - $1,800",
    };
  }

  if (blob.includes("def") || blob.includes("aftertreatment") || blob.includes("dpf") || blob.includes("scr") || blob.includes("nox") || blob.includes("emission")) {
    return {
      label: "Aftertreatment / Emissions",
      weight: 70,
      mechanicAction: "Check DEF quality/contamination, inspect doser and lines, then run OEM aftertreatment tests to confirm regen and sensor response.",
      managerAction: "Emissions faults can reduce road speed and uptime. Schedule correction this week to avoid avoidable derate events.",
      laborHours: "2.0 - 8.0 hrs (~$360 - $1,680 labor)",
      partsRange: "$900 - $4,500",
    };
  }

  if (blob.includes("voltage") || blob.includes("battery") || blob.includes("alternator") || blob.includes("current") || blob.includes("power")) {
    return {
      label: "Electrical / Charging",
      weight: 60,
      mechanicAction: "Load-test batteries, verify alternator output under load, and clean/check grounds before replacing components.",
      managerAction: "Starting and telemetry reliability are at risk. Repair in this maintenance window to reduce service-call probability.",
      laborHours: "1.5 - 4.0 hrs (~$275 - $840 labor)",
      partsRange: "$250 - $1,250",
    };
  }

  return {
    label: "Powertrain Diagnostic",
    weight: 40,
    mechanicAction: "Follow the OEM DTC tree step-by-step, document pass/fail values, and verify the repair with a full post-repair scan.",
    managerAction: "General drivability fault. Keep the planned shop slot and escalate if alerts continue across shifts.",
    laborHours: "2.0 - 6.0 hrs (~$360 - $1,260 labor)",
    partsRange: "$400 - $2,200",
  };
}

function toFaultSituations(faults: FaultDetail[]): FaultSituation[] {
  const map = new Map<string, FaultSituation>();

  for (const fault of faults) {
    const profile = getSituationProfile(normalizeFaultBlob(fault));
    const issueAnchor = (fault.spnDescription !== "-" ? fault.spnDescription : fault.description).trim().toLowerCase();
    const keyBase = `${profile.label}|${issueAnchor}`;
    const key = keyBase.toLowerCase();
    const existing = map.get(key);
    const blob = normalizeFaultBlob(fault);
    const variantKey = `${fault.spn}|${fault.fmi}`.toLowerCase();

    if (!existing) {
      const variantMap = new Map<string, { spn: string; fmi: string; fmiDescription: string; count: number }>();
      variantMap.set(variantKey, {
        spn: fault.spn,
        fmi: fault.fmi,
        fmiDescription: fault.fmiDescription,
        count: 1,
      });

      map.set(key, {
        key,
        profileLabel: profile.label,
        spnDescription: fault.spnDescription,
        highestRank: fault.alertRank,
        count: 1,
        latestTimestamp: fault.timestamp,
        blob,
        variantMap,
      });
      continue;
    }

    existing.count += 1;
    existing.highestRank = Math.max(existing.highestRank, fault.alertRank);
    existing.latestTimestamp = pickLatestTimestamp(existing.latestTimestamp, fault.timestamp);
    if (existing.spnDescription === "-" && fault.spnDescription !== "-") existing.spnDescription = fault.spnDescription;
    existing.blob = `${existing.blob} ${blob}`;

    const variant = existing.variantMap.get(variantKey);
    if (!variant) {
      existing.variantMap.set(variantKey, {
        spn: fault.spn,
        fmi: fault.fmi,
        fmiDescription: fault.fmiDescription,
        count: 1,
      });
    } else {
      variant.count += 1;
      if (variant.fmiDescription === "-" && fault.fmiDescription !== "-") {
        variant.fmiDescription = fault.fmiDescription;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const aProfile = getSituationProfile(a.blob);
    const bProfile = getSituationProfile(b.blob);
    const aScore = a.highestRank * 100 + aProfile.weight + Math.min(a.count, 10);
    const bScore = b.highestRank * 100 + bProfile.weight + Math.min(b.count, 10);
    return bScore - aScore;
  });
}

function buildSourceSummary(situation: FaultSituation): string {
  const variants = Array.from(situation.variantMap.values()).sort((a, b) => b.count - a.count);
  if (variants.length === 0) return "SPN/FMI unavailable";

  const spnSet = new Set(variants.map((v) => v.spn));
  if (spnSet.size === 1) {
    const spn = variants[0]?.spn ?? "-";
    const fmis = Array.from(new Set(variants.map((v) => v.fmi))).filter((fmi) => fmi !== "-");
    if (fmis.length > 0) {
      return `SPN ${spn} / FMI ${fmis.join(", ")}`;
    }
    return `SPN ${spn}`;
  }

  const top = variants.slice(0, 3).map((v) => `SPN ${v.spn}/FMI ${v.fmi}`);
  const more = variants.length > 3 ? ` +${variants.length - 3} more` : "";
  return `${top.join(" | ")}${more}`;
}

function buildMechanicSpeak(situation: FaultSituation, baseAction: string): string {
  const variants = Array.from(situation.variantMap.values()).sort((a, b) => b.count - a.count);
  const topFmi = variants[0]?.fmiDescription && variants[0].fmiDescription !== "-" ? variants[0].fmiDescription : "mixed failure modes";
  const issue = situation.spnDescription !== "-" ? situation.spnDescription : "Powertrain signal";
  return `Detected issue: ${issue}. Likely failure pattern: ${topFmi.toLowerCase()}. ${baseAction}`;
}

function getEstimateConfidence(situation: FaultSituation): "Low" | "Medium" {
  const variants = Array.from(situation.variantMap.values());
  const hasSpecificSpn = variants.some((v) => v.spn !== "-");
  const hasSpecificFmi = variants.some((v) => v.fmi !== "-");
  const lowVariance = variants.length <= 2;
  const recurring = situation.count >= 2;

  if (hasSpecificSpn && hasSpecificFmi && lowVariance && recurring) {
    return "Medium";
  }

  return "Low";
}

function buildEstimateBasis(confidence: "Low" | "Medium"): string {
  if (confidence === "Medium") {
    return "Based on repeat fault patterns and current planning bands. Final quote still needs vendor and shop confirmation.";
  }

  return "Based on US-average planning bands only. Vendor quotes and local shop rates still need to be locked.";
}

function estimateRepairCard(situation: FaultSituation): RepairAlertCard {
  const profile = getSituationProfile(situation.blob);
  const urgency: RepairAlertCard["urgency"] = situation.highestRank >= 3 ? "Immediate" : situation.highestRank >= 2 ? "High" : "Planned";
  const estimateConfidence = getEstimateConfidence(situation);

  const issueText = situation.spnDescription !== "-" ? situation.spnDescription : profile.label;
  const issueTitle = situation.count > 1 ? `${issueText} (Grouped)` : issueText;

  return {
    title: issueTitle,
    timestamp: situation.latestTimestamp,
    mechanicSpeak: buildMechanicSpeak(situation, profile.mechanicAction),
    managerSpeak: `${profile.managerAction} ${situation.count > 1 ? `Observed ${situation.count} related events across recent reads.` : "One active event is currently present."}`,
    laborHours: profile.laborHours,
    partsRange: profile.partsRange,
    estimateConfidence,
    estimateBasis: buildEstimateBasis(estimateConfidence),
    urgency,
    source: buildSourceSummary(situation),
    occurrenceCount: situation.count,
  };
}

function buildRepairAlertCards(
  faults: FaultDetail[],
  options: { maxCards?: number } = {}
): RepairAlertCard[] {
  if (faults.length === 0) return [];

  const maxCards = options.maxCards ?? 2;
  const situations = toFaultSituations(faults);
  return situations.slice(0, maxCards).map((situation) => estimateRepairCard(situation));
}

function isPilotTruck(vehicleLabel: string, vehicleKey: string): boolean {
  const normalizedLabel = vehicleLabel.trim().toLowerCase();
  const normalizedKey = vehicleKey.trim().toLowerCase();

  return Array.from(REPAIR_CARD_PILOT_TRUCKS).some((truckId) => {
    const target = truckId.toLowerCase();
    return normalizedLabel === target || normalizedLabel.endsWith(` ${target}`) || normalizedKey === target;
  });
}

export default function MaintenanceFaultCodesPage() {
  const router = useRouter();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const demoMode =
    process.env.NEXT_PUBLIC_FORCE_DEMO_FLEET === "true" ||
    !supabaseUrl ||
    !supabaseAnon ||
    supabaseAnon.startsWith("your_");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(!demoMode);
  const [demoRole] = useState<AppRole>(() => {
    if (typeof window === "undefined") return "management";

    const urlRole = new URLSearchParams(window.location.search).get("demoRole");
    const sessionRole = window.sessionStorage.getItem("demoRole");
    const candidate = urlRole ?? sessionRole;

    return APP_ROLES.includes(candidate as AppRole) ? (candidate as AppRole) : "management";
  });
  const [demoUsername] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("demoUsername") ?? "";
  });

  const effectiveRole = demoMode ? demoRole : profile?.role;
  const effectiveName = demoMode ? getDisplayName(demoUsername) : profile?.full_name ?? "ASF User";
  const effectiveUsername = (demoMode ? demoUsername : profile?.username ?? "").trim().toLowerCase();
  const canUsePushTestControls = effectiveUsername === "hkmaintenance" || effectiveUsername === "skmaintenance";
  const canUseWebhookControls = effectiveUsername === "hkmaintenance";
  const canEnrollPushOnDevice = Boolean(effectiveUsername) && effectiveRole === "maintenance";

  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<FaultCodesResponse | null>(null);
  const [healthModalVehicle, setHealthModalVehicle] = useState<VehicleFaultView | null>(null);
  const [liveEstimateByCardKey, setLiveEstimateByCardKey] = useState<Record<string, LiveEstimateOverride>>({});
  const [expandedVehicleKey, setExpandedVehicleKey] = useState<string | null>(null);
  const vehicleCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [assetVehicleMeta, setAssetVehicleMeta] = useState<Record<string, AssetVehicleMeta>>({});
  const [dealerModal, setDealerModal] = useState<{
    vehicle: VehicleFaultView;
    cardTitle: string;
    partsRange: string;
    confidence: string;
    vin: string;
    vehicleProfile: string;
    manufacturerAssignedSpn: string;
    faultDescription: string;
    faultCodes: string[];
    expectedParts: string[];
  } | null>(null);
  const [dealerLoading, setDealerLoading] = useState(false);
  const [nearbyDealers, setNearbyDealers] = useState<NearbyDealer[]>([]);
  const [dealerError, setDealerError] = useState<string | null>(null);
  const [webhookMonitor, setWebhookMonitor] = useState<WebhookMonitorResponse | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [pushEnableLoading, setPushEnableLoading] = useState(false);
  const [pushSendLoading, setPushSendLoading] = useState(false);
  const [pushSelfTestLoading, setPushSelfTestLoading] = useState(false);
  const [pushWorkflowLoading, setPushWorkflowLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [webhookSettingsLoading, setWebhookSettingsLoading] = useState(false);
  const [webhookSettingsSaving, setWebhookSettingsSaving] = useState(false);
  const [webhookSettingsError, setWebhookSettingsError] = useState<string | null>(null);
  const [webhookSettingsMessage, setWebhookSettingsMessage] = useState<string | null>(null);
  const [webhookSettingsOrgs, setWebhookSettingsOrgs] = useState<WebhookSettingsOrganization[]>([]);
  const [selectedWebhookOrgId, setSelectedWebhookOrgId] = useState<string>("");
  const [webhookUrlInput, setWebhookUrlInput] = useState<string>("");
  const [webhookSecretInput, setWebhookSecretInput] = useState<string>("");
  const [simulateSamsaraLoading, setSimulateSamsaraLoading] = useState(false);
  const [pushAuditLoading, setPushAuditLoading] = useState(false);
  const [pushAuditError, setPushAuditError] = useState<string | null>(null);
  const [pushAuditRows, setPushAuditRows] = useState<PushActionAuditEntry[]>([]);
  const [dateTimeDisplay, setDateTimeDisplay] = useState<DateTimeDisplay | null>(null);
  const [activeRepairCardByVehicle, setActiveRepairCardByVehicle] = useState<Record<string, number>>({});
  const [repairCardContentHeights, setRepairCardContentHeights] = useState<Record<string, number>>({});
  const repairDeckTouchStartY = useRef<Record<string, number | null>>({});
  const repairDeckWheelLockUntil = useRef<Record<string, number>>({});
  const sortedVehicleKeysRef = useRef<string[]>([]);
  const repairCardCountByVehicleRef = useRef<Record<string, number>>({});
  const pushLoading = pushEnableLoading || pushSendLoading || pushSelfTestLoading || pushWorkflowLoading;

  const setFocusedRepairCard = useCallback((vehicleKey: string, nextIndex: number, cardCount: number) => {
    const maxIndex = Math.max(0, cardCount - 1);
    const clampedIndex = Math.max(0, Math.min(nextIndex, maxIndex));

    setActiveRepairCardByVehicle((prev) => {
      if (prev[vehicleKey] === clampedIndex) return prev;
      return { ...prev, [vehicleKey]: clampedIndex };
    });
  }, []);

  const shiftFocusedRepairCard = useCallback(
    (vehicleKey: string, direction: 1 | -1, cardCount: number) => {
      const currentIndex = activeRepairCardByVehicle[vehicleKey] ?? 0;
      const orderedVehicleKeys = sortedVehicleKeysRef.current;
      const currentVehicleOrderIndex = orderedVehicleKeys.indexOf(vehicleKey);

      if (direction === -1 && currentIndex <= 0) {
        setFocusedRepairCard(vehicleKey, 0, cardCount);

        if (currentVehicleOrderIndex < 0) {
          setExpandedVehicleKey(null);
          return;
        }

        const previousVehicleKey = orderedVehicleKeys[currentVehicleOrderIndex - 1] ?? null;

        // Collapse current stack and hand off focus to the immediate previous header.
        setExpandedVehicleKey(null);
        if (previousVehicleKey) {
          const previousCardCount = repairCardCountByVehicleRef.current[previousVehicleKey] ?? 0;
          setFocusedRepairCard(previousVehicleKey, 0, previousCardCount);
        }
        return;
      }

      if (direction === 1) {
        const maxIndex = Math.max(0, cardCount - 1);

        if (currentIndex >= maxIndex) {
          setFocusedRepairCard(vehicleKey, 0, cardCount);

          if (currentVehicleOrderIndex < 0) {
            setExpandedVehicleKey(null);
            return;
          }

          const nextVehicleKey = orderedVehicleKeys[currentVehicleOrderIndex + 1] ?? null;

          // Collapse current stack and move viewport focus to the next group header only.
          setExpandedVehicleKey(null);
          if (nextVehicleKey) {
            const nextCardCount = repairCardCountByVehicleRef.current[nextVehicleKey] ?? 0;
            setFocusedRepairCard(nextVehicleKey, 0, nextCardCount);
          }
          return;
        }
      }

      setFocusedRepairCard(vehicleKey, currentIndex + direction, cardCount);
    },
    [activeRepairCardByVehicle, setFocusedRepairCard]
  );

  const onRepairDeckTouchStart = useCallback((vehicleKey: string, clientY: number) => {
    repairDeckTouchStartY.current[vehicleKey] = clientY;
  }, []);

  const onRepairDeckTouchEnd = useCallback(
    (vehicleKey: string, clientY: number, cardCount: number) => {
      const startY = repairDeckTouchStartY.current[vehicleKey];
      repairDeckTouchStartY.current[vehicleKey] = null;
      if (startY === null || startY === undefined) return;

      const deltaY = clientY - startY;
      if (Math.abs(deltaY) < 40) return;

      shiftFocusedRepairCard(vehicleKey, deltaY > 0 ? -1 : 1, cardCount);
    },
    [shiftFocusedRepairCard]
  );

  const onRepairDeckWheel = useCallback(
    (vehicleKey: string, deltaY: number, cardCount: number) => {
      if (Math.abs(deltaY) < 10) return;

      const now = Date.now();
      const lockUntil = repairDeckWheelLockUntil.current[vehicleKey] ?? 0;
      if (now < lockUntil) return;

      repairDeckWheelLockUntil.current[vehicleKey] = now + 360;
      shiftFocusedRepairCard(vehicleKey, deltaY > 0 ? 1 : -1, cardCount);
    },
    [shiftFocusedRepairCard]
  );

  useEffect(() => {
    setDateTimeDisplay({
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, []);

  useEffect(() => {
    if (demoMode) {
      setLoadingProfile(false);
      return;
    }

    async function init() {
      const supabase = getSupabaseBrowserClient();

      const cookieUsername =
        typeof window !== "undefined"
          ? (document.cookie
              .split(";")
              .map((part) => part.trim())
              .find((part) => part.startsWith("asf_login="))
              ?.split("=")[1] ?? "")
          : "";
      const username =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("demoUsername") ?? decodeURIComponent(cookieUsername)
          : null;

      if (username) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("demoUsername", username);
        }

        const { data: userRow } = await supabase
          .from("Users")
          .select("id, full_name, tenant_id, UserName, UserType")
          .eq("UserName", username)
          .maybeSingle();

        if (userRow) {
          const userProfile: UserProfile = {
            id: userRow.id,
            full_name: userRow.full_name || username,
            role: userRow.UserType as AppRole,
            tenant_id: userRow.tenant_id,
            username: userRow.UserName || username,
          };
          setProfile(userProfile);
          setLoadingProfile(false);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, tenant_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!data || error) {
        const fullName = (session.user.user_metadata.full_name as string | undefined) ?? "ASF User";
        const upsertRole: AppRole = "management";

        const { data: inserted } = await supabase
          .from("profiles")
          .upsert({
            id: session.user.id,
            full_name: fullName,
            role: upsertRole,
          })
          .select("id, full_name, role, tenant_id")
          .single();

        if (inserted) {
          setProfile(inserted as UserProfile);
        }
      } else {
        setProfile(data as UserProfile);
      }

      setLoadingProfile(false);
    }

    void init();
  }, [demoMode, router]);

  useEffect(() => {
    if (loadingProfile) return;

    if (effectiveRole !== "maintenance") {
      router.replace("/fleet");
    }
  }, [effectiveRole, loadingProfile, router]);

  async function loadFaultCodes(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoadingData(true);
    }

    setErrorMessage(null);

    try {
      const response = await fetch(FLEET_API_ROUTES.faultCodes, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as FaultCodesResponse;

      if (!response.ok) {
        setPayload(null);
        setErrorMessage(data.error ?? "Unable to load fault codes");
        return;
      }

      setPayload(data);
    } catch (error) {
      setPayload(null);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load fault codes");
    } finally {
      setLoadingData(false);
      setRefreshing(false);
    }
  }

  async function preparePushTestData(): Promise<string[]> {
    const notes: string[] = [];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    try {
      const resetResponse = await fetch("/api/maintenance/reset-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hard: false }),
      });

      const resetData = (await resetResponse.json().catch(() => ({}))) as ResetTestDataResponse;
      if (resetResponse.ok && !resetData.error) {
        notes.push(
          `Tenant cleanup: Alerts ${resetData.deletedAlerts ?? 0}, Logs ${resetData.deletedIngestionLogs ?? 0}.`
        );
      } else {
        notes.push(`Tenant cleanup skipped: ${resetData.error ?? "Unauthorized or unavailable"}.`);
      }
    } catch (error) {
      notes.push(`Tenant cleanup skipped: ${error instanceof Error ? error.message : "unexpected error"}.`);
    }

    try {
      const backfillResponse = await fetch("/api/maintenance/backfill-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today, dryRun: false }),
      });

      const backfillData = (await backfillResponse.json().catch(() => ({}))) as BackfillAlertsResponse;
      if (backfillResponse.ok && !backfillData.error) {
        notes.push(
          `Backfill rows: Candidates ${backfillData.candidateAlerts ?? 0}, Inserted ${backfillData.inserted ?? 0}, Dup ${backfillData.duplicates ?? 0}.`
        );
      } else {
        notes.push(`Backfill skipped: ${backfillData.error ?? "Unauthorized or unavailable"}.`);
      }
    } catch (error) {
      notes.push(`Backfill skipped: ${error instanceof Error ? error.message : "unexpected error"}.`);
    }

    return notes;
  }

  async function logPushAction(
    action: string,
    status: "success" | "failed" | "info",
    options?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    try {
      await fetch("/api/maintenance/push-action-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, status, options: options ?? {}, errorMessage }),
      });
    } catch {
      // Do not block onboarding flow for telemetry failures.
    }
  }

  async function enablePushAlerts(options?: { preserveStatus?: boolean }): Promise<boolean> {
    const preserveStatus = options?.preserveStatus === true;
    setPushEnableLoading(true);
    if (!preserveStatus) {
      setPushMessage(null);
      setPushError(null);
    }

    try {
      console.log("[Push] Starting push registration...");
      await logPushAction("onboarding_enable_clicked", "info", {
        preserveStatus,
      });

      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        console.error("[Push] Browser missing required APIs");
        await logPushAction("onboarding_unsupported_browser", "failed", {
          serviceWorker: "serviceWorker" in navigator,
          pushManager: "PushManager" in window,
          notification: "Notification" in window,
        }, "This browser does not support push notifications.");
        setPushError("This browser does not support push notifications.");
        return false;
      }

      console.log("[Push] Browser APIs available");

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error("[Push] VAPID key missing");
        await logPushAction("onboarding_missing_vapid_key", "failed", {}, "NEXT_PUBLIC_VAPID_PUBLIC_KEY missing.");
        setPushError("Push key missing. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel.");
        return false;
      }

      console.log("[Push] VAPID key present");

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("[Push] Service Worker registered:", registration.scope);

      const permission = await Notification.requestPermission();
      console.log("[Push] Notification permission:", permission);
      await logPushAction("onboarding_permission_result", permission === "granted" ? "success" : "failed", {
        permission,
      }, permission === "granted" ? undefined : "Notification permission denied.");

      if (permission !== "granted") {
        setPushError("Notification permission denied.");
        return false;
      }

      let subscription = await registration.pushManager.getSubscription();
      console.log("[Push] Existing subscription:", subscription ? "found" : "not found");

      if (!subscription) {
        console.log("[Push] Creating new subscription...");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
        });
        console.log("[Push] New subscription created, endpoint:", subscription.endpoint.substring(0, 50));
      }

      console.log("[Push] Sending subscription to server...");
      const response = await fetch("/api/maintenance/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      console.log("[Push] Server response:", response.status, data);

      if (!response.ok || !data.ok) {
        await logPushAction("onboarding_register_device_failed", "failed", {
          responseStatus: response.status,
        }, data.error ?? "Unable to register this device for push alerts.");
        setPushError(data.error ?? "Unable to register this device for push alerts.");
        return false;
      }

      console.log("[Push] Registration successful!");
      await logPushAction("onboarding_register_device_success", "success", {
        hasExistingSubscription: Boolean(subscription),
      });
      setPushMessage("Push alerts enabled for this device.");
      return true;
    } catch (error) {
      console.error("[Push] Error:", error);
      await logPushAction(
        "onboarding_enable_exception",
        "failed",
        {},
        error instanceof Error ? error.message : "Unable to enable push alerts."
      );
      setPushError(error instanceof Error ? error.message : "Unable to enable push alerts.");
      return false;
    } finally {
      setPushEnableLoading(false);
    }
  }

  async function sendTestPush(options?: { preserveStatus?: boolean }): Promise<TestPushResponse | null> {
    const preserveStatus = options?.preserveStatus === true;
    setPushSendLoading(true);
    if (!preserveStatus) {
      setPushMessage(null);
      setPushError(null);
    }

    try {
      const response = await fetch("/api/maintenance/test-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = (await response.json().catch(() => ({}))) as TestPushResponse;
      if (!response.ok || data.error || !data.ok) {
        setPushError(data.error ?? "Unable to send test push alert.");
        return null;
      }

      setPushMessage(`Test push sent to ${data.sent ?? 0}/${data.attempted ?? 0} device(s).`);
      return data;
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Unable to send test push alert.");
      return null;
    } finally {
      setPushSendLoading(false);
    }
  }

  async function sendSelfTestPush(tier: "critical" | "warning" | "info"): Promise<SelfTestPushResponse | null> {
    setPushSelfTestLoading(true);
    setPushMessage(null);
    setPushError(null);

    try {
      const response = await fetch("/api/maintenance/test-push-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });

      const data = (await response.json().catch(() => ({}))) as SelfTestPushResponse;
      if (!response.ok || data.error || !data.ok) {
        setPushError(data.error ?? "Unable to send self-test push alert.");
        return null;
      }

      const tierLabel = tier === "critical" ? "Critical" : tier === "warning" ? "Pro+" : "Info";
      setPushMessage(`${tierLabel} self-test push sent to ${data.sent ?? 0}/${data.attempted ?? 0} device(s).`);
      return data;
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Unable to send self-test push alert.");
      return null;
    } finally {
      setPushSelfTestLoading(false);
    }
  }

  async function loadPushDiagnosticsSnapshot(): Promise<PushDiagnosticsResponse | null> {
    try {
      const response = await fetch("/api/maintenance/push-diagnostics", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as PushDiagnosticsResponse;
      if (!response.ok) {
        return { error: data.error ?? "Unable to load push diagnostics." };
      }

      return data;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to load push diagnostics." };
    }
  }

  async function loadPushAuditLog() {
    if (!canUseWebhookControls) return;

    setPushAuditLoading(true);
    setPushAuditError(null);

    try {
      const response = await fetch("/api/maintenance/push-action-log?limit=40", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as PushActionLogResponse;

      if (!response.ok) {
        setPushAuditRows([]);
        setPushAuditError(data.error ?? "Unable to load push action audit log.");
        return;
      }

      setPushAuditRows(data.rows ?? []);
    } catch (error) {
      setPushAuditRows([]);
      setPushAuditError(error instanceof Error ? error.message : "Unable to load push action audit log.");
    } finally {
      setPushAuditLoading(false);
    }
  }

  async function loadWebhookSettingsSnapshot() {
    if (!canUseWebhookControls) return;

    setWebhookSettingsLoading(true);
    setWebhookSettingsError(null);

    try {
      const response = await fetch("/api/maintenance/webhook-settings", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as WebhookSettingsResponse;

      if (!response.ok) {
        setWebhookSettingsOrgs([]);
        setWebhookSettingsError(data.error ?? "Unable to load webhook settings.");
        return;
      }

      const organizations = data.organizations ?? [];
      setWebhookSettingsOrgs(organizations);

      if (organizations.length === 0) {
        setSelectedWebhookOrgId("");
        setWebhookUrlInput("");
        return;
      }

      const preferredId =
        organizations.find((org) => org.id === selectedWebhookOrgId)?.id ?? organizations[0].id;
      setSelectedWebhookOrgId(preferredId);

      const selected = organizations.find((org) => org.id === preferredId) ?? organizations[0];
      setWebhookUrlInput(selected.webhookUrl ?? "");
    } catch (error) {
      setWebhookSettingsOrgs([]);
      setWebhookSettingsError(error instanceof Error ? error.message : "Unable to load webhook settings.");
    } finally {
      setWebhookSettingsLoading(false);
    }
  }

  async function saveWebhookSettings() {
    if (!canUseWebhookControls) return;

    setWebhookSettingsSaving(true);
    setWebhookSettingsError(null);
    setWebhookSettingsMessage(null);

    try {
      const payload: Record<string, string> = {};
      if (selectedWebhookOrgId) payload.organizationId = selectedWebhookOrgId;
      if (webhookUrlInput.trim()) payload.webhookUrl = webhookUrlInput.trim();
      if (webhookSecretInput.trim()) payload.webhookSecret = webhookSecretInput.trim();

      const response = await fetch("/api/maintenance/webhook-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setWebhookSettingsError(data.error ?? "Unable to save webhook settings.");
        return;
      }

      setWebhookSecretInput("");
      setWebhookSettingsMessage("Webhook settings saved. Trigger a Samsara test event and check signatures/alerts.");
      await loadWebhookSettingsSnapshot();
      await loadFaultCodes(true);
    } catch (error) {
      setWebhookSettingsError(error instanceof Error ? error.message : "Unable to save webhook settings.");
    } finally {
      setWebhookSettingsSaving(false);
    }
  }

  async function simulateSamsaraTrigger() {
    if (!canUseWebhookControls) return;

    setSimulateSamsaraLoading(true);
    setWebhookSettingsError(null);
    setWebhookSettingsMessage(null);

    try {
      const response = await fetch("/api/maintenance/simulate-samsara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = (await response.json().catch(() => ({}))) as SimulateSamsaraResponse;
      if (!response.ok || data.error || !data.ok) {
        setWebhookSettingsError(data.error ?? `Simulation failed (status ${response.status}).`);
        return;
      }

      setWebhookSettingsMessage(
        `Simulation sent. Event ${data.simulatedEventId ?? "unknown"}. Webhook status ${data.webhookStatus ?? "n/a"}. ` +
          `Inserted ${data.webhookResult?.inserted ?? 0}, Duplicates ${data.webhookResult?.duplicates ?? 0}, Errors ${data.webhookResult?.errors ?? 0}.`
      );

      await loadFaultCodes(true);
      await loadWebhookSettingsSnapshot();
    } catch (error) {
      setWebhookSettingsError(error instanceof Error ? error.message : "Simulation failed.");
    } finally {
      setSimulateSamsaraLoading(false);
    }
  }

  async function restartPushTestWorkflow() {
    setPushWorkflowLoading(true);
    setPushMessage(null);
    setPushError(null);

    try {
      const prepNotes = await preparePushTestData();
      const before = await loadPushDiagnosticsSnapshot();
      const beforeCount = before?.subscriptionCount ?? 0;

      const enabled = await enablePushAlerts({ preserveStatus: true });
      if (!enabled) {
        setPushMessage(`Push restart halted before send. ${prepNotes.join(" ")} Registered devices before start: ${beforeCount}.`);
        return;
      }

      const sendResult = await sendTestPush({ preserveStatus: true });
      const after = await loadPushDiagnosticsSnapshot();
      const afterCount = after?.subscriptionCount ?? beforeCount;
      await loadFaultCodes(true);

      const targetCount = sendResult?.targets?.length ?? 0;
      const deliverySummary = sendResult
        ? `Push delivery: ${sendResult.sent ?? 0}/${sendResult.attempted ?? 0} endpoints${targetCount > 0 ? ` across ${targetCount} users` : ""}. Stale subscriptions cleaned: ${sendResult.staleRemoved ?? 0}.`
        : "Push delivery did not return endpoint stats.";

      if (sendResult?.ok) {
        setPushMessage(`Push restart complete. ${prepNotes.join(" ")} ${deliverySummary} Tenant subscription rows before: ${beforeCount}. Tenant subscription rows now: ${afterCount}.`);
      } else {
        setPushMessage(`Push registration completed, but test send failed. ${prepNotes.join(" ")} ${deliverySummary} Tenant subscription rows before: ${beforeCount}. Tenant subscription rows now: ${afterCount}.`);
      }
    } finally {
      setPushWorkflowLoading(false);
    }
  }

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance") return;
    void loadFaultCodes(false);
  }, [loadingProfile, effectiveRole]);

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance") return;

    let cancelled = false;

    async function loadWebhookMonitor() {
      try {
        const response = await fetch("/api/maintenance/webhook-monitor", { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as WebhookMonitorResponse;
        if (cancelled) return;

        if (!response.ok) {
          setWebhookMonitor(null);
          setMonitorError(data.error ?? "Unable to load webhook monitor.");
          return;
        }

        setWebhookMonitor(data);
        setMonitorError(null);
      } catch (error) {
        if (cancelled) return;
        setWebhookMonitor(null);
        setMonitorError(error instanceof Error ? error.message : "Unable to load webhook monitor.");
      }
    }

    void loadWebhookMonitor();

    return () => {
      cancelled = true;
    };
  }, [loadingProfile, effectiveRole, refreshing]);

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance" || !canUseWebhookControls) return;
    void loadWebhookSettingsSnapshot();
  }, [loadingProfile, effectiveRole, canUseWebhookControls]);

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance" || !canUseWebhookControls) return;
    void loadPushAuditLog();
  }, [loadingProfile, effectiveRole, canUseWebhookControls, refreshing]);

  useEffect(() => {
    const selected = webhookSettingsOrgs.find((org) => org.id === selectedWebhookOrgId);
    if (selected) {
      setWebhookUrlInput(selected.webhookUrl ?? "");
      setWebhookSettingsMessage(null);
      setWebhookSettingsError(null);
    }
  }, [selectedWebhookOrgId, webhookSettingsOrgs]);

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance") return;

    let cancelled = false;

    async function loadAssetVehicleMeta() {
      try {
        const response = await fetch("/api/assets", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { assets?: AssetVehicleMeta[] };
        if (!response.ok || !Array.isArray(payload.assets)) return;

        const nextMeta: Record<string, AssetVehicleMeta> = {};
        for (const asset of payload.assets) {
          const assetNo = asset.asset_no.trim().toLowerCase();
          const assetUnitNumber = asset.asset_unit_number.trim().toLowerCase();
          const vin = (asset.vin ?? "").trim().toUpperCase();

          if (assetNo) nextMeta[`asset:${assetNo}`] = asset;
          if (assetUnitNumber) nextMeta[`asset:${assetUnitNumber}`] = asset;
          if (vin) nextMeta[`vin:${vin}`] = asset;
        }

        if (!cancelled) {
          setAssetVehicleMeta(nextMeta);
        }
      } catch {
        // Keep raw vehicle fallback when asset metadata is unavailable.
      }
    }

    void loadAssetVehicleMeta();

    return () => {
      cancelled = true;
    };
  }, [loadingProfile, effectiveRole]);

  useEffect(() => {
    if (!dealerModal) return;

    const activeDealerModal = dealerModal;

    let cancelled = false;

    async function loadDealers() {
      setDealerLoading(true);
      setDealerError(null);
      setNearbyDealers([]);

      try {
        if (activeDealerModal.vehicle.latitude === null || activeDealerModal.vehicle.longitude === null) {
          throw new Error("Location coordinates unavailable for this truck.");
        }

        const reverseQuery = new URLSearchParams({
          format: "jsonv2",
          lat: activeDealerModal.vehicle.latitude.toString(),
          lon: activeDealerModal.vehicle.longitude.toString(),
          zoom: "10",
          addressdetails: "1",
        });

        const reverseResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?${reverseQuery.toString()}`, {
          cache: "no-store",
        });
        const reverseData = (await reverseResponse.json().catch(() => null)) as { address?: Record<string, string> } | null;
        const locationAddress = reverseData?.address ?? {};
        const city = locationAddress.city ?? locationAddress.town ?? locationAddress.village ?? locationAddress.municipality ?? locationAddress.county ?? "";
        const state = locationAddress.state ?? "";
        const locationLabel = [city, state].map((part) => part.trim()).filter(Boolean).join(" ");
        const viewbox = buildDealerViewBox(activeDealerModal.vehicle.latitude, activeDealerModal.vehicle.longitude);

        const uniqueDealers: NearbyDealer[] = [];

        for (const term of DEALER_SEARCH_TERMS) {
          const searchQuery = new URLSearchParams({
            format: "jsonv2",
            limit: "8",
            addressdetails: "1",
            extratags: "1",
            namedetails: "1",
            bounded: "1",
            viewbox,
            q: [term, locationLabel].filter(Boolean).join(" "),
          });

          const searchResponse = await fetch(`https://nominatim.openstreetmap.org/search?${searchQuery.toString()}`, {
            cache: "no-store",
          });

          if (!searchResponse.ok) continue;

          const payload = (await searchResponse.json().catch(() => [])) as NominatimDealerResult[];
          for (const entry of Array.isArray(payload) ? payload : []) {
            const normalized = normalizeNearbyDealerResult(entry, uniqueDealers.length, activeDealerModal.vehicle.latitude, activeDealerModal.vehicle.longitude, activeDealerModal.partsRange);
            if (!normalized) continue;

            const key = `${normalized.name}|${normalized.address}`;
            if (!uniqueDealers.some((dealer) => `${dealer.name}|${dealer.address}` === key)) {
              uniqueDealers.push(normalized);
            }
          }

          if (uniqueDealers.length >= 5) break;
        }

        if (!cancelled) {
          setNearbyDealers(uniqueDealers.sort((left, right) => left.distanceMiles - right.distanceMiles).slice(0, 5));
        }
      } catch (error) {
        if (!cancelled) {
          setDealerError(error instanceof Error ? error.message : "Unable to load nearby dealers.");
        }
      } finally {
        if (!cancelled) {
          setDealerLoading(false);
        }
      }
    }

    void loadDealers();

    return () => {
      cancelled = true;
    };
  }, [dealerModal]);

  const vehicles = useMemo<VehicleFaultView[]>(() => {
    if (!payload?.faults?.length) return [];

    return payload.faults.map((row, index) => {
      const vehicleKey = row.vehicleId || `unknown-${index}`;
      const vehicleLabel = row.vehicleName?.trim() ? row.vehicleName : `Vehicle ${vehicleKey}`;
      const details = expandFaultCodeEntries(row.faultCodes).map(normalizeFaultDetail);
      const stats = asRecord(row.rawVehicle.stats) ?? {};
      const topEngineState = asRecord(row.rawVehicle.engineState);

      const faultCodeCount = `${details.length}`;
      const engineState = getTextStat(topEngineState?.value ?? topEngineState ?? stats.engineState ?? stats.engineStates);
      const oilPressureKPaRaw = getNumericStat(stats.engineOilPressureKPa);
      const oilPressureKPa = oilPressureKPaRaw === null ? "-" : `${formatDecimal(oilPressureKPaRaw, 0)} kPa`;
      const coolantMilliC = getNumericStat(stats.engineCoolantTemperatureMilliC);
      const coolantTempF = coolantMilliC === null ? "-" : `${((((coolantMilliC / 1000) * 9) / 5) + 32).toFixed(1)} °F`;
      const engineLoadRaw = getNumericStat(stats.engineLoadPercent);
      const engineLoadPercent = engineLoadRaw === null ? "-" : `${engineLoadRaw.toFixed(0)}%`;
      const obdEngineSeconds = getNumericStat(stats.obdEngineSeconds);
      const engineHours = obdEngineSeconds === null ? "-" : `${Math.floor(obdEngineSeconds / 3600).toLocaleString()} hrs`;
      const fuelPercentRaw = getNumericStat(stats.fuelPercent);
      const fuelPercent = fuelPercentRaw === null ? "-" : `${fuelPercentRaw.toFixed(0)}%`;
      const odometerMeters = getNumericStat(stats.obdOdometerMeters);
      const odometerMiles = odometerMeters === null ? "-" : `${Math.round(odometerMeters * 0.000621371).toLocaleString()} mi`;
      const engineRpmRaw = getNumericStat(stats.engineRpm);
      const engineRpm = engineRpmRaw === null ? "-" : `${engineRpmRaw.toFixed(0)} rpm`;
      const batteryMv = getNumericStat(stats.batteryMilliVolts);
      const batteryVolts = batteryMv === null ? "-" : `${(batteryMv / 1000).toFixed(2)} V`;
      const fuelConsumedMl = getNumericStat(stats.fuelConsumedMilliliters);
      const fuelConsumedGallons = fuelConsumedMl === null ? "-" : `${Math.round(fuelConsumedMl / 3_785.411784).toLocaleString()} gal`;
      const idlingMs = getNumericStat(stats.idlingDurationMilliseconds);
      const idlingHours = idlingMs === null ? "-" : `${(idlingMs / 3_600_000).toFixed(1)} hrs`;
      const defMilliPercent = getNumericStat(stats.defLevelMilliPercent);
      const defLevelPercent = defMilliPercent === null ? "-" : `${(defMilliPercent / 1000).toFixed(1)}%`;
      const barometricPa = getNumericStat(stats.barometricPressurePa);
      const barometricPressurePa = barometricPa === null ? "-" : `${barometricPa.toFixed(0)} Pa`;
      const ecuSpeedRaw = getNumericStat(stats.ecuSpeedMph);
      const ecuSpeedMph = ecuSpeedRaw === null ? "-" : `${Math.round(ecuSpeedRaw).toLocaleString()} mph`;
      const gps = firstRecord(stats.gps);
      const lat = getNumericStat(gps?.latitude);
      const lon = getNumericStat(gps?.longitude);
      const gpsTime = toText(gps?.time);
      const reverseGeo = asRecord(gps?.reverseGeo);
      const locationText =
        typeof reverseGeo?.formattedLocation === "string" && reverseGeo.formattedLocation.trim().length > 0
          ? reverseGeo.formattedLocation
          : lat !== null && lon !== null
            ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
            : "Unknown location";
      const engineStateTime = toText(topEngineState?.time);
      const lastSeen = gpsTime
        ? formatTime(gpsTime, dateTimeDisplay ?? undefined)
        : engineStateTime
          ? formatTime(engineStateTime, dateTimeDisplay ?? undefined)
          : "-";
      const alertLevel = getTopAlertLevel(details, engineState);

      return {
        vehicleKey,
        vehicleLabel,
        sourceKeyIndex: row.sourceKeyIndex,
        faultCount: details.length,
        lastSeen,
        lastSeenLocation: locationText,
        latitude: lat,
        longitude: lon,
        alertLevel,
        faults: details,
        health: {
          faultCodeCount,
          engineState,
          oilPressureKPa,
          coolantTempF,
          engineLoadPercent,
          engineHours,
          fuelPercent,
          odometerMiles,
          engineRpm,
          batteryVolts,
          fuelConsumedGallons,
          idlingHours,
          defLevelPercent,
          barometricPressurePa,
          ecuSpeedMph,
        },
        rawVehicle: row.rawVehicle,
      };
    });
  }, [payload, dateTimeDisplay]);

  const totalFaults = useMemo(() => {
    return vehicles.reduce((sum, row) => sum + row.faultCount, 0);
  }, [vehicles]);

  const sortedVehicles = useMemo(() => {
    return [...vehicles].sort((a, b) => {
      const aRank = a.alertLevel?.rank ?? 0;
      const bRank = b.alertLevel?.rank ?? 0;
      return bRank - aRank;
    });
  }, [vehicles]);

  useEffect(() => {
    sortedVehicleKeysRef.current = sortedVehicles.map((vehicle) => vehicle.vehicleKey);

    const nextCounts: Record<string, number> = {};
    for (const vehicle of sortedVehicles) {
      nextCounts[vehicle.vehicleKey] = buildRepairAlertCards(vehicle.faults, { maxCards: 6 }).length;
    }
    repairCardCountByVehicleRef.current = nextCounts;
  }, [sortedVehicles]);

  useEffect(() => {
    if (!expandedVehicleKey) return;
    if (!vehicles.some((vehicle) => vehicle.vehicleKey === expandedVehicleKey)) {
      setExpandedVehicleKey(null);
    }
  }, [vehicles, expandedVehicleKey]);

  useEffect(() => {
    if (!expandedVehicleKey) return;

    const frame = window.requestAnimationFrame(() => {
      vehicleCardRefs.current[expandedVehicleKey]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [expandedVehicleKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveEstimateOverrides() {
      const pilotVehicles = vehicles.filter((vehicle) => isPilotTruck(vehicle.vehicleLabel, vehicle.vehicleKey));

      if (pilotVehicles.length === 0) {
        setLiveEstimateByCardKey({});
        return;
      }

      const nextMap: Record<string, LiveEstimateOverride> = {};

      for (const vehicle of pilotVehicles) {
        const vin = findVin(vehicle.rawVehicle);
        if (!vin) continue;

        const cards = buildRepairAlertCards(vehicle.faults, { maxCards: 6 });
        for (const card of cards) {
          const issue = card.title.includes(":") ? card.title.split(":").slice(1).join(":").trim() : card.title;
          const query = new URLSearchParams({
            vin,
            issue,
            urgency: card.urgency,
            occurrences: String(card.occurrenceCount),
            signal: card.source,
          });

          try {
            const response = await fetch(`/api/maintenance/estimate?${query.toString()}`, { cache: "no-store" });
            if (!response.ok) continue;

            const payload = (await response.json().catch(() => ({}))) as {
              estimate?: {
                laborHours?: string;
                partsRange?: string;
                confidence?: "Low" | "Medium" | "High";
                basis?: string;
                providerPath?: string;
              };
            };

            const estimate = payload.estimate;
            if (!estimate?.laborHours || !estimate.partsRange || !estimate.confidence || !estimate.basis || !estimate.providerPath) {
              continue;
            }

            nextMap[getCardLookupKey(vehicle.vehicleKey, card)] = {
              laborHours: estimate.laborHours,
              partsRange: estimate.partsRange,
              estimateConfidence: estimate.confidence,
              estimateBasis: estimate.basis,
              estimateProviderPath: estimate.providerPath,
            };
          } catch {
            // Keep local fallback values when external estimate endpoint is unavailable.
          }
        }
      }

      if (!cancelled) {
        setLiveEstimateByCardKey(nextMap);
      }
    }

    void loadLiveEstimateOverrides();

    return () => {
      cancelled = true;
    };
  }, [vehicles]);

  if (loadingProfile) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading maintenance workspace...</main>;
  }

  if (effectiveRole !== "maintenance") {
    return <main className="min-h-screen grid place-items-center text-slate-300">Redirecting...</main>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <TopNav fullName={effectiveName} compact />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Maintenance</p>
              <h1 className="mt-1 text-2xl font-black text-slate-100">Fault Codes</h1>
              <p className="mt-1 text-sm text-slate-300">Live vehicle fault-code feed from the connected fleet provider.</p>
              <p className="mt-1 text-xs text-slate-400">
                {canUsePushTestControls
                  ? "Push testing users can run a single workflow action for quick validation."
                  : "Enable push once on this phone. hkmaintenance can then run broadcast push tests to enrolled users."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canUsePushTestControls && (
                <>
                  <button
                    type="button"
                    onClick={() => void restartPushTestWorkflow()}
                    disabled={pushLoading || refreshing || loadingData}
                    className="rounded-md border border-cyan-400/45 bg-cyan-700/25 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pushWorkflowLoading ? "Preparing + Restarting Push..." : "Restart Push Test"}
                  </button>
                </>
              )}

              {!canUsePushTestControls && canEnrollPushOnDevice && (
                <button
                  type="button"
                  onClick={() => void enablePushAlerts()}
                  disabled={pushLoading || refreshing || loadingData}
                  className="rounded-md border border-sky-500/45 bg-sky-700/25 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushEnableLoading ? "Enabling Push..." : "Enable Push on This Phone"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void loadFaultCodes(true)}
                disabled={refreshing || loadingData || pushLoading}
                className="rounded-md border border-cyan-500/45 bg-cyan-700/25 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-700/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Total Fault Records</p>
              <p className="mt-1 text-2xl font-extrabold text-amber-200">{totalFaults}</p>
            </article>
            <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Webhook Health (24h)</p>
              {monitorError ? (
                <p className="mt-1 text-xs text-rose-300">{monitorError}</p>
              ) : !webhookMonitor ? (
                <p className="mt-1 text-xs text-slate-300">Loading monitor...</p>
              ) : (
                <>
                  <p className={`mt-1 text-sm font-bold ${webhookMonitor.stale ? "text-amber-300" : "text-emerald-300"}`}>
                    {webhookMonitor.stale
                      ? webhookMonitor.fallbackActive
                        ? "Stale (Fallback Active)"
                        : "Stale"
                      : "Receiving"}
                  </p>
                  {canUseWebhookControls && (
                    <p className="mt-1 text-xs text-slate-300">
                      Webhook config: {webhookMonitor.webhookConfig?.configured ? "Ready" : "Incomplete"}
                      {webhookMonitor.webhookConfig
                        ? ` | Org ${webhookMonitor.webhookConfig.organizationCount} | URL ${webhookMonitor.webhookConfig.webhookUrlCount} | Secret ${webhookMonitor.webhookConfig.webhookSecretCount}`
                        : ""}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-300">
                    Last event: {webhookMonitor.lastReceivedAt ? formatTime(webhookMonitor.lastReceivedAt, dateTimeDisplay ?? undefined) : "No events yet"}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Fallback alerts 24h: {webhookMonitor.fallbackAlertCountLast24h ?? 0}
                    {webhookMonitor.lastAlertAt ? ` | Last alert: ${formatTime(webhookMonitor.lastAlertAt, dateTimeDisplay ?? undefined)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Signatures: {webhookMonitor.signatureTotalsLast24h?.valid ?? 0} valid / {webhookMonitor.signatureTotalsLast24h?.invalid ?? 0} invalid
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Rx {webhookMonitor.totalsLast24h.received} | Inserted {webhookMonitor.totalsLast24h.inserted} | Dup {webhookMonitor.totalsLast24h.duplicates} | Err {webhookMonitor.totalsLast24h.errors}
                  </p>
                  {webhookMonitor.topEventTypes.length > 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      Top: {webhookMonitor.topEventTypes.map((entry) => `${entry.eventType} (${entry.count})`).join(", ")}
                    </p>
                  )}
                </>
              )}
            </article>
          </div>

          {canEnrollPushOnDevice && (
            <article className="mt-4 rounded-lg border border-sky-500/35 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-sky-300">Steps to get registered for notification alerts on your phone</p>
              <p className="mt-2 text-xs text-slate-300">
                1) Open this page on your smartphone browser and allow notifications when prompted.
              </p>
              <p className="mt-1 text-xs text-slate-300">
                2) Tap "Enable Push on This Phone" to register your device.
              </p>
              <p className="mt-1 text-xs text-slate-300">
                3) Tap a self-test push below and confirm notification receipt + tap-to-open behavior.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Production policy stays focused on EngineFaultOn critical alerts. Warning/Info buttons are for onboarding demo only.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void enablePushAlerts()}
                  disabled={pushLoading || refreshing || loadingData}
                  className="rounded-md border border-sky-500/45 bg-sky-700/25 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushEnableLoading ? "Enabling Push..." : "Enable Push on This Phone"}
                </button>
                <button
                  type="button"
                  onClick={() => void sendSelfTestPush("critical")}
                  disabled={pushLoading || refreshing || loadingData}
                  className="rounded-md border border-rose-500/45 bg-rose-700/25 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushSelfTestLoading ? "Sending..." : "Send My Critical Test"}
                </button>
                <button
                  type="button"
                  onClick={() => void sendSelfTestPush("warning")}
                  disabled={pushLoading || refreshing || loadingData}
                  className="rounded-md border border-amber-500/45 bg-amber-700/25 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushSelfTestLoading ? "Sending..." : "Send My Pro+ Demo"}
                </button>
              </div>
            </article>
          )}

          {canUseWebhookControls && (
            <article className="mt-4 rounded-lg border border-cyan-500/35 bg-slate-950/60 p-3">
              {(() => {
                const selectedOrg = webhookSettingsOrgs.find((org) => org.id === selectedWebhookOrgId) ?? webhookSettingsOrgs[0] ?? null;
                const configReady = Boolean(selectedOrg?.webhookUrl?.trim()) && Boolean(selectedOrg?.hasWebhookSecret);
                const validSignatures = webhookMonitor?.signatureTotalsLast24h?.valid ?? 0;
                const insertedAlerts = webhookMonitor?.totalsLast24h.inserted ?? 0;
                const verificationLabel = !configReady
                  ? "NOT READY"
                  : validSignatures > 0 && insertedAlerts > 0
                    ? "VERIFIED"
                    : "READY / WAITING FOR EVENT";

                return (
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${verificationLabel === "VERIFIED" ? "text-emerald-300" : verificationLabel === "NOT READY" ? "text-rose-300" : "text-amber-300"}`}>
                    Verification Status: {verificationLabel}
                  </p>
                );
              })()}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-cyan-300">Webhook Settings (hkmaintenance)</p>
                <button
                  type="button"
                  onClick={() => void loadWebhookSettingsSnapshot()}
                  disabled={webhookSettingsLoading || webhookSettingsSaving}
                  className="rounded-md border border-cyan-500/45 bg-cyan-700/25 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {webhookSettingsLoading ? "Loading..." : "Reload"}
                </button>
              </div>

              {webhookSettingsError && <p className="mt-2 text-xs text-rose-300">{webhookSettingsError}</p>}
              {webhookSettingsMessage && <p className="mt-2 text-xs text-emerald-300">{webhookSettingsMessage}</p>}

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-300">
                  Organization
                  <select
                    value={selectedWebhookOrgId}
                    onChange={(event) => setSelectedWebhookOrgId(event.target.value)}
                    disabled={webhookSettingsLoading || webhookSettingsSaving || webhookSettingsOrgs.length === 0}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
                  >
                    {webhookSettingsOrgs.length === 0 ? (
                      <option value="">No organization rows found</option>
                    ) : (
                      webhookSettingsOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.organizationName} {org.hasWebhookSecret ? "(secret set)" : "(missing secret)"}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="text-xs text-slate-300">
                  Webhook URL
                  <input
                    type="text"
                    value={webhookUrlInput}
                    onChange={(event) => setWebhookUrlInput(event.target.value)}
                    placeholder="https://your-domain.com/api/webhooks/samsara"
                    disabled={webhookSettingsLoading || webhookSettingsSaving}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
                  />
                </label>
              </div>

              <label className="mt-2 block text-xs text-slate-300">
                Webhook Secret (leave blank to keep existing secret)
                <input
                  type="password"
                  value={webhookSecretInput}
                  onChange={(event) => setWebhookSecretInput(event.target.value)}
                  placeholder="Paste secret from Samsara Webhooks page"
                  disabled={webhookSettingsLoading || webhookSettingsSaving}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-100"
                />
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveWebhookSettings()}
                  disabled={webhookSettingsLoading || webhookSettingsSaving || webhookSettingsOrgs.length === 0}
                  className="rounded-md border border-emerald-500/45 bg-emerald-700/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {webhookSettingsSaving ? "Saving..." : "Save Webhook Settings"}
                </button>
                <button
                  type="button"
                  onClick={() => void simulateSamsaraTrigger()}
                  disabled={webhookSettingsLoading || webhookSettingsSaving || simulateSamsaraLoading || webhookSettingsOrgs.length === 0}
                  className="rounded-md border border-amber-500/45 bg-amber-700/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {simulateSamsaraLoading ? "Simulating..." : "Simulate Real Samsara Event"}
                </button>
                <p className="text-[11px] text-slate-400">Save first, then send a Samsara test event.</p>
              </div>

              <div className="mt-3 rounded-md border border-slate-700 bg-slate-900/80 p-2 text-[11px] text-slate-300">
                <p className="font-semibold text-slate-200">Step 3: Send a real Samsara trigger</p>
                <p className="mt-1">In Samsara Dashboard, go to Settings, then Webhooks, open this webhook, click Test (Ping), and then trigger a real alert condition (for example Engine Fault On) on an assigned asset.</p>
                <p className="mt-1">After each trigger, click Refresh on this page and confirm: Signatures valid increases, Webhook Health is Receiving, and a new alert appears for push delivery.</p>
              </div>
            </article>
          )}

          {canUseWebhookControls && (
            <article className="mt-4 rounded-lg border border-fuchsia-500/35 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-fuchsia-300">Push Audit Viewer (hkmaintenance)</p>
                <button
                  type="button"
                  onClick={() => void loadPushAuditLog()}
                  disabled={pushAuditLoading}
                  className="rounded-md border border-fuchsia-500/45 bg-fuchsia-700/25 px-2 py-1 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-700/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushAuditLoading ? "Loading..." : "Reload Logs"}
                </button>
              </div>

              {pushAuditError && <p className="mt-2 text-xs text-rose-300">{pushAuditError}</p>}

              {!pushAuditError && pushAuditRows.length === 0 ? (
                <p className="mt-2 text-xs text-slate-300">No push action logs found yet.</p>
              ) : (
                <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-700 bg-slate-900/80">
                  <table className="min-w-full divide-y divide-slate-700 text-xs text-slate-200">
                    <thead className="bg-slate-900 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold">Time</th>
                        <th className="px-2 py-2 text-left font-semibold">User</th>
                        <th className="px-2 py-2 text-left font-semibold">Action</th>
                        <th className="px-2 py-2 text-left font-semibold">Status</th>
                        <th className="px-2 py-2 text-left font-semibold">Options</th>
                        <th className="px-2 py-2 text-left font-semibold">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {pushAuditRows.map((row) => {
                        const optionsText = row.options ? JSON.stringify(row.options) : "{}";
                        const optionsPreview = optionsText.length > 120 ? `${optionsText.slice(0, 120)}...` : optionsText;
                        const statusColor =
                          row.status === "success"
                            ? "text-emerald-300"
                            : row.status === "failed"
                              ? "text-rose-300"
                              : "text-amber-200";

                        return (
                          <tr key={row.id}>
                            <td className="px-2 py-2 align-top text-slate-300">
                              {formatTime(row.created_at, dateTimeDisplay ?? undefined)}
                            </td>
                            <td className="px-2 py-2 align-top text-slate-200">
                              {(row.username ?? "unknown").trim() || "unknown"}
                            </td>
                            <td className="px-2 py-2 align-top text-slate-200">{row.action}</td>
                            <td className={`px-2 py-2 align-top font-semibold ${statusColor}`}>{row.status}</td>
                            <td className="px-2 py-2 align-top text-slate-300" title={optionsText}>
                              {optionsPreview}
                            </td>
                            <td className="px-2 py-2 align-top text-rose-200/90">{row.error_message ?? "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}

          {payload?.guidance && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {payload.guidance}
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {errorMessage}
            </div>
          )}

          {pushMessage && (
            <div className="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              {pushMessage}
            </div>
          )}

          {pushError && (
            <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {pushError}
            </div>
          )}

          {loadingData ? (
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
              Loading fault codes...
            </div>
          ) : vehicles.length === 0 ? (
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
              No fault-code records returned for this tenant right now.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {sortedVehicles.map((vehicle) => {
                const uniqueSituationCount = toFaultSituations(vehicle.faults).length;
                const pilotCards = buildRepairAlertCards(vehicle.faults, { maxCards: 6 });
                const isExpanded = expandedVehicleKey === vehicle.vehicleKey;
                const hasFaults = vehicle.faultCount > 0;
                const resolvedVin = findVin(vehicle.rawVehicle) ?? "VIN unavailable";
                const matchedAsset =
                  assetVehicleMeta[`vin:${resolvedVin}`] ??
                  assetVehicleMeta[`asset:${vehicle.vehicleLabel.trim().toLowerCase()}`] ??
                  assetVehicleMeta[`asset:${vehicle.vehicleKey.trim().toLowerCase()}`] ??
                  null;
                const resolvedVehicleProfile = buildAssetVehicleProfile(
                  matchedAsset,
                  extractVehicleProfile(vehicle.rawVehicle, vehicle.vehicleLabel)
                );
                const primaryMessage = hasFaults
                  ? vehicle.alertLevel
                    ? `${vehicle.alertLevel.label}: ${vehicle.alertLevel.action}`
                    : `FAULTS DETECTED: Review ${vehicle.faultCount} active fault${vehicle.faultCount === 1 ? "" : "s"}.`
                  : "Live Health";
                const activeCardIndex = activeRepairCardByVehicle[vehicle.vehicleKey] ?? 0;
                const collapsedHeaderPx = 84;
                const stackGapPx = 12;
                const activeCard = pilotCards[activeCardIndex];
                const activeCardKey = activeCard ? getCardLookupKey(vehicle.vehicleKey, activeCard) : null;
                const activeCardHeight = activeCardKey ? repairCardContentHeights[activeCardKey] ?? 488 : 488;

                return (
                <article
                  key={`${vehicle.sourceKeyIndex}-${vehicle.vehicleKey}`}
                  ref={(element) => {
                    vehicleCardRefs.current[vehicle.vehicleKey] = element;
                  }}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:p-4"
                  style={{ scrollMarginTop: "96px" }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-100">{vehicle.vehicleLabel}</h2>
                      <p className="text-xs text-slate-400" suppressHydrationWarning>
                        Last Seen: {vehicle.lastSeen}
                      </p>
                      <p className="text-xs text-slate-400 break-words">Location: {vehicle.lastSeenLocation}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex w-fit rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                        {vehicle.faultCount} fault{vehicle.faultCount === 1 ? "" : "s"}
                      </span>
                      {vehicle.alertLevel && (
                        <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${vehicle.alertLevel.className}`}>
                          {vehicle.alertLevel.label}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setHealthModalVehicle(vehicle)}
                        className="inline-flex w-fit rounded-full border border-indigo-400/45 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/20"
                      >
                        Tires / Brakes
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedVehicleKey((prev) => {
                        const nextKey = prev === vehicle.vehicleKey ? null : vehicle.vehicleKey;
                        if (nextKey) {
                          setFocusedRepairCard(nextKey, 0, pilotCards.length);
                        }
                        return nextKey;
                      })
                    }
                    className={`mt-3 w-full rounded-xl border px-3 py-3 text-left transition ${
                      hasFaults
                        ? vehicle.alertLevel?.className ?? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                        : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">{primaryMessage}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-200/80">
                        {isExpanded ? "Hide" : "Open"}
                      </span>
                    </div>
                  </button>

                  {isExpanded && hasFaults && pilotCards.length > 0 && (
                    <div className="mt-3">
                      <div
                        className="relative overflow-hidden"
                        style={{
                          height: `${Math.max(
                            544,
                            (activeCardIndex * collapsedHeaderPx) + activeCardHeight + 36
                          )}px`,
                          touchAction: "none",
                          overscrollBehavior: "contain",
                        }}
                        onWheel={(event) => onRepairDeckWheel(vehicle.vehicleKey, event.deltaY, pilotCards.length)}
                        onTouchStart={(event) => onRepairDeckTouchStart(vehicle.vehicleKey, event.touches[0]?.clientY ?? 0)}
                        onTouchMove={(event) => event.preventDefault()}
                        onTouchEnd={(event) => onRepairDeckTouchEnd(vehicle.vehicleKey, event.changedTouches[0]?.clientY ?? 0, pilotCards.length)}
                      >
                      {pilotCards.map((card, idx) => {
                        const override = liveEstimateByCardKey[getCardLookupKey(vehicle.vehicleKey, card)];
                        const effectiveCard: RepairAlertCard = override
                          ? {
                              ...card,
                              laborHours: override.laborHours,
                              partsRange: override.partsRange,
                              estimateConfidence: override.estimateConfidence,
                              estimateBasis: override.estimateBasis,
                              estimateProviderPath: override.estimateProviderPath,
                            }
                          : card;

                        const estimateQualifier = getEstimateQualifier(effectiveCard.estimateConfidence);
                        const technicianBullets = textToBullets(effectiveCard.mechanicSpeak);
                        const operationsBullets = textToBullets(effectiveCard.managerSpeak);
                        const expectedParts = inferExpectedParts(effectiveCard.title);
                        const partEstimateLines = buildPartEstimateLines(expectedParts, effectiveCard.partsRange);
                        const relativePosition = idx - activeCardIndex;
                        const overlapPx = 28;
                        const activeTop = activeCardIndex * (collapsedHeaderPx - stackGapPx);
                        const translateY =
                          relativePosition === 0
                            ? activeTop
                            : relativePosition > 0
                              ? activeTop + (activeCardHeight - overlapPx) + (relativePosition - 1) * (collapsedHeaderPx - stackGapPx)
                              : idx * (collapsedHeaderPx - stackGapPx);
                        const isActiveCard = relativePosition === 0;
                        const isCollapsedCard = !isActiveCard;

                        return (
                          <div
                            key={`${vehicle.vehicleKey}-repair-card-${idx}`}
                            data-repair-card-index={idx}
                            onClick={() => {
                              if (!isActiveCard) {
                                setFocusedRepairCard(vehicle.vehicleKey, idx, pilotCards.length);
                              }
                            }}
                            className="absolute left-0 right-0 top-0 cursor-pointer transition-all duration-[720ms] ease-[cubic-bezier(0.2,0.9,0.25,1)]"
                            style={{
                              transform: `translateY(${translateY}px) scale(${isActiveCard ? 1 : 0.995})`,
                              zIndex: idx < activeCardIndex ? 200 + idx : isActiveCard ? 500 + idx : 800 + idx,
                              opacity: 1,
                              pointerEvents: "auto",
                            }}
                          >
                        <div
                          className={`rounded-xl border bg-slate-900/84 p-3 backdrop-blur-sm shadow-[0_18px_40px_-24px_rgba(8,145,178,0.75)] ${
                            isActiveCard ? "border-cyan-300/70 ring-1 ring-cyan-300/45" : "border-cyan-500/35"
                          }`}
                          style={{
                            height: isCollapsedCard ? `${collapsedHeaderPx}px` : "auto",
                            overflowY: isCollapsedCard ? "hidden" : "visible",
                          }}
                          ref={(element) => {
                            if (!element || !isActiveCard) return;

                            const measuredHeight = Math.ceil(element.scrollHeight);
                            const cardKey = getCardLookupKey(vehicle.vehicleKey, effectiveCard);
                            setRepairCardContentHeights((prev) => {
                              if (prev[cardKey] === measuredHeight) return prev;
                              return { ...prev, [cardKey]: measuredHeight };
                            });
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-bold leading-snug text-cyan-50 break-words">{effectiveCard.title}</p>
                              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200" suppressHydrationWarning>
                                {formatTime(effectiveCard.timestamp, dateTimeDisplay ?? undefined)}
                              </p>
                              <p className="mt-1 truncate text-[11px] text-slate-300">
                                {effectiveCard.source} • {effectiveCard.occurrenceCount} occurrence{effectiveCard.occurrenceCount !== 1 ? "s" : ""}
                              </p>
                            </div>
                            <span
                              className={`flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] whitespace-nowrap ${
                                effectiveCard.urgency === "Immediate"
                                  ? "bg-rose-600/70 text-rose-50"
                                  : effectiveCard.urgency === "High"
                                    ? "bg-amber-600/70 text-amber-50"
                                    : "bg-emerald-600/70 text-emerald-50"
                              }`}
                            >
                              {effectiveCard.urgency}
                            </span>
                          </div>

                          {isCollapsedCard ? (
                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              <span>Tap to focus</span>
                              <span>{idx === activeCardIndex ? "Focused" : "Next card"}</span>
                            </div>
                          ) : (
                            <div className="pb-8">
                              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Technician Guidance</p>
                                  <ul className="mt-1 space-y-1 text-xs text-slate-100">
                                    {technicianBullets.map((bullet, i) => (
                                      <li key={i} className="flex gap-2">
                                        <span className="text-cyan-400 flex-shrink-0">•</span>
                                        <span>{bullet}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Operations Guidance</p>
                                  <ul className="mt-1 space-y-1 text-xs text-slate-100">
                                    {operationsBullets.map((bullet, i) => (
                                      <li key={i} className="flex gap-2">
                                        <span className="text-amber-400 flex-shrink-0">•</span>
                                        <span>{bullet}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>

                              <div className="mt-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                    Estimate ({estimateQualifier})
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDealerModal({
                                          vehicle,
                                          cardTitle: effectiveCard.title,
                                          partsRange: effectiveCard.partsRange,
                                          confidence: estimateQualifier,
                                          vin: resolvedVin,
                                          vehicleProfile: resolvedVehicleProfile,
                                          manufacturerAssignedSpn: summarizeManufacturerAssignedSpn(vehicle.faults),
                                          faultDescription: conciseFaultDescription(effectiveCard.title),
                                          faultCodes: summarizeFaultCodes(vehicle.faults),
                                          expectedParts,
                                        })
                                      }
                                      className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/20"
                                    >
                                      Dealer help
                                    </button>
                                  </div>
                                </div>
                                <ul className="mt-1 space-y-1 text-xs text-slate-100">
                                  <li className="flex gap-2">
                                    <span className="text-cyan-400 flex-shrink-0">•</span>
                                    <span>Labor: {effectiveCard.laborHours}</span>
                                  </li>
                                  <li className="flex gap-2">
                                    <span className="text-cyan-400 flex-shrink-0">•</span>
                                    <span>Parts budget: {effectiveCard.partsRange}</span>
                                  </li>
                                </ul>
                                {partEstimateLines.length > 0 && (
                                  <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Likely Parts Breakdown</p>
                                    <ul className="mt-1 space-y-1 text-xs text-slate-200">
                                      {partEstimateLines.map((line, lineIndex) => (
                                        <li key={`${vehicle.vehicleKey}-part-line-${idx}-${lineIndex}`} className="flex items-start justify-between gap-3">
                                          <span className="text-slate-100">{line.part}</span>
                                          <span className="whitespace-nowrap text-cyan-200">{line.range}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}


                        </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {isExpanded && !hasFaults && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-300 md:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Engine</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.engineState}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Fuel</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.fuelPercent}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Battery</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.batteryVolts}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Odometer</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.odometerMiles}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Coolant</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.coolantTempF}</div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                        <span className="text-slate-400">Oil</span>
                        <div className="mt-1 font-semibold text-slate-100">{vehicle.health.oilPressureKPa}</div>
                      </div>
                    </div>
                  )}

                  {isExpanded && hasFaults && vehicle.faultCount > 0 && (
                    <details className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-300 hover:text-slate-100">
                        DTC Fault Codes ({vehicle.faultCount})
                      </summary>
                      <div className="overflow-x-auto px-1 pb-2">
                        <table className="min-w-full text-left text-xs">
                          <thead>
                            <tr className="text-slate-400">
                              <th className="px-2 py-2 font-semibold">Code</th>
                              <th className="px-2 py-2 font-semibold">SPN</th>
                              <th className="px-2 py-2 font-semibold">FMI</th>
                              <th className="px-2 py-2 font-semibold">Severity</th>
                              <th className="px-2 py-2 font-semibold">Protocol</th>
                              <th className="px-2 py-2 font-semibold">Detected</th>
                              <th className="px-2 py-2 font-semibold">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vehicle.faults.map((fault, idx) => (
                              <tr key={`${vehicle.vehicleKey}-${idx}`} className="border-t border-slate-800 text-slate-200">
                                <td className="px-2 py-2">{fault.code}</td>
                                <td className="px-2 py-2">{fault.spn}</td>
                                <td className="px-2 py-2">{fault.fmi}</td>
                                <td className="px-2 py-2">{fault.severity}</td>
                                <td className="px-2 py-2">{fault.protocol}</td>
                                <td className="px-2 py-2" suppressHydrationWarning>
                                  {formatTime(fault.timestamp, dateTimeDisplay ?? undefined)}
                                </td>
                                <td className="px-2 py-2">{fault.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </article>
                );
              })}
            </div>
          )}

          {payload?.failures && payload.failures.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-200">Some fleet connections failed</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-100">
                {payload.failures.map((failure, idx) => (
                  <li key={`${failure.sourceKeyIndex}-${idx}`}>
                    Key #{failure.sourceKeyIndex + 1}: {failure.status ?? "n/a"} - {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {healthModalVehicle && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4" role="dialog" aria-modal="true">
              <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-300">Health Snapshot</p>
                    <h3 className="text-lg font-bold text-slate-100">{healthModalVehicle.vehicleLabel} — Tires / Brakes</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHealthModalVehicle(null)}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[
                    classifyComponentHealth("Tires", healthModalVehicle.faults, ["tire", "tyre", "wheel", "axle", "tpms", "wheel-end", "wheel end"]),
                    classifyComponentHealth("Brakes", healthModalVehicle.faults, ["brake", "abs", "retarder", "pad", "rotor"]),
                  ].map((component) => (
                    <div key={component.label} className={`rounded-xl border p-3 ${getStatusClass(component.status)}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold">{component.label}</p>
                        <span className="text-xs font-semibold uppercase tracking-[0.12em]">{component.status}</span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className={`h-full ${component.status === "critical" ? "bg-rose-400" : component.status === "warning" ? "bg-amber-400" : "bg-emerald-400"}`}
                          style={{ width: getHeatWidth(component.status) }}
                        />
                      </div>
                      <p className="mt-3 text-xs leading-5">{component.summary}</p>
                      {component.issues.length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-slate-100">
                          {component.issues.slice(0, 3).map((issue, idx) => (
                            <li key={`${component.label}-${idx}`} className="rounded border border-slate-700/70 bg-slate-900/60 px-2 py-1">
                              {issue.code} - {issue.description}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {dealerModal && (
            <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/85 px-4 py-6" role="dialog" aria-modal="true">
              <div className="flex w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-300">Parts Dealer Help</p>
                    <h3 className="text-lg font-bold text-slate-100">{dealerModal.cardTitle}</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Estimate ({dealerModal.confidence}) • Range: {dealerModal.partsRange}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDealerModal(null)}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Call Sheet</p>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
                      <span className="text-slate-400">Vehicle:</span> {dealerModal.vehicleProfile}
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
                      <span className="text-slate-400">VIN:</span> {dealerModal.vin}
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
                      <span className="text-slate-400">Manufacturer assigned SPN:</span> {dealerModal.manufacturerAssignedSpn}
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200">
                      <span className="text-slate-400">Fault summary:</span> {dealerModal.faultDescription}
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Fault Codes</p>
                      <ul className="mt-1 space-y-1 text-xs text-slate-200">
                        {dealerModal.faultCodes.map((code, idx) => (
                          <li key={`fault-code-${idx}`} className="rounded bg-slate-900/70 px-2 py-1">
                            {code}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Expected Parts</p>
                      <ul className="mt-1 space-y-1 text-xs text-slate-200">
                        {buildPartEstimateLines(dealerModal.expectedParts, dealerModal.partsRange).map((line, idx) => (
                          <li key={`expected-part-${idx}`} className="flex items-start justify-between gap-3 rounded bg-slate-900/70 px-2 py-1">
                            <span>{line.part}</span>
                            <span className="whitespace-nowrap text-cyan-200">{line.range}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Negotiation Script</p>
                      <ul className="mt-1 space-y-1 text-xs text-slate-200">
                        <li>- Ask for fleet/pro/commercial pricing first.</li>
                        <li>- Ask for online price-match before confirming order.</li>
                        <li>- Confirm core charge, return policy, and same-day pickup.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-col rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Nearby Auto Parts Dealers</p>
                      {dealerLoading && <span className="text-xs text-slate-400">Loading...</span>}
                    </div>

                    {dealerError ? (
                      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                        {dealerError}
                      </div>
                    ) : nearbyDealers.length === 0 && !dealerLoading ? (
                      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                        No nearby dealers returned from the map lookup right now.
                      </div>
                    ) : (
                      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
                        {nearbyDealers.map((dealer, index) => (
                          <div key={`${dealer.name}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-100">{dealer.name}</p>
                                <p className="line-clamp-2 text-xs text-slate-400">{dealer.address}</p>
                              </div>
                              <span className="text-xs font-semibold text-cyan-200">{formatDistanceMiles(dealer.distanceMiles)}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                              <div className="text-xs text-slate-200">
                                <span className="text-slate-400">Phone:</span> {formatPhoneNumber(dealer.phone)}
                              </div>
                              <div className="text-xs text-slate-200">
                                <span className="text-slate-400">Projected parts:</span> {dealer.projectedParts}
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-slate-300">Tip: {dealer.tip}</p>
                            {dealer.website && (
                              <a
                                href={dealer.website}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                              >
                                Website
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}






