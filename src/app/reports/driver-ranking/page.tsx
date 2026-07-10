"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { FLEET_API_ROUTES } from "@/lib/fleet-api";
import { IncidentHeatmap } from "@/components/IncidentHeatmap";
import {
  createWeeklyHeatmap,
  type EventDetail,
} from "@/lib/analytics/incident-heatmap";

type TimeWindow = "7" | "30" | "60";

type SessionState = {
  ready: boolean;
  role: AppRole | null;
  username: string | null;
};

type PillarKey = "safety" | "idling" | "fuel" | "dvir" | "maintenance";

type WeightState = Record<PillarKey, number>;

type Pillar = {
  key: PillarKey;
  title: string;
  weight: number;
  summary: string;
  hint: string;
};

const PILLARS: Pillar[] = [
  {
    key: "safety",
    title: "Safety Discipline",
    weight: 35,
    summary: "How safely each driver operates on the road.",
    hint: "Alert status, speeding behavior, and fault pressure.",
  },
  {
    key: "idling",
    title: "Idling and Efficiency",
    weight: 20,
    summary: "How efficiently engine time is used.",
    hint: "Idle ratio compared to active engine time.",
  },
  {
    key: "fuel",
    title: "Fueling Discipline",
    weight: 15,
    summary: "How consistently drivers protect fuel cost and quality.",
    hint: "Fuel level patterns and low-fuel risk behavior.",
  },
  {
    key: "dvir",
    title: "DVIR and Compliance",
    weight: 15,
    summary: "How reliably inspections and defect actions are completed.",
    hint: "Fault exposure and compliance pressure indicators.",
  },
  {
    key: "maintenance",
    title: "Maintenance-Friendly Driving",
    weight: 15,
    summary: "How driving behavior supports lower wear and breakdown risk.",
    hint: "Engine stress signals such as temp, load, RPM, and oil pressure.",
  },
];

type LiveVehicle = {
  id: string;
  truckNo: string;
  driver: string;
  location: string;
  status: "moving" | "idle" | "alert";
  atHome?: boolean;
  mph?: number;
  fuelLevel?: number;
};

type FaultRecord = {
  vehicleId?: string;
  vehicleName?: string;
  faultCodes?: unknown;
  stats?: Record<string, unknown>;
};

type DriverDirectoryRow = {
  assignedTruckUnitNumber: string;
  fullName: string;
};

type PillarScores = {
  safety: number;
  idling: number;
  fuel: number;
  dvir: number;
  maintenance: number;
};

type DriverScoreRow = {
  key: string;
  driver: string;
  trucks: string[];
  lastLocation: string;
  totalScore: number;
  tier: "top_performer" | "on_track" | "action_needed";
  percentile?: number;
  pillar: PillarScores;
  speedingCount: number;
  harshBrakingCount: number;
  harshAccelCount: number;
  faultCount: number;
  maintenanceAlertsCount: number;
  dvirDefectsCount: number;
  lowFuelEventsCount: number;
  idleRatio: number;
  avgFuelLevel: number | null;
};

// Aggregated analytics response from /api/analytics/driver-window
type AggregatedDriverMetrics = {
  driver_id: string;
  driver_name: string;
  truck_unit_number: string;
  window_days: number;
  days_with_data: number;
  
  // Safety (35%)
  harsh_braking_total: number;
  harsh_accel_total: number;
  harsh_corner_total: number;
  speeding_violations_total: number;
  
  // Idling (20%)
  engine_minutes_total: number;
  idling_minutes_total: number;
  idling_ratio_avg: number;
  
  // Fuel (15%)
  avg_fuel_level_mean: number;
  fuel_consumed_total_liters: number;
  low_fuel_events_total: number;
  
  // DVIR (15%)
  dvir_defects_total: number;
  maintenance_alerts_total: number;
  
  // Maintenance (15%)
  fault_codes_total: number;
  coolant_high_events_total: number;
  oil_low_events_total: number;
  rpm_high_events_total: number;
  load_high_events_total: number;
};

const WINDOW_LABELS: Record<TimeWindow, string> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "60": "Last 60 Days",
};

const WINDOW_NOTES: Record<TimeWindow, string> = {
  "7": "Best for week-to-week coaching and quick behavior correction.",
  "30": "Best for monthly performance review and trend stability.",
  "60": "Best for promotion, incentive, and consistency decisions.",
};

const WINDOW_MULTIPLIER: Record<TimeWindow, number> = {
  "7": 1.12,
  "30": 1,
  "60": 0.9,
};

const DEFAULT_WEIGHTS: WeightState = {
  safety: 35,
  idling: 20,
  fuel: 15,
  dvir: 15,
  maintenance: 15,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function findNumericDeep(value: unknown): number | null {
  const direct = asNumber(value);
  if (direct !== null) return direct;

  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const nested = findNumericDeep(value[i]);
      if (nested !== null) return nested;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["value", "current", "avg", "average", "amount", "number", "percent"];
    for (const key of preferredKeys) {
      const nested = findNumericDeep(record[key]);
      if (nested !== null) return nested;
    }
    for (const nestedValue of Object.values(record)) {
      const nested = findNumericDeep(nestedValue);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function pickStat(stats: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!stats) return null;
  for (const key of keys) {
    const value = findNumericDeep(stats[key]);
    if (value !== null) return value;
  }
  return null;
}

function countFaultCodes(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data.length;
    if (Array.isArray(record.faultCodes)) return record.faultCodes.length;
    const count = asNumber(record.count);
    if (count !== null) return count;
    return 1;
  }
  return 1;
}

function normalizedWeights(weights: WeightState): WeightState {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    safety: weights.safety / total,
    idling: weights.idling / total,
    fuel: weights.fuel / total,
    dvir: weights.dvir / total,
    maintenance: weights.maintenance / total,
  };
}

// Convert aggregated analytics metrics to DPI score
function scoreDriverFromAnalytics(
  metrics: AggregatedDriverMetrics,
  multiplier: number,
  weights: WeightState
): DriverScoreRow {
  // Normalize totals to per-day averages so penalty scale stays consistent
  const days = Math.max(metrics.days_with_data, 1);

  const idleRatio = metrics.engine_minutes_total > 0 
    ? clamp(metrics.idling_minutes_total / metrics.engine_minutes_total, 0, 1.5)
    : 0;

  const avgFuelLevel = metrics.avg_fuel_level_mean ?? null;

  // Safety: per-day average events × penalty weights
  const safetyPenalty = (
    (metrics.harsh_braking_total / days) * 2 +
    (metrics.harsh_accel_total / days) * 2 +
    (metrics.harsh_corner_total / days) * 1.5 +
    (metrics.speeding_violations_total / days) * 5
  ) * multiplier;

  // Idling: uses ratio (already averaged)
  const idlingPenalty = idleRatio * 75 * multiplier;

  // Fuel: uses mean (already averaged)
  const fuelPenalty = (
    (avgFuelLevel === null ? 22 : Math.abs(avgFuelLevel - 58) * 0.95) +
    (metrics.low_fuel_events_total / days) * 9
  ) * multiplier;

  // DVIR/Compliance: per-day averages
  const compliancePenalty = (
    (metrics.dvir_defects_total / days) * 11 +
    (metrics.maintenance_alerts_total / days) * 6 +
    (metrics.fault_codes_total / days) * 4
  ) * multiplier;

  // Maintenance: per-day averages
  const maintenancePenalty = (
    (metrics.coolant_high_events_total / days) * 8 +
    (metrics.oil_low_events_total / days) * 8 +
    (metrics.rpm_high_events_total / days) * 5 +
    (metrics.load_high_events_total / days) * 5
  ) * multiplier;

  const pillar: PillarScores = {
    safety: clamp(100 - safetyPenalty, 20, 100),
    idling: clamp(100 - idlingPenalty, 15, 100),
    fuel: clamp(100 - fuelPenalty, 20, 100),
    dvir: clamp(100 - compliancePenalty, 20, 100),
    maintenance: clamp(100 - maintenancePenalty, 20, 100),
  };

  const totalScore =
    pillar.safety * (weights.safety / 100) +
    pillar.idling * (weights.idling / 100) +
    pillar.fuel * (weights.fuel / 100) +
    pillar.dvir * (weights.dvir / 100) +
    pillar.maintenance * (weights.maintenance / 100);

  const roundedTotal = Math.round(totalScore);
  // Tier will be assigned by percentile after all drivers are scored
  const tier: DriverScoreRow["tier"] = "on_track"; // Placeholder, reassigned later

  const weakest = Object.entries(pillar).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "safety";

  return {
    key: metrics.driver_id,
    driver: metrics.driver_name,
    trucks: [metrics.truck_unit_number],
    lastLocation: "",
    totalScore: roundedTotal,
    tier,
    pillar,
    speedingCount: metrics.speeding_violations_total,
    harshBrakingCount: metrics.harsh_braking_total,
    harshAccelCount: metrics.harsh_accel_total,
    faultCount: metrics.fault_codes_total,
    maintenanceAlertsCount: metrics.maintenance_alerts_total,
    dvirDefectsCount: metrics.dvir_defects_total,
    lowFuelEventsCount: metrics.low_fuel_events_total,
    idleRatio,
    avgFuelLevel,
  };
}

function tierStyles(tier: DriverScoreRow["tier"]) {
  if (tier === "top_performer") {
    return {
      badge: "border-emerald-500/70 bg-emerald-900/30 text-emerald-200",
      card: "border-emerald-700/40",
      label: "Top 10%",
    };
  }
  if (tier === "action_needed") {
    return {
      badge: "border-rose-500/70 bg-rose-900/35 text-rose-200",
      card: "border-rose-700/40",
      label: "Below Avg",
    };
  }
  return {
    badge: "border-slate-500/70 bg-slate-800/30 text-slate-300",
    card: "border-slate-700/40",
    label: "Average",
  };
}

export default function DriverRankingPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ ready: false, role: null, username: null });
  const canAccessDriverReport = session.role === "management" || session.role === "maintenance";
  const isHkManager = session.username === "hkmanager";
  const [windowDays, setWindowDays] = useState<TimeWindow>("30");
  const [infoOpen, setInfoOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [driverDirectory, setDriverDirectory] = useState<DriverDirectoryRow[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AggregatedDriverMetrics[]>([]);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [expandedDriverEvents, setExpandedDriverEvents] = useState<{
    driver_id: string;
    start_date: string;
    end_date: string;
    total_events: number;
    events_by_date: Record<string, Record<string, unknown[]>>;
    raw_events: EventDetail[];
    query_time_ms: number;
  } | null>(null);
  const [expandedEventsLoading, setExpandedEventsLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionRole = window.sessionStorage.getItem("demoRole");
    const sessionUsername = window.sessionStorage.getItem("demoUsername") ?? null;
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    setSession({ ready: true, role: normalizedRole, username: sessionUsername });
  }, []);

  useEffect(() => {
    if (session.ready && !canAccessDriverReport) {
      router.replace("/fleet");
    }
  }, [canAccessDriverReport, router, session.ready]);

  useEffect(() => {
    if (!session.ready || !canAccessDriverReport) {
      return;
    }

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [vehicleResponse, faultResponse, driverResponse] = await Promise.all([
          fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" }),
          fetch(FLEET_API_ROUTES.faultCodes, { cache: "no-store" }),
          fetch("/api/drivers", { cache: "no-store" }),
        ]);

        const vehiclePayload = (await vehicleResponse.json()) as {
          vehicles?: LiveVehicle[];
          error?: string;
        };

        const faultPayload = (await faultResponse.json()) as {
          faults?: FaultRecord[];
          error?: string;
        };

        const driverPayload = (await driverResponse.json()) as {
          drivers?: DriverDirectoryRow[];
        };

        if (!vehicleResponse.ok && !faultResponse.ok) {
          setError(vehiclePayload.error ?? faultPayload.error ?? "Unable to load driver ranking data.");
          return;
        }

        setVehicles(vehicleResponse.ok ? vehiclePayload.vehicles ?? [] : []);
        setFaults(faultResponse.ok ? faultPayload.faults ?? [] : []);
        setDriverDirectory(driverResponse.ok ? driverPayload.drivers ?? [] : []);
      } catch {
        setError("Network error while loading live driver metrics.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [canAccessDriverReport, session.ready]);

  // Fetch aggregated analytics data
  useEffect(() => {
    async function loadAnalytics() {
      try {
        const response = await fetch(`/api/analytics/driver-window?days=${windowDays}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json();
          setAnalyticsData(data.drivers ?? []);
        } else {
          setError("Failed to load driver analytics");
        }
      } catch {
        setError("Network error loading analytics");
      }
    }
    void loadAnalytics();
  }, [windowDays]);

  const weightedFormula = useMemo(() => {
    const w = normalizedWeights(DEFAULT_WEIGHTS);
    return `DPI = ${w.safety.toFixed(2)}(Safety) + ${w.idling.toFixed(2)}(Idling) + ${w.fuel.toFixed(2)}(Fuel) + ${w.dvir.toFixed(2)}(DVIR) + ${w.maintenance.toFixed(2)}(Maintenance)`;
  }, []);

  const rankingRows = useMemo(() => {
    // Load aggregated analytics data
    const multiplier = WINDOW_MULTIPLIER[windowDays];
    
    if (analyticsData.length === 0) {
      return [];
    }

    const rows = analyticsData
      .map((metrics) => scoreDriverFromAnalytics(metrics, multiplier, DEFAULT_WEIGHTS))
      .sort((a, b) => b.totalScore - a.totalScore);

    // Assign percentile-based tiers
    if (rows.length > 0) {
      const count = rows.length;
      rows.forEach((row, index) => {
        const percentile = ((index + 1) / count) * 100;
        
        if (percentile <= 10) {
          row.tier = "top_performer"; // Top 10%
        } else if (percentile <= 50) {
          row.tier = "on_track"; // Average (Top 25% to 50th percentile)
        } else {
          row.tier = "action_needed"; // Below average
        }
        row.percentile = percentile;
      });
    }

    return rows;
  }, [analyticsData, windowDays]);

  const summary = useMemo(() => {
    const topPerformers = rankingRows.filter((row) => row.tier === "top_performer").length;
    const actionNeeded = rankingRows.filter((row) => row.tier === "action_needed").length;
    const avgScore =
      rankingRows.length > 0
        ? Math.round(rankingRows.reduce((sum, row) => sum + row.totalScore, 0) / rankingRows.length)
        : 0;
    return {
      drivers: rankingRows.length,
      topPerformers,
      actionNeeded,
      avgScore,
    };
  }, [rankingRows]);

  const topRewards = useMemo(() => rankingRows.filter((row) => row.tier === "top_performer").slice(0, 3), [rankingRows]);
  const interventionQueue = useMemo(() => {
    return [...rankingRows]
      .filter((row) => row.tier === "action_needed")
      .sort((a, b) => a.totalScore - b.totalScore)
      .slice(0, 4);
  }, [rankingRows]);

  async function refreshData() {
    setRefreshing(true);
    try {
      const [vehicleResponse, faultResponse, driverResponse, analyticsResponse] = await Promise.all([
        fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" }),
        fetch(FLEET_API_ROUTES.faultCodes, { cache: "no-store" }),
        fetch("/api/drivers", { cache: "no-store" }),
        fetch(`/api/analytics/driver-window?days=${windowDays}`, { cache: "no-store" }),
      ]);

      const vehiclePayload = (await vehicleResponse.json()) as { vehicles?: LiveVehicle[] };
      const faultPayload = (await faultResponse.json()) as { faults?: FaultRecord[] };
      const driverPayload = (await driverResponse.json()) as { drivers?: DriverDirectoryRow[] };
      const analyticsPayload = (await analyticsResponse.json()) as { drivers?: AggregatedDriverMetrics[] };

      setVehicles(vehicleResponse.ok ? vehiclePayload.vehicles ?? [] : []);
      setFaults(faultResponse.ok ? faultPayload.faults ?? [] : []);
      setDriverDirectory(driverPayload.drivers ?? []);
      if (analyticsResponse.ok) setAnalyticsData(analyticsPayload.drivers ?? []);
      setError(null);
    } catch {
      setError("Unable to refresh live driver metrics right now.");
    } finally {
      setRefreshing(false);
    }
  }



  async function loadEventsForDriver(driverId: string) {
    setExpandedEventsLoading(true);
    try {
      const today = new Date();
      const endDate = today.toISOString().split("T")[0];
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - parseInt(windowDays));
      const startDateStr = startDate.toISOString().split("T")[0];

      const response = await fetch(
        `/api/analytics/driver-events?driver_id=${driverId}&start_date=${startDateStr}&end_date=${endDate}`,
        { cache: "no-store" }
      );

      if (response.ok) {
        const data = await response.json();
        setExpandedDriverEvents(data);
      }
    } catch (err) {
      console.error("Failed to load events:", err);
    } finally {
      setExpandedEventsLoading(false);
    }
  }

  function handleExpandDriver(driverId: string) {
    const isExpanded = expandedDriverId === driverId;
    setExpandedDriverId(isExpanded ? null : driverId);
    if (!isExpanded) {
      void loadEventsForDriver(driverId);
    } else {
      setExpandedDriverEvents(null);
    }
  }

  if (!session.ready) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading Driver Ranking...</main>;
  }

  if (!canAccessDriverReport) {
    return <main className="min-h-screen grid place-items-center text-rose-300">Management or maintenance access only.</main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 md:px-6 md:py-8">
      <section className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-cyan-100 md:text-2xl">Driver Ranking</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInfoOpen(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              DPI Help
            </button>

            <button
              onClick={refreshData}
              className="rounded-md border border-cyan-700/70 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-900/40"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>

            <button
              onClick={() => router.back()}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              ← Back
            </button>
          </div>
        </div>

        {error ? (
          <section className="rounded-xl border border-rose-700/40 bg-rose-950/25 p-3 text-sm text-rose-200">{error}</section>
        ) : null}

        <section className="rounded-xl border border-slate-800 bg-slate-900/65 p-4">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex flex-col">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Drivers Ranked</p>
              <p className="text-2xl font-semibold text-slate-100">{summary.drivers}</p>
            </div>
            <div className="hidden border-r border-slate-700/50 sm:block" style={{ height: "40px" }} />
            <div className="flex flex-col">
              <p className="text-[11px] uppercase tracking-wide text-emerald-300/80">Top 10%</p>
              <p className="text-2xl font-semibold text-emerald-200">{summary.topPerformers}</p>
            </div>
            <div className="hidden border-r border-slate-700/50 sm:block" style={{ height: "40px" }} />
            <div className="flex flex-col">
              <p className="text-[11px] uppercase tracking-wide text-rose-300/80">Below Average</p>
              <p className="text-2xl font-semibold text-rose-200">{summary.actionNeeded}</p>
            </div>

          </div>
        </section>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Time Window</p>
          <div className="grid grid-cols-3 gap-2">
            {(["7", "30", "60"] as TimeWindow[]).map((option) => {
              const active = windowDays === option;
              return (
                <button
                  key={option}
                  onClick={() => setWindowDays(option)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "border-cyan-500 bg-cyan-900/40 text-cyan-100"
                      : "border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {WINDOW_LABELS[option]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-400">{WINDOW_NOTES[windowDays]}</p>
        </div>


        {loading ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/65 p-4 text-sm text-slate-300">Loading live driver telemetry...</section>
        ) : null}

        {!loading ? (
          <section className="space-y-2 pb-10 md:pb-6">
            {rankingRows.map((row, index) => {
              const styles = tierStyles(row.tier);
              const isExpanded = expandedDriverId === row.key;
              // Transform raw events into weekly heatmap structure
              const heatmapCells =
                expandedDriverEvents?.raw_events && expandedDriverEvents.raw_events.length > 0
                  ? createWeeklyHeatmap(expandedDriverEvents.raw_events, parseInt(windowDays))
                  : [];
              return (
                <article
                  key={row.key}
                  className={`cursor-pointer rounded-lg border transition ${styles.card} bg-slate-900/65 p-2 hover:bg-slate-900/80 md:p-3`}
                  onClick={() => handleExpandDriver(row.key)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="text-xs text-slate-500">#{index + 1}</p>
                        <h3 className="text-sm font-semibold text-slate-100">{row.driver}</h3>
                      </div>
                      <p className="text-xs text-slate-400">Unit {row.trucks.join(" • ")}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles.badge}`}>
                        {styles.label}
                      </span>
                      <div className="flex items-baseline gap-1">
                        <p className="text-sm text-slate-400">{row.totalScore}</p>
                        <p className="text-[10px] text-slate-500">DPI</p>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2 -mx-2 space-y-2 border-t border-slate-700/40 px-2 pt-2">
                      {/* Unified Incident History Heatmap */}
                      {expandedEventsLoading ? (
                        <div className="rounded-md border border-slate-700/60 bg-slate-900/80 px-2 py-2 text-xs text-slate-400">
                          Loading detailed incident history...
                        </div>
                      ) : heatmapCells && heatmapCells.length > 0 ? (
                        <IncidentHeatmap
                          cells={heatmapCells}
                          totalEvents={expandedDriverEvents?.total_events || 0}
                          windowDays={parseInt(windowDays)}
                        />
                      ) : null}
                    </div>
                  )}
                </article>
              );
            })}

            {rankingRows.length === 0 ? (
              <article className="rounded-xl border border-slate-800 bg-slate-900/65 p-4 text-sm text-slate-300">
                No driver telemetry could be scored. Confirm Samsara key scope and assignment mapping.
              </article>
            ) : null}
          </section>
        ) : null}

      </section>

      {infoOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/75 p-2 backdrop-blur-sm md:items-center md:justify-center md:p-3">
          <div className="flex max-h-[90vh] w-full max-w-xs flex-col rounded-2xl border border-slate-700 bg-slate-900 md:max-w-2xl">
            <div className="sticky top-0 flex shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 p-3 md:p-4">
              <h2 className="text-sm font-semibold text-cyan-100 md:text-base">DPI Methodology</h2>
              <button
                onClick={() => setInfoOpen(false)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
              <p className="text-sm text-slate-300">
                DPI is a weighted composite score to help owner-level reward and disciplinary decisions. The score is
                normalized to 0-100 and combines five operational pillars.
              </p>
              <p className="mt-2 rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] font-medium text-cyan-100 md:text-sm">
                {weightedFormula}
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>Safety: event pressure from alerts, speeding, and fault load.</li>
                <li>Idling: idle exposure against active engine runtime.</li>
                <li>Fuel: low-fuel behavior and consumption discipline signals.</li>
                <li>DVIR/Compliance: recurring fault burden and compliance pressure.</li>
                <li>Maintenance: engine stress indicators from telemetry.</li>
              </ul>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PILLARS.map((pillar) => (
                  <article key={pillar.key} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-100">{pillar.title}</h3>
                      <span className="rounded-full border border-cyan-800/60 bg-cyan-900/30 px-2 py-0.5 text-[10px] text-cyan-200">
                        {pillar.weight}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-300">{pillar.summary}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{pillar.hint}</p>
                  </article>
                ))}
              </div>
              <p className="mt-3 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                The live snapshot is directional and best used for weekly action reviews. For payroll-impact actions,
                pair this with verified incident and policy records.
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Management usage: reward consistent top performers, coach monitor-tier drivers, and execute immediate
                intervention plans for low-score drivers.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
