"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppRole } from "@/lib/auth";
import FleetMap from "@/components/FleetMap";
import ManagerTouchMenu from "@/components/ManagerTouchMenu";
import AccountsTouchMenu from "@/components/AccountsTouchMenu";
import MaintenanceTouchMenu from "@/components/MaintenanceTouchMenu";
import DispatchTouchMenu from "@/components/DispatchTouchMenu";
import VehicleActionSheet, { type Vehicle } from "@/components/VehicleActionSheet";
import { FLEET_API_ROUTES } from "@/lib/fleet-api";

type FleetViewClientProps = {
  role: AppRole;
  immersive?: boolean;
  viewMode?: "map" | "list";
};

type RecentAlertItem = {
  id: string;
  occurredAt: string;
  summary: string;
  severity: "critical" | "warning" | "info";
};

type AlertsSummary = {
  total: number;
  critical: number;
  warning: number;
  info: number;
  topTypes: Array<{ type: string; count: number }>;
};

export default function FleetViewClient({ role, immersive = false, viewMode = "map" }: FleetViewClientProps) {
  // Enabled by default unless explicitly set to "false".
  const enableSamsara = process.env.NEXT_PUBLIC_ENABLE_SAMSARA !== "false";
  const hasInitialSyncRef = useRef(false);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [activeTopSummaryMenu, setActiveTopSummaryMenu] = useState<"home" | "hauling" | null>(null);
  const [activeOverlaySummaryMenu, setActiveOverlaySummaryMenu] = useState<"home" | "hauling" | null>(null);
  const [activeListSummaryMenu, setActiveListSummaryMenu] = useState<"home" | "hauling" | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncLabel, setSyncLabel] = useState(
    enableSamsara ? "Syncing live fleet data..." : "Fleet sync disabled (local fleet mode)"
  );
  const [alertsPopupOpen, setAlertsPopupOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<RecentAlertItem[]>([]);
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const loadRecentAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);

    try {
      const response = await fetch("/api/alerts/recent", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        summary?: AlertsSummary;
        events?: RecentAlertItem[];
        error?: string;
      };

      if (!response.ok) {
        setRecentAlerts([]);
        setAlertsSummary(null);
        setAlertsError(payload.error ?? "Unable to load alerts.");
        return;
      }

      setAlertsSummary(payload.summary ?? null);
      setRecentAlerts(Array.isArray(payload.events) ? payload.events : []);
    } catch {
      setRecentAlerts([]);
      setAlertsSummary(null);
      setAlertsError("Unable to load alerts.");
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const toggleAlertsPopup = useCallback(() => {
    setAlertsPopupOpen((current) => {
      const next = !current;
      if (next) {
        setActiveTopSummaryMenu(null);
        setActiveOverlaySummaryMenu(null);
        setActiveListSummaryMenu(null);
        void loadRecentAlerts();
      }
      return next;
    });
  }, [loadRecentAlerts]);

  const formatAlertTime = useCallback((iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, []);

  const fetchVehicles = useCallback(async () => {
    setRefreshing(true);

    if (!enableSamsara) {
      setVehicles([]);
      setSelected(null);
      setSyncLabel("Fleet sync disabled (local fleet mode)");
      setRefreshing(false);
      return;
    }

    try {
      const response = await fetch(FLEET_API_ROUTES.vehicles, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        setSyncLabel("Fleet data unavailable");
        setVehicles([]);
        setSelected(null);
        setRefreshing(false);
        return;
      }

      const incoming = Array.isArray(data.vehicles) ? (data.vehicles as Vehicle[]) : [];
      if (incoming.length === 0) {
        setSyncLabel("No live vehicles found");
        setVehicles([]);
        setSelected(null);
        setRefreshing(false);
        return;
      }

      setVehicles(incoming);
      setSyncLabel(`Live fleet data (${incoming.length} vehicles)`);
    } catch {
      setSyncLabel("Fleet data unavailable");
      setVehicles([]);
      setSelected(null);
    } finally {
      setRefreshing(false);
    }
  }, [enableSamsara]);

  useEffect(() => {
    if (!enableSamsara || hasInitialSyncRef.current) return;
    hasInitialSyncRef.current = true;
    void fetchVehicles();
  }, [enableSamsara, fetchVehicles]);

  const statusCounts = useMemo(
    () => ({
      home: vehicles.filter((vehicle) => vehicle.atHome).length,
      homeDispatch: vehicles.filter((vehicle) => vehicle.atHome && vehicle.status === "moving").length,
      homeRepairs: vehicles.filter((vehicle) => vehicle.atHome && vehicle.status === "alert").length,
      homeIdle: vehicles.filter((vehicle) => vehicle.atHome && vehicle.status === "idle").length,
      haulingTotal: vehicles.filter((vehicle) => !vehicle.atHome).length,
      alertsTotal: vehicles.filter((vehicle) => vehicle.status === "alert").length,
      idle: vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "idle").length,
      moving: vehicles.filter((vehicle) => vehicle.status === "moving").length,
      repairs: vehicles.filter((vehicle) => vehicle.status === "alert").length,
    }),
    [vehicles]
  );

  const haulingSpeed = useMemo(() => {
    const speedSamples = vehicles.filter(
      (vehicle) => !vehicle.atHome && (vehicle.status === "moving" || vehicle.status === "idle") && typeof vehicle.mph === "number"
    );

    if (speedSamples.length === 0) return null;

    const average = speedSamples.reduce((sum, vehicle) => sum + (vehicle.mph ?? 0), 0) / speedSamples.length;
    return Math.round(average);
  }, [vehicles]);

  const getVehicleActivityLabel = useCallback((vehicle: Vehicle) => {
    if (vehicle.status === "alert") {
      return "Repairs";
    }

    if (vehicle.status === "moving") {
      return vehicle.mph !== undefined ? `MPH ${Math.round(vehicle.mph)}` : "Moving";
    }

    if (vehicle.status === "idle") {
      if (typeof vehicle.mph === "number" && vehicle.mph > 0) {
        return `Idle • MPH ${Math.round(vehicle.mph)}`;
      }

      return "Idle";
    }

    return vehicle.atHome ? "Home" : "Hauling";
  }, []);

  const listVehicles = useMemo(() => {
    return [...vehicles].sort((a, b) => Number(a.atHome) - Number(b.atHome));
  }, [vehicles]);

  const AlertsChip = ({ chipClassName, popupAlignClass = "right-0" }: { chipClassName: string; popupAlignClass?: string }) => (
    <div className="pointer-events-auto relative">
      <button onClick={toggleAlertsPopup} className={chipClassName}>
        Alerts {statusCounts.alertsTotal}
      </button>
      {alertsPopupOpen && (
        <div className={`absolute ${popupAlignClass} top-[calc(100%+6px)] z-40 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-rose-300/70 bg-slate-950 p-3 text-xs text-slate-100 shadow-2xl`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-semibold text-rose-200">Alerts (Last 24h)</p>
            <button
              onClick={() => setAlertsPopupOpen(false)}
              className="rounded border border-white/20 px-2 py-0.5 text-[10px] font-semibold text-slate-200"
            >
              Close
            </button>
          </div>
          {alertsLoading ? (
            <p className="text-slate-300">Loading...</p>
          ) : alertsError ? (
            <p className="text-rose-300">{alertsError}</p>
          ) : !alertsSummary || alertsSummary.total === 0 ? (
            <p className="text-slate-300">No alert events in the last 24 hours.</p>
          ) : (
            <>
              <div className="mb-2 rounded-lg border border-white/15 bg-slate-900/60 p-2 text-[11px] text-slate-200">
                <p>Total: {alertsSummary.total}</p>
                <p>Critical: {alertsSummary.critical} • Warning: {alertsSummary.warning} • Info: {alertsSummary.info}</p>
                {alertsSummary.topTypes.length > 0 && (
                  <p>Top: {alertsSummary.topTypes.map((item) => `${item.type} (${item.count})`).join(", ")}</p>
                )}
              </div>
              <ul className="space-y-1.5">
                {recentAlerts.slice(0, 5).map((event) => (
                  <li key={event.id} className="leading-4 text-slate-200">
                    <span className="text-slate-400">{formatAlertTime(event.occurredAt)}</span>
                    <span className="mx-1 text-slate-500">•</span>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={immersive ? "h-full w-full px-2 py-2 sm:px-3 sm:py-3" : "w-full px-2 py-3 sm:px-3 sm:py-4 md:px-6 md:py-6 lg:mx-auto lg:max-w-7xl"}>
      <section className={immersive ? "glass flex h-full min-h-0 flex-col rounded-3xl p-2 sm:p-3" : "glass rounded-3xl p-2.5 sm:p-3 md:p-6"}>
        {!immersive && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 md:mb-4 md:gap-3">
              <h2 className="mr-auto text-lg font-bold tracking-tight text-white">Live Fleet Command</h2>
              <div className="relative">
                <button
                  onClick={() =>
                    setActiveTopSummaryMenu((current) => (current === "home" ? null : "home"))
                  }
                  className="rounded-full bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-200"
                >
                  Home {statusCounts.home}
                </button>
                {activeTopSummaryMenu === "home" && (
                  <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-fit min-w-[8.75rem] max-w-[calc(100vw-1rem)] rounded-xl border border-emerald-300/80 bg-slate-950 p-2.5 text-xs font-semibold text-emerald-100 shadow-2xl">
                    <p>Dispatch: {statusCounts.homeDispatch}</p>
                    <p>Repairs: {statusCounts.homeRepairs}</p>
                    <p>Idle: {statusCounts.homeIdle}</p>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() =>
                    setActiveTopSummaryMenu((current) => (current === "hauling" ? null : "hauling"))
                  }
                  className="rounded-full bg-amber-900/40 px-3 py-1 text-[11px] font-semibold text-amber-200"
                >
                  Hauling {statusCounts.haulingTotal}
                </button>
                {activeTopSummaryMenu === "hauling" && (
                  <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-44 rounded-lg border border-amber-300/70 bg-slate-900 p-2.5 text-sm font-semibold text-amber-100 shadow-2xl">
                    <p>Moving: {statusCounts.moving}</p>
                    <p>Idle: {statusCounts.idle}</p>
                    <p>Repairs: {statusCounts.repairs}</p>
                  </div>
                )}
              </div>
              <AlertsChip chipClassName="rounded-full bg-rose-900/40 px-3 py-1 text-[11px] text-rose-200" />
              <button
                onClick={() => void fetchVehicles()}
                className="rounded-md border border-cyan-500/60 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <p className="mb-3 text-xs text-slate-400">{syncLabel}</p>
          </>
        )}

        <div className={immersive ? "relative min-h-0 flex-1" : undefined}>
          {immersive && viewMode === "list" && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setActiveListSummaryMenu((current) => (current === "home" ? null : "home"))}
                  className="rounded-full border border-emerald-300/70 bg-emerald-900/65 px-3 py-1.5 text-xs font-semibold text-emerald-50"
                >
                  Home {statusCounts.home}
                </button>
                {activeListSummaryMenu === "home" && (
                  <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-fit min-w-[8.75rem] max-w-[calc(100vw-1rem)] rounded-xl border border-emerald-300/80 bg-slate-950 p-2.5 text-xs font-semibold text-emerald-100 shadow-2xl">
                    <p>Dispatch: {statusCounts.homeDispatch}</p>
                    <p>Repairs: {statusCounts.homeRepairs}</p>
                    <p>Idle: {statusCounts.homeIdle}</p>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setActiveListSummaryMenu((current) => (current === "hauling" ? null : "hauling"))}
                  className="rounded-full border border-amber-300/70 bg-amber-900/65 px-3 py-1.5 text-xs font-semibold text-amber-50"
                >
                  Hauling {statusCounts.haulingTotal}
                </button>
                {activeListSummaryMenu === "hauling" && (
                  <div className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-44 rounded-xl border border-amber-300/80 bg-slate-950 p-3 text-sm font-semibold text-amber-50 shadow-2xl">
                    <p>Moving: {statusCounts.moving}</p>
                    <p>Idle: {statusCounts.idle}</p>
                    <p>Repairs: {statusCounts.repairs}</p>
                  </div>
                )}
              </div>

              <AlertsChip chipClassName="rounded-full border border-rose-300/70 bg-rose-900/60 px-3 py-1.5 text-xs font-semibold text-rose-100" popupAlignClass="left-0" />
            </div>
          )}

          {immersive && viewMode === "map" && (
            <>
              <div className="pointer-events-none absolute left-2 right-24 top-2 z-30 flex items-center gap-2 sm:gap-2.5">
                <div className="pointer-events-auto relative">
                  <button
                    onClick={() =>
                      setActiveOverlaySummaryMenu((current) => (current === "home" ? null : "home"))
                    }
                    className="rounded-full border border-emerald-300/80 bg-emerald-900/70 px-3 py-1.5 text-xs font-semibold text-emerald-50 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm"
                  >
                    Home {statusCounts.home}
                  </button>
                  {activeOverlaySummaryMenu === "home" && (
                      <div className="absolute left-0 top-[calc(100%+4px)] z-30 w-fit min-w-[8.75rem] max-w-[calc(100vw-1rem)] rounded-xl border border-emerald-300/80 bg-slate-950 p-2.5 text-xs font-semibold text-emerald-100 shadow-2xl">
                      <p>Dispatch: {statusCounts.homeDispatch}</p>
                      <p>Repairs: {statusCounts.homeRepairs}</p>
                      <p>Idle: {statusCounts.homeIdle}</p>
                    </div>
                  )}
                </div>
                <div className="pointer-events-auto relative">
                  <button
                    onClick={() =>
                      setActiveOverlaySummaryMenu((current) => (current === "hauling" ? null : "hauling"))
                    }
                    className="rounded-full border border-amber-300/80 bg-amber-900/65 px-3 py-1.5 text-[11px] font-semibold text-amber-50 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm"
                  >
                    Hauling {statusCounts.haulingTotal}
                  </button>
                  {activeOverlaySummaryMenu === "hauling" && (
                    <div className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-44 rounded-xl border border-amber-300/80 bg-slate-950 p-3 text-sm font-semibold text-amber-50 shadow-2xl">
                      <p>Moving: {statusCounts.moving}</p>
                      <p>Idle: {statusCounts.idle}</p>
                      <p>Repairs: {statusCounts.repairs}</p>
                    </div>
                  )}
                </div>
                <AlertsChip chipClassName="rounded-full border border-rose-300/80 bg-rose-900/60 px-3 py-1.5 text-[11px] font-semibold text-rose-100 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm" popupAlignClass="left-0" />
              </div>
              <div className="absolute right-2 top-2 z-30">
                <button
                  onClick={() => void fetchVehicles()}
                  className="rounded-md border border-cyan-400/70 bg-slate-950/70 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm"
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </>
          )}

          {viewMode === "map" ? (
            <FleetMap
              vehicles={vehicles}
              selectedVehicle={selected}
              selectedId={selected?.id}
              onSelect={setSelected}
              onBackgroundTap={() => setSelected(null)}
              className={immersive ? "h-full min-h-0" : undefined}
              overlayContent={
                selected
                  ? role === "management"
                    ? <ManagerTouchMenu onClose={() => setSelected(null)} />
                    : role === "accounts"
                      ? <AccountsTouchMenu onClose={() => setSelected(null)} />
                      : role === "maintenance"
                        ? <MaintenanceTouchMenu onClose={() => setSelected(null)} />
                        : role === "dispatch"
                          ? <DispatchTouchMenu onClose={() => setSelected(null)} />
                          : null
                  : null
              }
            />
          ) : (
            <div className="h-full min-h-0 overflow-auto rounded-xl border border-slate-800 bg-slate-950/55 p-2">
              {vehicles.length === 0 ? (
                <p className="p-3 text-sm text-slate-400">No vehicles available.</p>
              ) : (
                <div className="space-y-2">
                  {listVehicles.map((vehicle) => (
                    <div
                      key={vehicle.id}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-100">
                            {vehicle.assetLabel ?? vehicle.truckNo} - {vehicle.driver}
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-400">{vehicle.location}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-[10px] font-semibold">
                          <div className={`rounded-full px-2.5 py-0.5 ${
                            vehicle.atHome ? "bg-emerald-900/50 text-emerald-200" : "bg-amber-900/50 text-amber-200"
                          }`}>
                            {vehicle.atHome ? "Home" : "Hauling"}
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              vehicle.status === "alert"
                                ? "bg-rose-900/55 text-rose-100 shadow-[0_0_0_1px_rgba(251,113,133,0.2)]"
                                : vehicle.status === "idle"
                                  ? "bg-slate-800 text-slate-100"
                                  : "bg-cyan-950/60 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                            }`}
                          >
                            {getVehicleActivityLabel(vehicle)}
                          </span>
                          {!vehicle.atHome && (
                            <span className="rounded-full bg-slate-800/90 px-2.5 py-0.5 text-[10px] font-semibold text-slate-200">
                              Cost/Mile --
                            </span>
                          )}
                          {vehicle.status === "alert" && (
                            <span className="rounded-full bg-rose-900/50 px-2 py-0.5 text-rose-200">Alerts</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {(role === "driver" || viewMode === "list") && (
        <VehicleActionSheet role={role} vehicle={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
