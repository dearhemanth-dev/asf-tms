"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { FLEET_API_ROUTES } from "@/lib/fleet-api";

type TimeWindow = "7" | "30" | "60";

type SessionState = {
  ready: boolean;
  role: AppRole | null;
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
  tier: "reward" | "monitor" | "intervene";
  pillar: PillarScores;
  faultCount: number;
  alertCount: number;
  speedingCount: number;
  idleRatio: number;
  avgFuelLevel: number | null;
  riskSummary: string;
};

type DriverAccumulator = {
  key: string;
  driver: string;
  trucks: Set<string>;
  lastLocation: string;
  faultCount: number;
  alertCount: number;
  speedingCount: number;
  engineMinutes: number;
  idlingMinutes: number;
  lowFuelCount: number;
  fuelSamples: number[];
  complianceHits: number;
  maintenancePressure: number;
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

function normalizeDriverName(name: string, truckNo?: string) {
  const normalized = name.trim();
  if (!normalized || normalized.toLowerCase() === "unassigned") {
    return truckNo ? `Driver ${truckNo}` : "Driver";
  }
  return normalized;
}

function normalizeUnitKey(value: string) {
  return value
    .toUpperCase()
    .replace(/^TRUCK\s*#?\s*/i, "")
    .replace(/^UNIT\s*#?\s*/i, "")
    .replace(/[^A-Z0-9]/g, "");
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

function initAccumulator(driverKey: string): DriverAccumulator {
  return {
    key: driverKey,
    driver: driverKey,
    trucks: new Set<string>(),
    lastLocation: "Location unavailable",
    faultCount: 0,
    alertCount: 0,
    speedingCount: 0,
    engineMinutes: 0,
    idlingMinutes: 0,
    lowFuelCount: 0,
    fuelSamples: [],
    complianceHits: 0,
    maintenancePressure: 0,
  };
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

function scoreDriver(acc: DriverAccumulator, multiplier: number, weights: WeightState): DriverScoreRow {
  const idleRatio = acc.engineMinutes > 0 ? clamp(acc.idlingMinutes / acc.engineMinutes, 0, 1.5) : 0;
  const avgFuelLevel = acc.fuelSamples.length
    ? acc.fuelSamples.reduce((sum, value) => sum + value, 0) / acc.fuelSamples.length
    : null;

  const safetyPenalty = (acc.faultCount * 5 + acc.alertCount * 12 + acc.speedingCount * 8) * multiplier;
  const idlingPenalty = idleRatio * 75 * multiplier;
  const fuelPenalty = ((avgFuelLevel === null ? 22 : Math.abs(avgFuelLevel - 58) * 0.95) + acc.lowFuelCount * 9) * multiplier;
  const compliancePenalty = (acc.complianceHits * 11 + acc.faultCount * 4) * multiplier;
  const maintenancePenalty = acc.maintenancePressure * 8 * multiplier;

  const pillar: PillarScores = {
    safety: clamp(100 - safetyPenalty, 20, 100),
    idling: clamp(100 - idlingPenalty, 15, 100),
    fuel: clamp(100 - fuelPenalty, 20, 100),
    dvir: clamp(100 - compliancePenalty, 20, 100),
    maintenance: clamp(100 - maintenancePenalty, 20, 100),
  };

  const w = normalizedWeights(weights);

  const totalScore =
    pillar.safety * w.safety +
    pillar.idling * w.idling +
    pillar.fuel * w.fuel +
    pillar.dvir * w.dvir +
    pillar.maintenance * w.maintenance;

  const roundedTotal = Math.round(totalScore);
  const tier: DriverScoreRow["tier"] = roundedTotal >= 82 ? "reward" : roundedTotal >= 67 ? "monitor" : "intervene";

  const weakest = Object.entries(pillar).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "safety";
  const riskSummary =
    weakest === "idling"
      ? "High idle exposure relative to engine activity"
      : weakest === "maintenance"
        ? "Engine stress indicators suggest maintenance risk"
        : weakest === "fuel"
          ? "Fuel discipline variance is above fleet baseline"
          : weakest === "dvir"
            ? "Compliance and fault-pressure needs immediate focus"
            : "Safety behavior trend is below target";

  return {
    key: acc.key,
    driver: acc.driver,
    trucks: Array.from(acc.trucks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })),
    lastLocation: acc.lastLocation,
    totalScore: roundedTotal,
    tier,
    pillar,
    faultCount: acc.faultCount,
    alertCount: acc.alertCount,
    speedingCount: acc.speedingCount,
    idleRatio,
    avgFuelLevel,
    riskSummary,
  };
}

function tierStyles(tier: DriverScoreRow["tier"]) {
  if (tier === "reward") {
    return {
      badge: "border-emerald-500/70 bg-emerald-900/30 text-emerald-200",
      card: "border-emerald-700/40",
      label: "Reward Candidate",
    };
  }
  if (tier === "intervene") {
    return {
      badge: "border-rose-500/70 bg-rose-900/35 text-rose-200",
      card: "border-rose-700/40",
      label: "Intervention Queue",
    };
  }
  return {
    badge: "border-amber-500/70 bg-amber-900/25 text-amber-200",
    card: "border-amber-700/35",
    label: "Monitor",
  };
}

export default function DriverRankingPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ ready: false, role: null });
  const [windowDays, setWindowDays] = useState<TimeWindow>("30");
  const [infoOpen, setInfoOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [driverDirectory, setDriverDirectory] = useState<DriverDirectoryRow[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionRole = window.sessionStorage.getItem("demoRole");
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    setSession({ ready: true, role: normalizedRole });
  }, []);

  useEffect(() => {
    if (session.ready && session.role !== "management") {
      router.replace("/fleet");
    }
  }, [router, session.ready, session.role]);

  useEffect(() => {
    if (!session.ready || session.role !== "management") {
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
  }, [session.ready, session.role]);

  const weightedFormula = useMemo(() => {
    const w = normalizedWeights(DEFAULT_WEIGHTS);
    return `DPI = ${w.safety.toFixed(2)}(Safety) + ${w.idling.toFixed(2)}(Idling) + ${w.fuel.toFixed(2)}(Fuel) + ${w.dvir.toFixed(2)}(DVIR) + ${w.maintenance.toFixed(2)}(Maintenance)`;
  }, []);

  const rankingRows = useMemo(() => {
    const multiplier = WINDOW_MULTIPLIER[windowDays];
    const driverMap = new Map<string, DriverAccumulator>();
    const vehicleToDriver = new Map<string, string>();
    const unitToDriver = new Map<string, string>();
    const driverByUnit = new Map<string, string>();

    for (const row of driverDirectory) {
      const key = normalizeUnitKey(row.assignedTruckUnitNumber || "");
      if (!key) continue;
      const fullName = String(row.fullName ?? "").trim();
      if (!fullName) continue;
      driverByUnit.set(key, fullName);
    }

    for (const vehicle of vehicles) {
      const unit = normalizeUnitKey(vehicle.truckNo || "");
      const resolvedName = (unit ? driverByUnit.get(unit) : undefined) ?? vehicle.driver;
      const driverKey = normalizeDriverName(resolvedName, vehicle.truckNo);
      const existing = driverMap.get(driverKey) ?? initAccumulator(driverKey);

      existing.driver = driverKey;
      existing.trucks.add(vehicle.truckNo || "Unknown");
      existing.lastLocation = vehicle.location || existing.lastLocation;
      existing.alertCount += vehicle.status === "alert" ? 1 : 0;
      existing.speedingCount += (vehicle.mph ?? 0) >= 67 ? 1 : 0;

      if (typeof vehicle.fuelLevel === "number" && Number.isFinite(vehicle.fuelLevel)) {
        existing.fuelSamples.push(vehicle.fuelLevel);
        if (vehicle.fuelLevel <= 15) {
          existing.lowFuelCount += 1;
        }
      }

      if (unit) {
        unitToDriver.set(unit, driverKey);
      }
      vehicleToDriver.set(vehicle.id, driverKey);
      driverMap.set(driverKey, existing);
    }

    for (const fault of faults) {
      const viaVehicleId = fault.vehicleId ? vehicleToDriver.get(String(fault.vehicleId)) : undefined;
      const viaUnit = fault.vehicleName ? unitToDriver.get(normalizeUnitKey(String(fault.vehicleName))) : undefined;
      const lookupName = fault.vehicleName ? driverByUnit.get(normalizeUnitKey(String(fault.vehicleName))) : undefined;
      const driverKey = viaVehicleId ?? viaUnit ?? normalizeDriverName(lookupName ?? "", fault.vehicleName);

      const existing = driverMap.get(driverKey) ?? initAccumulator(driverKey);
      if (fault.vehicleName) {
        existing.trucks.add(String(fault.vehicleName));
      }

      const stats = fault.stats;
      const idlingMs = pickStat(stats, ["idlingDurationMilliseconds"]);
      if (idlingMs !== null) {
        existing.idlingMinutes += clamp(idlingMs / 60000, 0, 24 * 60);
      }

      const engineSeconds = pickStat(stats, ["obdEngineSeconds"]);
      if (engineSeconds !== null) {
        existing.engineMinutes += clamp(engineSeconds / 60, 0, 24 * 60);
      }

      const coolantTempC = pickStat(stats, ["engineCoolantTemperatureMilliC"]);
      if (coolantTempC !== null) {
        const tempC = coolantTempC > 1000 ? coolantTempC / 1000 : coolantTempC;
        if (tempC >= 105) existing.maintenancePressure += 1;
      }

      const oilPressure = pickStat(stats, ["engineOilPressureKPa"]);
      if (oilPressure !== null && oilPressure < 110) {
        existing.maintenancePressure += 1;
      }

      const rpm = pickStat(stats, ["engineRpm"]);
      if (rpm !== null && rpm > 2500) {
        existing.maintenancePressure += 1;
      }

      const engineLoad = pickStat(stats, ["engineLoadPercent"]);
      if (engineLoad !== null && engineLoad > 92) {
        existing.maintenancePressure += 1;
      }

      const faultCount = countFaultCodes(fault.faultCodes);
      existing.faultCount += faultCount;
      if (faultCount > 0) {
        existing.complianceHits += 1;
      }

      driverMap.set(driverKey, existing);
    }

    return Array.from(driverMap.values())
      .map((acc) => scoreDriver(acc, multiplier, DEFAULT_WEIGHTS))
      .sort((a, b) => b.totalScore - a.totalScore);
  }, [driverDirectory, faults, vehicles, windowDays]);

  const summary = useMemo(() => {
    const reward = rankingRows.filter((row) => row.tier === "reward").length;
    const intervene = rankingRows.filter((row) => row.tier === "intervene").length;
    const avgScore =
      rankingRows.length > 0
        ? Math.round(rankingRows.reduce((sum, row) => sum + row.totalScore, 0) / rankingRows.length)
        : 0;
    return {
      drivers: rankingRows.length,
      reward,
      intervene,
      avgScore,
    };
  }, [rankingRows]);

  const topRewards = useMemo(() => rankingRows.filter((row) => row.tier === "reward").slice(0, 3), [rankingRows]);
  const interventionQueue = useMemo(() => {
    return [...rankingRows]
      .filter((row) => row.tier === "intervene")
      .sort((a, b) => a.totalScore - b.totalScore)
      .slice(0, 4);
  }, [rankingRows]);

  async function refreshData() {
    setRefreshing(true);
    try {
      const [vehicleResponse, faultResponse, driverResponse] = await Promise.all([
        fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" }),
        fetch(FLEET_API_ROUTES.faultCodes, { cache: "no-store" }),
        fetch("/api/drivers", { cache: "no-store" }),
      ]);

      const vehiclePayload = (await vehicleResponse.json()) as { vehicles?: LiveVehicle[] };
      const faultPayload = (await faultResponse.json()) as { faults?: FaultRecord[] };
      const driverPayload = (await driverResponse.json()) as {
        drivers?: DriverDirectoryRow[];
      };

      setVehicles(vehicleResponse.ok ? vehiclePayload.vehicles ?? [] : []);
      setFaults(faultResponse.ok ? faultPayload.faults ?? [] : []);
      setDriverDirectory(driverPayload.drivers ?? []);
      setError(null);
    } catch {
      setError("Unable to refresh live driver metrics right now.");
    } finally {
      setRefreshing(false);
    }
  }

  if (!session.ready) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading Driver Ranking...</main>;
  }

  if (session.role !== "management") {
    return <main className="min-h-screen grid place-items-center text-rose-300">Management access only.</main>;
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
              onClick={() => setMetricsOpen(true)}
              className="rounded-md border border-amber-700/70 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/35"
            >
              Driver Metrics
            </button>
            <button
              onClick={refreshData}
              className="rounded-md border border-cyan-700/70 bg-cyan-950/30 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-900/40"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <Link
              href="/reports/vehicle-ranking"
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              Vehicle Report
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-900/45 bg-slate-900/70 p-4 shadow-lg">
          <p className="text-sm text-slate-200">
            Live operational view for reward and intervention decisions.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            All DPI methodology and scoring literature is available in the DPI Help popup.
          </p>
        </div>

        {error ? (
          <section className="rounded-xl border border-rose-700/40 bg-rose-950/25 p-3 text-sm text-rose-200">{error}</section>
        ) : null}

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <article className="rounded-xl border border-slate-800 bg-slate-900/65 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Drivers Ranked</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{summary.drivers}</p>
          </article>
          <article className="rounded-xl border border-emerald-700/35 bg-slate-900/65 p-3">
            <p className="text-[11px] uppercase tracking-wide text-emerald-300/80">Reward Candidates</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-200">{summary.reward}</p>
          </article>
          <article className="rounded-xl border border-rose-700/35 bg-slate-900/65 p-3">
            <p className="text-[11px] uppercase tracking-wide text-rose-300/80">Intervention Queue</p>
            <p className="mt-1 text-2xl font-semibold text-rose-200">{summary.intervene}</p>
          </article>
          <article className="rounded-xl border border-cyan-700/35 bg-slate-900/65 p-3">
            <p className="text-[11px] uppercase tracking-wide text-cyan-200/80">Fleet Avg DPI</p>
            <p className="mt-1 text-2xl font-semibold text-cyan-100">{summary.avgScore}</p>
          </article>
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

        <section className="grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border border-emerald-700/35 bg-slate-900/65 p-4">
            <h3 className="text-sm font-semibold text-emerald-200">Top Reward Candidates</h3>
            <div className="mt-3 space-y-2">
              {topRewards.length === 0 ? (
                <p className="text-xs text-slate-400">No high-confidence reward candidates in this window.</p>
              ) : (
                topRewards.map((row, index) => (
                  <div key={row.key} className="rounded-lg border border-emerald-800/35 bg-slate-950/55 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-100">
                      #{index + 1} {row.driver}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">DPI {row.totalScore} | Trucks: {row.trucks.join(", ")}</p>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-xl border border-rose-700/35 bg-slate-900/65 p-4">
            <h3 className="text-sm font-semibold text-rose-200">Immediate Intervention Queue</h3>
            <div className="mt-3 space-y-2">
              {interventionQueue.length === 0 ? (
                <p className="text-xs text-slate-400">No urgent intervention queue in this window.</p>
              ) : (
                interventionQueue.map((row) => (
                  <div key={row.key} className="rounded-lg border border-rose-800/35 bg-slate-950/55 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-100">{row.driver}</p>
                    <p className="mt-1 text-xs text-slate-300">DPI {row.totalScore} | {row.riskSummary}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        {loading ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/65 p-4 text-sm text-slate-300">Loading live driver telemetry...</section>
        ) : null}

        {!loading ? (
          <section className="space-y-3">
            {rankingRows.map((row, index) => {
              const styles = tierStyles(row.tier);
              return (
                <article key={row.key} className={`rounded-xl border bg-slate-900/65 p-4 ${styles.card}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">Rank #{index + 1}</p>
                      <h3 className="text-base font-semibold text-slate-100">{row.driver}</h3>
                      <p className="mt-1 text-xs text-slate-400">Truck(s): {row.trucks.join(", ")}</p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles.badge}`}>
                        {styles.label}
                      </span>
                      <p className="mt-1 text-2xl font-semibold text-cyan-100">{row.totalScore}</p>
                      <p className="text-[11px] text-slate-400">DPI</p>
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-slate-300">{row.riskSummary}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Last seen: {row.lastLocation}</p>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-slate-400">Faults</p>
                      <p className="font-semibold text-slate-100">{row.faultCount}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-slate-400">Alerts</p>
                      <p className="font-semibold text-slate-100">{row.alertCount}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-slate-400">Speeding Flags</p>
                      <p className="font-semibold text-slate-100">{row.speedingCount}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5">
                      <p className="text-slate-400">Idle Ratio</p>
                      <p className="font-semibold text-slate-100">{Math.round(row.idleRatio * 100)}%</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {([
                      ["Safety", row.pillar.safety],
                      ["Idling", row.pillar.idling],
                      ["Fuel", row.pillar.fuel],
                      ["Compliance", row.pillar.dvir],
                      ["Maintenance", row.pillar.maintenance],
                    ] as Array<[string, number]>).map(([label, score]) => (
                      <div key={label}>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">{label}</span>
                          <span className="font-medium text-slate-200">{Math.round(score)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400"
                            style={{ width: `${clamp(score, 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
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
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/75 p-3 backdrop-blur-sm md:items-center md:justify-center">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-4 md:p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-cyan-100">DPI Methodology</h2>
              <button
                onClick={() => setInfoOpen(false)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              DPI is a weighted composite score to help owner-level reward and disciplinary decisions. The score is
              normalized to 0-100 and combines five operational pillars.
            </p>
            <p className="mt-2 rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm font-medium text-cyan-100">
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
      ) : null}

      {metricsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/75 p-3 backdrop-blur-sm md:items-center md:justify-center">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-4 md:p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-amber-100">Driver Metrics Snapshot</h2>
              <button
                onClick={() => setMetricsOpen(false)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Mobile-first numeric table view. Use this for fast, objective metric checks without sliders.
            </p>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
                <h3 className="text-sm font-semibold text-slate-100">Pillar Weights</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="px-2 py-2 font-medium">Pillar</th>
                        <th className="px-2 py-2 font-medium">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PILLARS.map((pillar) => (
                        <tr key={pillar.key} className="border-b border-slate-900 last:border-b-0">
                          <td className="px-2 py-2 text-slate-200">{pillar.title}</td>
                          <td className="px-2 py-2 font-medium text-amber-200">{pillar.weight}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">{weightedFormula}</p>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
                <h3 className="text-sm font-semibold text-slate-100">Driver Numeric Metrics</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-[760px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="px-2 py-2 font-medium">Driver</th>
                        <th className="px-2 py-2 font-medium">DPI</th>
                        <th className="px-2 py-2 font-medium">Faults</th>
                        <th className="px-2 py-2 font-medium">Alerts</th>
                        <th className="px-2 py-2 font-medium">Speeding</th>
                        <th className="px-2 py-2 font-medium">Idle %</th>
                        <th className="px-2 py-2 font-medium">Fuel %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-2 py-3 text-slate-400">
                            No live driver metrics available.
                          </td>
                        </tr>
                      ) : (
                        rankingRows.map((row) => (
                          <tr key={`metrics-${row.key}`} className="border-b border-slate-900 last:border-b-0">
                            <td className="px-2 py-2 text-slate-100">{row.driver}</td>
                            <td className="px-2 py-2 font-semibold text-cyan-100">{row.totalScore}</td>
                            <td className="px-2 py-2 text-slate-200">{row.faultCount}</td>
                            <td className="px-2 py-2 text-slate-200">{row.alertCount}</td>
                            <td className="px-2 py-2 text-slate-200">{row.speedingCount}</td>
                            <td className="px-2 py-2 text-slate-200">{Math.round(row.idleRatio * 100)}%</td>
                            <td className="px-2 py-2 text-slate-200">{row.avgFuelLevel === null ? "n/a" : `${Math.round(row.avgFuelLevel)}%`}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
