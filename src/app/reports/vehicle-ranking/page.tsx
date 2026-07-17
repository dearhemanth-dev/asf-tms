"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { FLEET_API_ROUTES } from "@/lib/fleet-api";

type LiveVehicle = {
  id: string;
  truckNo: string;
  driver: string;
  location: string;
  status: "moving" | "idle" | "alert";
  mph?: number;
};

type AssetRow = {
  asset_no: string;
  asset_unit_number: string;
  ownership_type: string;
};

type SessionState = {
  ready: boolean;
  role: AppRole | null;
  username: string;
};

type RankingRow = {
  vehicleNumber: string;
  rank: number;
  status: "moving" | "idle" | "alert" | "asset-only";
  liveVehicle?: LiveVehicle;
  asset?: AssetRow;
  cost30: string;
  cost60: string;
  revenue30: string;
  revenue60: string;
  uptime30Runtime: string;
  uptime30Idle: string;
  uptime30Dwell: string;
  uptime30Parked: string;
  uptime60Runtime: string;
  uptime60Idle: string;
  uptime60Dwell: string;
  uptime60Parked: string;
  currentValue: string;
  replacementWindow: string;
};

const PLACEHOLDER = "—";

function normalizeKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function statusSortWeight(status: RankingRow["status"]) {
  if (status === "moving") return 0;
  if (status === "idle") return 1;
  if (status === "asset-only") return 2;
  return 3;
}

function displayValue(value?: string | null) {
  return value?.trim() || PLACEHOLDER;
}

function statusLabel(status: RankingRow["status"]) {
  if (status === "asset-only") return "asset only";
  return status;
}

export default function VehicleRankingReportPage() {
  const router = useRouter();
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const desktopScrollbarRef = useRef<HTMLDivElement | null>(null);
  const desktopScrollbarContentRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionState>({ ready: false, role: null, username: "" });
  const [liveVehicles, setLiveVehicles] = useState<LiveVehicle[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reverseRanking, setReverseRanking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sessionRole = window.sessionStorage.getItem("demoRole");
    const sessionUser = window.sessionStorage.getItem("demoUsername") ?? "";
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;

    setSession({ ready: true, role: normalizedRole, username: sessionUser });
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

    async function loadReport() {
      setLoading(true);
      setError(null);

      try {
        const [vehicleResponse, assetResponse] = await Promise.all([
          fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" }),
          fetch("/api/assets", { cache: "no-store" }),
        ]);

        const vehiclePayload = (await vehicleResponse.json()) as { vehicles?: LiveVehicle[]; error?: string };
        const assetPayload = (await assetResponse.json()) as { assets?: AssetRow[]; error?: string };

        if (!vehicleResponse.ok && !assetResponse.ok) {
          setError(vehiclePayload.error ?? assetPayload.error ?? "Unable to load report data.");
          return;
        }

        setLiveVehicles(vehicleResponse.ok ? vehiclePayload.vehicles ?? [] : []);
        setAssets(assetResponse.ok ? assetPayload.assets ?? [] : []);
      } catch {
        setError("Network error while loading report data.");
      } finally {
        setLoading(false);
      }
    }

    void loadReport();
  }, [session.ready, session.role]);

  useEffect(() => {
    const scrollContainer = desktopScrollRef.current;
    const scrollbar = desktopScrollbarRef.current;
    const scrollbarContent = desktopScrollbarContentRef.current;

    if (!scrollContainer || !scrollbar || !scrollbarContent) {
      return;
    }

    let syncingFromTable = false;
    let syncingFromBar = false;

    const syncScrollbarWidth = () => {
      scrollbarContent.style.width = `${scrollContainer.scrollWidth}px`;
      scrollbar.scrollLeft = scrollContainer.scrollLeft;
    };

    const handleTableScroll = () => {
      if (syncingFromBar) {
        syncingFromBar = false;
        return;
      }

      syncingFromTable = true;
      scrollbar.scrollLeft = scrollContainer.scrollLeft;
    };

    const handleScrollbarScroll = () => {
      if (syncingFromTable) {
        syncingFromTable = false;
        return;
      }

      syncingFromBar = true;
      scrollContainer.scrollLeft = scrollbar.scrollLeft;
    };

    const resizeObserver = new ResizeObserver(syncScrollbarWidth);
    resizeObserver.observe(scrollContainer);

    const table = scrollContainer.querySelector("table");
    if (table) {
      resizeObserver.observe(table);
    }

    syncScrollbarWidth();
    scrollContainer.addEventListener("scroll", handleTableScroll);
    scrollbar.addEventListener("scroll", handleScrollbarScroll);
    window.addEventListener("resize", syncScrollbarWidth);

    return () => {
      resizeObserver.disconnect();
      scrollContainer.removeEventListener("scroll", handleTableScroll);
      scrollbar.removeEventListener("scroll", handleScrollbarScroll);
      window.removeEventListener("resize", syncScrollbarWidth);
    };
  }, [assets, liveVehicles, loading]);

  const rows = useMemo(() => {
    const liveByKey = new Map<string, LiveVehicle>();
    for (const vehicle of liveVehicles) {
      liveByKey.set(normalizeKey(vehicle.truckNo), vehicle);
    }

    const assetByKey = new Map<string, AssetRow>();
    for (const asset of assets) {
      const keys = [asset.asset_no, asset.asset_unit_number]
        .map((value) => normalizeKey(value))
        .filter((value) => value.length > 0);

      for (const key of keys) {
        if (!assetByKey.has(key)) {
          assetByKey.set(key, asset);
        }
      }
    }

    const combinedKeys = Array.from(
      new Set([...Array.from(liveByKey.keys()), ...Array.from(assetByKey.keys())])
    ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

    return combinedKeys
      .map((key): RankingRow | null => {
        const liveVehicle = liveByKey.get(key);
        const asset = assetByKey.get(key);

        if (!liveVehicle && !asset) {
          return null;
        }

        const vehicleNumber = liveVehicle?.truckNo ?? asset?.asset_unit_number ?? asset?.asset_no ?? key;
        const status = liveVehicle?.status ?? "asset-only";

        return {
          vehicleNumber,
          rank: 0,
          status,
          liveVehicle,
          asset,
          cost30: PLACEHOLDER,
          cost60: PLACEHOLDER,
          revenue30: PLACEHOLDER,
          revenue60: PLACEHOLDER,
          uptime30Runtime: PLACEHOLDER,
          uptime30Idle: PLACEHOLDER,
          uptime30Dwell: PLACEHOLDER,
          uptime30Parked: PLACEHOLDER,
          uptime60Runtime: PLACEHOLDER,
          uptime60Idle: PLACEHOLDER,
          uptime60Dwell: PLACEHOLDER,
          uptime60Parked: PLACEHOLDER,
          currentValue: PLACEHOLDER,
          replacementWindow: PLACEHOLDER,
        };
      })
      .filter((row): row is RankingRow => row !== null)
      .sort((left, right) => {
        const statusDelta = statusSortWeight(left.status) - statusSortWeight(right.status);
        if (statusDelta !== 0) {
          return statusDelta;
        }

        return left.vehicleNumber.localeCompare(right.vehicleNumber, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      })
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }, [assets, liveVehicles]);

  const summary = useMemo(
    () => ({
      liveCount: liveVehicles.length,
      assetCount: assets.length,
      combinedCount: rows.length,
      movingCount: liveVehicles.filter((vehicle) => vehicle.status === "moving").length,
    }),
    [assets.length, liveVehicles, rows.length]
  );

  const displayedRows = useMemo(() => {
    if (!reverseRanking) {
      return rows;
    }

    return [...rows].reverse();
  }, [reverseRanking, rows]);

  async function refreshReport() {
    setRefreshing(true);
    try {
      const [vehicleResponse, assetResponse] = await Promise.all([
          fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" }),
        fetch("/api/assets", { cache: "no-store" }),
      ]);

      const vehiclePayload = (await vehicleResponse.json()) as { vehicles?: LiveVehicle[]; error?: string };
      const assetPayload = (await assetResponse.json()) as { assets?: AssetRow[]; error?: string };

      if (!vehicleResponse.ok && !assetResponse.ok) {
        setError(vehiclePayload.error ?? assetPayload.error ?? "Unable to load report data.");
        return;
      }

      setLiveVehicles(vehicleResponse.ok ? vehiclePayload.vehicles ?? [] : []);
      setAssets(assetResponse.ok ? assetPayload.assets ?? [] : []);
      setError(null);
    } catch {
      setError("Network error while loading report data.");
    } finally {
      setRefreshing(false);
    }
  }

  if (!session.ready) {
    return <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-300">Loading report...</main>;
  }

  if (session.role !== "management") {
    return <main className="min-h-screen grid place-items-center bg-slate-950 text-rose-300">Manager access required.</main>;
  }

  return (
    <main className="theme-light-flip theme-page-vehicle-ranking min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.16),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0b1220_48%,_#111827_100%)] text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-6">
        <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-3 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-4">
          <div className="flex flex-col gap-3">
            <button
              onClick={() => router.push("/fleet")}
              className="w-fit rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Back
            </button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Vehicle Ranking Report</h1>
                <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                  Vehicles: {summary.combinedCount} | Live: {summary.liveCount} | Assets: {summary.assetCount} | Moving: {summary.movingCount}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setReverseRanking((current) => !current)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition sm:flex-none ${
                    reverseRanking
                      ? "border-amber-400/40 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25"
                      : "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                  }`}
                >
                  {reverseRanking ? "Normal Ranking" : "Reverse Ranking"}
                </button>
                <button
                  onClick={() => void refreshReport()}
                  disabled={refreshing}
                  className="flex-1 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-70 sm:flex-none"
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </section>
        )}

        <section className="grid gap-3 lg:hidden">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-8 text-center text-sm text-slate-300">
              Loading vehicle ranking data...
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-8 text-center text-sm text-slate-300">
              No vehicles found yet. Connect the fleet provider and assets to populate the ranking report.
            </div>
          ) : (
            displayedRows.map((row, index) => (
              <article key={`${row.vehicleNumber}-${index}`} className="rounded-2xl border border-white/10 bg-slate-950/70 p-3 shadow-[0_16px_32px_rgba(2,6,23,0.35)]">
                <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Vehicle number</p>
                    <p className="mt-1 text-lg font-semibold text-white">{displayValue(row.vehicleNumber)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.liveVehicle ? `Live • ${row.liveVehicle.location}` : `Asset • ${row.asset?.ownership_type ?? PLACEHOLDER}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Rank</p>
                    <p className="mt-1 text-lg font-semibold text-cyan-100">{row.rank}</p>
                    <p className="mt-1 text-xs capitalize text-slate-400">{statusLabel(row.status)}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/8 p-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Cost per mile</p>
                    <div className="mt-2 space-y-1 text-slate-200">
                      <p>30D: {row.cost30}</p>
                      <p>60D: {row.cost60}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-200">Revenue per mile</p>
                    <div className="mt-2 space-y-1 text-slate-200">
                      <p>30D: {row.revenue30}</p>
                      <p>60D: {row.revenue60}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-amber-200">Uptime 30 days</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                    <p>Runtime: {row.uptime30Runtime}</p>
                    <p>Idle: {row.uptime30Idle}</p>
                    <p>Dwell: {row.uptime30Dwell}</p>
                    <p>Parked: {row.uptime30Parked}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/8 p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-fuchsia-200">Uptime 60 days</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-200">
                    <p>Runtime: {row.uptime60Runtime}</p>
                    <p>Idle: {row.uptime60Idle}</p>
                    <p>Dwell: {row.uptime60Dwell}</p>
                    <p>Parked: {row.uptime60Parked}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/8 p-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-sky-200">Asset value</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-200">
                    <p>Estimated current value: {row.currentValue}</p>
                    <p>Replacement window: {row.replacementWindow}</p>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>

        <section className="hidden overflow-hidden rounded-3xl border border-white/5 bg-slate-950/60 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl lg:block">
          <div ref={desktopScrollRef} className="desktop-scrollbar-hidden overflow-x-auto">
            <table className="min-w-[1600px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th rowSpan={2} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100">
                    Vehicle number
                  </th>
                  <th rowSpan={2} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100">
                    Rank
                  </th>
                  <th colSpan={2} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    Cost per mile
                  </th>
                  <th colSpan={2} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Revenue per mile
                  </th>
                  <th colSpan={4} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                    Uptime 30 days
                  </th>
                  <th colSpan={4} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-200">
                    Uptime 60 days
                  </th>
                  <th colSpan={2} className="border border-white/10 bg-slate-950 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                    Asset value
                  </th>
                </tr>
                <tr>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-cyan-100">30 days</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-cyan-100">60 days</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-emerald-100">30 days</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-emerald-100">60 days</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-amber-100">Runtime</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-amber-100">Idle time</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-amber-100">Dwell</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-amber-100">Parked</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-fuchsia-100">Runtime</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-fuchsia-100">Idle time</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-fuchsia-100">Dwell</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-fuchsia-100">Parked</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-sky-100">Estimated current value</th>
                  <th className="border border-white/10 bg-slate-900 px-4 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-sky-100">Replacement window</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={16} className="border border-white/10 px-4 py-10 text-center text-sm text-slate-300">
                      Loading vehicle ranking data...
                    </td>
                  </tr>
                ) : displayedRows.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="border border-white/10 px-4 py-10 text-center text-sm text-slate-300">
                      No vehicles found yet. Connect the fleet provider and assets to populate the ranking table.
                    </td>
                  </tr>
                ) : (
                  displayedRows.map((row, index) => (
                    <tr key={`${row.vehicleNumber}-${index}`} className="group hover:bg-white/3">
                      <td className="border border-white/10 px-4 py-3 text-sm font-medium text-white">
                        <div className="flex flex-col gap-1">
                          <span>{displayValue(row.vehicleNumber)}</span>
                          <span className="text-[11px] text-slate-400">
                            {row.liveVehicle ? `Live • ${row.liveVehicle.location}` : `Asset • ${row.asset?.ownership_type ?? PLACEHOLDER}`}
                          </span>
                        </div>
                      </td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-cyan-100">{row.rank}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.cost30}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.cost60}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.revenue30}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.revenue60}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime30Runtime}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime30Idle}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime30Dwell}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime30Parked}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime60Runtime}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime60Idle}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime60Dwell}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.uptime60Parked}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.currentValue}</td>
                      <td className="border border-white/10 px-4 py-3 text-sm text-slate-200">{row.replacementWindow}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/10 bg-slate-950/90 px-3 py-2">
            <div
              ref={desktopScrollbarRef}
              className="overflow-x-auto"
              aria-label="Vehicle ranking horizontal scrollbar"
            >
              <div ref={desktopScrollbarContentRef} className="h-4" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}