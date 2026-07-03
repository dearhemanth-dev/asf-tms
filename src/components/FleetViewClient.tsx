"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppRole } from "@/lib/auth";
import FleetMap from "@/components/FleetMap";
import ManagerTouchMenu from "@/components/ManagerTouchMenu";
import AccountsTouchMenu from "@/components/AccountsTouchMenu";
import MaintenanceTouchMenu from "@/components/MaintenanceTouchMenu";
import DispatchTouchMenu from "@/components/DispatchTouchMenu";
import VehicleActionSheet, { type Vehicle } from "@/components/VehicleActionSheet";

type FleetViewClientProps = {
  role: AppRole;
  immersive?: boolean;
  viewMode?: "map" | "list";
};

type FleetChipMenu = "home" | "hauling" | "alert";

const CHIP_MENU_ITEMS: Record<FleetChipMenu, string[]> = {
  home: ["Dispatch", "Idle", "Repairs"],
  hauling: ["Repairs", "Idle", "Under 6 mph", "6 to 25 mph", "Over 25 mph"],
  alert: ["Alerts", "Repairs"],
};

export default function FleetViewClient({ role, immersive = false, viewMode = "map" }: FleetViewClientProps) {
  // Enabled by default unless explicitly set to "false".
  const enableSamsara = process.env.NEXT_PUBLIC_ENABLE_SAMSARA !== "false";
  const hasInitialSyncRef = useRef(false);
  const desktopChipRowRef = useRef<HTMLDivElement | null>(null);
  const immersiveChipRowRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [openChipMenu, setOpenChipMenu] = useState<FleetChipMenu | null>(null);
  const [activeChipItem, setActiveChipItem] = useState<string>("Dispatch");
  const [haulingFilter, setHaulingFilter] = useState<string>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [syncLabel, setSyncLabel] = useState(
    enableSamsara ? "Syncing Samsara..." : "Samsara sync disabled (local fleet mode)"
  );

  const fetchVehicles = useCallback(async () => {
    setRefreshing(true);

    if (!enableSamsara) {
      setVehicles([]);
      setSelected(null);
      setSyncLabel("Samsara sync disabled (local fleet mode)");
      setRefreshing(false);
      return;
    }

    try {
      const response = await fetch("/api/fleet/vehicles", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        const message = typeof data?.error === "string" && data.error.length > 0 ? data.error : "Samsara unavailable";
        setSyncLabel(message);
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
      setSyncLabel(`Live from Samsara (${incoming.length} vehicles)`);
    } catch {
      setSyncLabel("Samsara unavailable");
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

  useEffect(() => {
    if (!openChipMenu) return;

    const handleOutsideTouch = (event: MouseEvent | TouchEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;

      const insideDesktop = desktopChipRowRef.current?.contains(targetNode) ?? false;
      const insideImmersive = immersiveChipRowRef.current?.contains(targetNode) ?? false;

      if (!insideDesktop && !insideImmersive) {
        setOpenChipMenu(null);
      }
    };

    document.addEventListener("mousedown", handleOutsideTouch);
    document.addEventListener("touchstart", handleOutsideTouch);

    return () => {
      document.removeEventListener("mousedown", handleOutsideTouch);
      document.removeEventListener("touchstart", handleOutsideTouch);
    };
  }, [openChipMenu]);

  const statusCounts = useMemo(
    () => ({
      home: vehicles.filter((vehicle) => Boolean(vehicle.atHome)).length,
      hauling: vehicles.filter((vehicle) => !vehicle.atHome).length,
      alert: vehicles.filter((vehicle) => vehicle.status === "alert").length,
    }),
    [vehicles]
  );

  const haulingMenuCounts = useMemo(
    () => ({
      repairs: vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "alert").length,
      idle: vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "idle").length,
      lessThan6: vehicles.filter(
        (vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) > 0 && (vehicle.mph ?? 0) < 6
      ).length,
      sixTo25: vehicles.filter(
        (vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) >= 6 && (vehicle.mph ?? 0) <= 25
      ).length,
      above25: vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) > 25).length,
    }),
    [vehicles]
  );

  const visibleVehicles = useMemo(() => {
    if (openChipMenu === "home") {
      return vehicles.filter((vehicle) => Boolean(vehicle.atHome));
    }

    if (haulingFilter !== "All") {
      if (haulingFilter === "Repairs") {
        return vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "alert");
      }

      if (haulingFilter === "Idle") {
        return vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "idle");
      }

      if (haulingFilter === "Under 6 mph") {
        return vehicles.filter(
          (vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) > 0 && (vehicle.mph ?? 0) < 6
        );
      }

      if (haulingFilter === "6 to 25 mph") {
        return vehicles.filter(
          (vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) >= 6 && (vehicle.mph ?? 0) <= 25
        );
      }

      if (haulingFilter === "Over 25 mph") {
        return vehicles.filter((vehicle) => !vehicle.atHome && vehicle.status === "moving" && (vehicle.mph ?? 0) > 25);
      }
    }

    return vehicles;
  }, [haulingFilter, openChipMenu, vehicles]);

  useEffect(() => {
    if (!selected) return;
    const selectedStillVisible = visibleVehicles.some((vehicle) => vehicle.id === selected.id);
    if (!selectedStillVisible) {
      setSelected(null);
    }
  }, [selected, visibleVehicles]);

  const handleChipToggle = (menu: FleetChipMenu) => {
    setOpenChipMenu((current) => (current === menu ? null : menu));
  };

  const handleHaulingFilterSelect = (item: string) => {
    setActiveChipItem(item);
    setHaulingFilter(item);
    setOpenChipMenu(null);
  };

  const renderHaulingItemIcon = (item: string) => {
    switch (item) {
      case "Repairs":
        return (
          <span
            className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 rounded-full border-2"
            style={{ backgroundColor: "#ef4444", borderColor: "#ffffff" }}
          />
        );
      case "Idle":
        return (
          <span
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded-full border-2"
            style={{ backgroundColor: "#dcfce7", borderColor: "#6b7280" }}
          />
        );
      case "Under 6 mph":
        return (
          <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
            <span
              className="absolute inset-0 rounded-full border-2"
              style={{ backgroundColor: "#dcfce7", borderColor: "#ffffff" }}
            />
            <span
              className="absolute inset-[5px] rounded-full"
              style={{ backgroundColor: "#15803d" }}
            />
          </span>
        );
      case "6 to 25 mph":
        return (
          <span className="relative mt-0.5 inline-flex h-3.5 w-3.5 shrink-0">
            <span
              className="absolute -inset-[2px] rounded-full border"
              style={{ borderColor: "#34d399" }}
            />
            <span
              className="absolute inset-0 rounded-full border-2"
              style={{ backgroundColor: "#34d399", borderColor: "#ffffff" }}
            />
            <span
              className="absolute inset-[4px] rounded-full"
              style={{ backgroundColor: "#15803d" }}
            />
          </span>
        );
      case "Over 25 mph":
        return (
          <span
            className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 rounded-full border-2"
            style={{ backgroundColor: "#166534", borderColor: "#ffffff" }}
          />
        );
      default:
        return null;
    }
  };

  const sortedVisibleVehicles = useMemo(() => {
    return [...visibleVehicles].sort((a, b) => {
      const homeDelta = Number(Boolean(b.atHome)) - Number(Boolean(a.atHome));
      if (homeDelta !== 0) return homeDelta;

      if (!a.atHome && !b.atHome) {
        const aIdle = a.status === "idle";
        const bIdle = b.status === "idle";
        if (aIdle !== bIdle) return aIdle ? -1 : 1;

        const mphDelta = (a.mph ?? 0) - (b.mph ?? 0);
        if (mphDelta !== 0) return mphDelta;
      }

      return a.truckNo.localeCompare(b.truckNo);
    });
  }, [visibleVehicles]);

  const chipButtonBase =
    "pointer-events-auto rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

  const renderChipMenu = (menu: FleetChipMenu) => {
    if (openChipMenu !== menu) return null;

    return (
      <div className="pointer-events-auto absolute left-0 top-full z-40 mt-0 w-44 rounded-xl border border-slate-700 bg-slate-950/95 p-0 shadow-[0_10px_28px_rgba(0,0,0,0.5)] backdrop-blur-sm">
        <ul className="space-y-0">
          {CHIP_MENU_ITEMS[menu].map((item) => {
            const selected = activeChipItem === item;
            const itemCount =
              menu === "hauling"
                ? item === "Repairs"
                  ? haulingMenuCounts.repairs
                  : item === "Idle"
                    ? haulingMenuCounts.idle
                    : item === "Under 6 mph"
                      ? haulingMenuCounts.lessThan6
                      : item === "6 to 25 mph"
                        ? haulingMenuCounts.sixTo25
                        : item === "Over 25 mph"
                          ? haulingMenuCounts.above25
                          : 0
                : null;
            const itemLabel =
              menu === "hauling"
                ? item === "6 to 25 mph"
                  ? "6-25 mph"
                  : item
                : item;

            return (
              <li key={item}>
                <button
                  onClick={() => (menu === "hauling" ? handleHaulingFilterSelect(item) : setActiveChipItem(item))}
                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-semibold leading-tight transition ${
                    selected ? "bg-cyan-900/35 text-cyan-100" : "text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {menu === "hauling" && renderHaulingItemIcon(item)}
                  <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
                  {itemCount !== null && (
                    <span className="ml-1 inline-flex min-w-[1.6rem] items-center justify-center rounded bg-slate-800/80 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-100">
                      {itemCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className={immersive ? "h-full w-full px-2 py-2 sm:px-3 sm:py-3" : "w-full px-2 py-3 sm:px-3 sm:py-4 md:px-6 md:py-6 lg:mx-auto lg:max-w-7xl"}>
      <section className={immersive ? "glass flex h-full min-h-0 flex-col rounded-3xl p-2 sm:p-3" : "glass rounded-3xl p-2.5 sm:p-3 md:p-6"}>
        {!immersive && (
          <>
            <div ref={desktopChipRowRef} className="mb-3 flex flex-wrap items-center gap-2 md:mb-4 md:gap-3">
              <h2 className="mr-auto text-lg font-bold tracking-tight text-white">Live Fleet Command</h2>
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("home")}
                  className={`${chipButtonBase} ${openChipMenu === "home" ? "bg-amber-800/70 text-amber-50" : "bg-amber-900/40 text-amber-200 hover:bg-amber-800/55"}`}
                >
                  Home {statusCounts.home}
                </button>
                {renderChipMenu("home")}
              </div>
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("hauling")}
                  className={`${chipButtonBase} ${openChipMenu === "hauling" ? "bg-emerald-800/70 text-emerald-50" : "bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/55"}`}
                >
                  Hauling {statusCounts.hauling}
                </button>
                {renderChipMenu("hauling")}
              </div>
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("alert")}
                  className={`${chipButtonBase} ${openChipMenu === "alert" ? "bg-rose-800/70 text-rose-50" : "bg-rose-900/40 text-rose-200 hover:bg-rose-800/55"}`}
                >
                  Alert {statusCounts.alert}
                </button>
                {renderChipMenu("alert")}
              </div>
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
          {immersive && viewMode === "map" && (
            <>
              <div ref={immersiveChipRowRef} className="pointer-events-none absolute left-2 right-24 top-2 z-30 flex items-center gap-2 sm:gap-2.5">
                <div className="relative">
                  <button
                    onClick={() => handleChipToggle("home")}
                    className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                      openChipMenu === "home"
                        ? "border-amber-200 bg-amber-700/85 text-amber-50"
                        : "border-amber-300/80 bg-amber-900/65 text-amber-50"
                    }`}
                  >
                    Home {statusCounts.home}
                  </button>
                  {renderChipMenu("home")}
                </div>
                <div className="relative">
                  <button
                    onClick={() => handleChipToggle("hauling")}
                    className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                      openChipMenu === "hauling"
                        ? "border-emerald-200 bg-emerald-700/85 text-emerald-50"
                        : "border-emerald-300/80 bg-emerald-900/70 text-emerald-50"
                    }`}
                  >
                    Hauling {statusCounts.hauling}
                  </button>
                  {renderChipMenu("hauling")}
                </div>
                <div className="relative">
                  <button
                    onClick={() => handleChipToggle("alert")}
                    className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                      openChipMenu === "alert"
                        ? "border-rose-200 bg-rose-700/85 text-rose-50"
                        : "border-rose-300/80 bg-rose-900/65 text-rose-50"
                    }`}
                  >
                    Alert {statusCounts.alert}
                  </button>
                  {renderChipMenu("alert")}
                </div>
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

          {immersive && viewMode === "list" && (
            <div ref={immersiveChipRowRef} className="mb-2 flex flex-wrap items-center gap-2 sm:gap-2.5">
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("home")}
                  className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                    openChipMenu === "home"
                      ? "border-amber-200 bg-amber-700/85 text-amber-50"
                      : "border-amber-300/80 bg-amber-900/65 text-amber-50"
                  }`}
                >
                  Home {statusCounts.home}
                </button>
                {renderChipMenu("home")}
              </div>
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("hauling")}
                  className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                    openChipMenu === "hauling"
                      ? "border-emerald-200 bg-emerald-700/85 text-emerald-50"
                      : "border-emerald-300/80 bg-emerald-900/70 text-emerald-50"
                  }`}
                >
                  Hauling {statusCounts.hauling}
                </button>
                {renderChipMenu("hauling")}
              </div>
              <div className="relative">
                <button
                  onClick={() => handleChipToggle("alert")}
                  className={`pointer-events-auto rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm ${
                    openChipMenu === "alert"
                      ? "border-rose-200 bg-rose-700/85 text-rose-50"
                      : "border-rose-300/80 bg-rose-900/65 text-rose-50"
                  }`}
                >
                  Alert {statusCounts.alert}
                </button>
                {renderChipMenu("alert")}
              </div>
              <button
                onClick={() => void fetchVehicles()}
                className="ml-auto rounded-md border border-cyan-400/70 bg-slate-950/70 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-sm"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          )}

          {viewMode === "map" ? (
            <FleetMap
              vehicles={visibleVehicles}
              selectedVehicle={selected}
              selectedId={selected?.id}
              onSelect={setSelected}
              onBackgroundTap={() => setSelected(null)}
              className={immersive ? "h-full min-h-0" : undefined}
              fitPadding={openChipMenu === "home" ? 14 : 60}
              fitMaxZoom={openChipMenu === "home" ? 18 : 9}
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
            <div
              className={`overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/60 ${
                immersive ? "h-full min-h-0" : "h-[78dvh] min-h-[520px] max-h-[860px]"
              }`}
            >
              <div className="h-full overflow-y-auto">
                {sortedVisibleVehicles.length === 0 ? (
                  <div className="grid h-full place-items-center px-4 text-sm text-slate-300">No vehicles found for this view.</div>
                ) : (
                  <ul className="divide-y divide-slate-800">
                    {sortedVisibleVehicles.map((vehicle) => {
                      const statusTone =
                        vehicle.status === "alert"
                          ? "text-rose-200 bg-rose-900/35 border-rose-700/60"
                          : vehicle.status === "moving"
                            ? "text-emerald-200 bg-emerald-900/35 border-emerald-700/60"
                            : "text-amber-100 bg-amber-900/35 border-amber-700/60";
                      const hasMph = typeof vehicle.mph === "number";
                      const showProminentMph = !vehicle.atHome && vehicle.status === "moving" && hasMph;

                      return (
                        <li key={vehicle.id} className="px-3 py-2 sm:px-4 sm:py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-white">{vehicle.truckNo}</p>
                              <p className="truncate text-xs text-slate-300">{vehicle.driver || "Unassigned driver"}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <span
                                className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  vehicle.atHome
                                    ? "border-amber-600/70 bg-amber-900/35 text-amber-100"
                                    : "border-emerald-600/70 bg-emerald-900/30 text-emerald-100"
                                }`}
                              >
                                {vehicle.atHome ? "Home" : "Hauling"}
                              </span>
                              {showProminentMph ? (
                                <span className="inline-flex shrink-0 rounded-full border border-cyan-500/70 bg-cyan-900/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100">
                                  {Math.round(vehicle.mph ?? 0)} MPH
                                </span>
                              ) : (
                                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}>
                                  {vehicle.status}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{vehicle.location || "Location unavailable"}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                            {vehicle.status !== "idle" && hasMph && !showProminentMph && (
                              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-slate-200">
                                {(vehicle.mph ?? 0).toFixed(0)} mph
                              </span>
                            )}
                            {typeof vehicle.fuelLevel === "number" && (
                              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-slate-200">
                                Fuel {vehicle.fuelLevel.toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {role === "driver" && (
        <VehicleActionSheet role={role} vehicle={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
