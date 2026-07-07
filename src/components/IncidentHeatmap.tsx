"use client";

import { useState } from "react";
import {
  HeatmapCell,
  EventDetail,
  normalizeEventTypeName,
  formatEventTime,
  formatEventDate,
  getIncidentTypeColor,
} from "@/lib/analytics/incident-heatmap";
import { reverseGeocodeCoordinates, formatResolvedLocation } from "@/lib/gps-reverse-geocode";

interface IncidentHeatmapProps {
  cells: HeatmapCell[];
  totalEvents: number;
  windowDays: number;
}

interface EventModalState {
  isOpen: boolean;
  events: EventDetail[];
  weekLabel: string;
  incidentType: string;
}

// Color-based class mapping for heatmap cells
const COLOR_CLASSES: Record<string, Record<string, string>> = {
  rose: {
    empty: "bg-slate-800/20 border-slate-700/30 text-slate-500",
    low: "bg-rose-950/40 border-rose-700/20 text-rose-400 hover:bg-rose-950/60 cursor-pointer",
    mid: "bg-rose-950/60 border-rose-700/40 text-rose-300 hover:bg-rose-950/80 cursor-pointer",
    high: "bg-rose-950/80 border-rose-700/60 text-rose-200 hover:bg-rose-900 cursor-pointer",
    max: "bg-rose-900 border-rose-600 text-rose-100 hover:bg-rose-800 cursor-pointer",
  },
  amber: {
    empty: "bg-slate-800/20 border-slate-700/30 text-slate-500",
    low: "bg-amber-950/40 border-amber-700/20 text-amber-400 hover:bg-amber-950/60 cursor-pointer",
    mid: "bg-amber-950/60 border-amber-700/40 text-amber-300 hover:bg-amber-950/80 cursor-pointer",
    high: "bg-amber-950/80 border-amber-700/60 text-amber-200 hover:bg-amber-900 cursor-pointer",
    max: "bg-amber-900 border-amber-600 text-amber-100 hover:bg-amber-800 cursor-pointer",
  },
  cyan: {
    empty: "bg-slate-800/20 border-slate-700/30 text-slate-500",
    low: "bg-cyan-950/40 border-cyan-700/20 text-cyan-400 hover:bg-cyan-950/60 cursor-pointer",
    mid: "bg-cyan-950/60 border-cyan-700/40 text-cyan-300 hover:bg-cyan-950/80 cursor-pointer",
    high: "bg-cyan-950/80 border-cyan-700/60 text-cyan-200 hover:bg-cyan-900 cursor-pointer",
    max: "bg-cyan-900 border-cyan-600 text-cyan-100 hover:bg-cyan-800 cursor-pointer",
  },
  violet: {
    empty: "bg-slate-800/20 border-slate-700/30 text-slate-500",
    low: "bg-violet-950/40 border-violet-700/20 text-violet-400 hover:bg-violet-950/60 cursor-pointer",
    mid: "bg-violet-950/60 border-violet-700/40 text-violet-300 hover:bg-violet-950/80 cursor-pointer",
    high: "bg-violet-950/80 border-violet-700/60 text-violet-200 hover:bg-violet-900 cursor-pointer",
    max: "bg-violet-900 border-violet-600 text-violet-100 hover:bg-violet-800 cursor-pointer",
  },
  slate: {
    empty: "bg-slate-800/20 border-slate-700/30 text-slate-500",
    low: "bg-slate-800/40 border-slate-700/20 text-slate-400 hover:bg-slate-800/60 cursor-pointer",
    mid: "bg-slate-800/60 border-slate-700/40 text-slate-300 hover:bg-slate-800/80 cursor-pointer",
    high: "bg-slate-800/80 border-slate-700/60 text-slate-200 hover:bg-slate-700 cursor-pointer",
    max: "bg-slate-700 border-slate-600 text-slate-100 hover:bg-slate-600 cursor-pointer",
  },
};

function getCellClassForIntensity(color: string, intensity: number): string {
  const colorMap = COLOR_CLASSES[color] || COLOR_CLASSES.slate;

  if (intensity === 0) return colorMap.empty;
  if (intensity <= 25) return colorMap.low;
  if (intensity <= 50) return colorMap.mid;
  if (intensity <= 75) return colorMap.high;
  return colorMap.max;
}

/**
 * Weekly Incident Heatmap with drill-down to event details
 */
export function IncidentHeatmap({ cells, totalEvents, windowDays }: IncidentHeatmapProps) {
  const [modal, setModal] = useState<EventModalState>({
    isOpen: false,
    events: [],
    weekLabel: "",
    incidentType: "",
  });

  // Group cells by incident type (rows)
  const incidentTypes = Array.from(new Set(cells.map((c) => c.incidentType))).sort();
  const weeks = Array.from(new Set(cells.map((c) => c.weekLabel)));

  // Manager-sensible ordering: safety risks first, then mechanical, then compliance, then efficiency
  const INCIDENT_PRIORITY: Record<string, number> = {
    speeding: 1,
    harsh_brake: 2,
    harsh_accel: 3,
    fuel_consumption: 4,
    idling: 5,
    cornering: 6,
    fault_code: 7,
    high_temp: 8,
    dvir_defect: 9,
  };
  const getTypePriority = (type: string) => {
    const key = type.toLowerCase();
    for (const [k, v] of Object.entries(INCIDENT_PRIORITY)) {
      if (key.includes(k)) return v;
    }
    return 99;
  };
  const sortedIncidentTypes = [...incidentTypes].sort(
    (a, b) => getTypePriority(a) - getTypePriority(b)
  );

  // Get unique weeks in order (reverse chronological)
  const uniqueWeeks = Array.from(
    new Map(
      cells
        .filter((c) => incidentTypes.indexOf(c.incidentType) === 0) // Use first incident type
        .map((c) => [c.weekStart, c.weekLabel])
    ).values()
  );

  const getCellData = (incidentType: string, weekLabel: string): HeatmapCell | undefined => {
    return cells.find((c) => c.incidentType === incidentType && c.weekLabel === weekLabel);
  };

  const openEventModal = (cell: HeatmapCell) => {
    if (cell.count > 0) {
      setModal({
        isOpen: true,
        events: cell.events,
        weekLabel: cell.weekLabel,
        incidentType: cell.incidentType,
      });
    }
  };

  const closeEventModal = () => {
    setModal({
      isOpen: false,
      events: [],
      weekLabel: "",
      incidentType: "",
    });
  };

  if (incidentTypes.length === 0) {
    return (
      <div className="rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        No incident history available for this period.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
        <p className="mb-3 text-sm font-semibold text-slate-200">
          Incident History{" "}
          <span className="font-normal text-slate-400 text-xs">({totalEvents} incidents over {windowDays} days)</span>
        </p>

        {/* Heatmap */}
        <div className="space-y-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
          {/* Header row with week labels */}
          <div className="flex gap-1 border-b border-slate-700/50 pb-1.5 mb-1">
            <div className="w-28 flex-shrink-0 text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Incident Type
            </div>
            <div className="flex gap-1">
              {uniqueWeeks.map((weekLabel, idx) => (
                <div
                  key={idx}
                  className="w-16 flex-shrink-0 text-center text-xs font-semibold text-slate-300"
                >
                  {weekLabel}
                </div>
              ))}
            </div>
          </div>

          {/* Flat heatmap rows in manager-sensible order */}
          {sortedIncidentTypes.map((incidentType) => {
            const typeColor = getIncidentTypeColor(incidentType);
            return (
              <div key={incidentType} className="flex gap-1 items-center">
                <div className="w-28 flex-shrink-0 text-xs font-medium text-slate-200">
                  {normalizeEventTypeName(incidentType)}
                </div>
                <div className="flex gap-1">
                  {uniqueWeeks.map((weekLabel, idx) => {
                    const cell = getCellData(incidentType, weekLabel);
                    if (!cell) {
                      return (
                        <div
                          key={idx}
                          className="w-16 flex-shrink-0 h-8 rounded border border-slate-800/30 bg-slate-900/20"
                        />
                      );
                    }

                    const bgClass = getCellClassForIntensity(typeColor, cell.intensity);

                    return (
                      <button
                        key={idx}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEventModal(cell);
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onTouchStart={(e) => {
                          e.stopPropagation();
                        }}
                        className={`w-16 flex-shrink-0 h-8 rounded border flex items-center justify-center text-xs font-semibold transition-colors ${bgClass}`}
                        disabled={cell.count === 0}
                        type="button"
                      >
                        {cell.count > 0 ? cell.count : "—"}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-2 text-[10px] text-slate-500">
          Click a cell to see incident details
        </p>
      </div>

      {/* Event Detail Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 md:bg-black/40" onClick={(e) => {
          e.stopPropagation();
          closeEventModal();
        }}>
          <div className="w-full md:w-96 max-h-[90vh] rounded-t-xl md:rounded-xl border border-slate-600 bg-slate-900 md:max-w-lg flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Sticky Header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-2 bg-slate-950">
              <div>
                <p className="text-xs font-medium text-slate-300">
                  {normalizeEventTypeName(modal.incidentType)}
                </p>
                <p className="text-[10px] text-slate-500">Week of {modal.weekLabel}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeEventModal();
                }}
                className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Close
              </button>
            </div>

            {/* Scrollable Event List */}
            <div className="flex-1 overflow-y-auto space-y-2 p-3">
              {modal.events.map((event, idx) => {
                const resolved = event.latitude && event.longitude 
                  ? reverseGeocodeCoordinates(
                      event.latitude,
                      event.longitude,
                      event.details.location
                    )
                  : null;

                return (
                <div
                  key={idx}
                  className="rounded border border-slate-700/50 bg-slate-800/30 px-2.5 py-2"
                >
                  {/* Compact header: Time • Date • Truck [Severity] */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[10px] text-slate-300 flex-1">
                      <span className="font-semibold">{formatEventTime(event.event_timestamp)}</span>
                      <span className="text-slate-400 font-semibold"> • {formatEventDate(event.event_date)}</span>
                      <span className="text-slate-500"> • Unit {event.truck_unit_number}</span>
                    </p>
                    {event.details.severity && (
                      <span
                        className={`text-[9px] font-medium px-2 py-0.5 rounded-sm flex-shrink-0 ${
                          event.details.severity === "high"
                            ? "bg-rose-900/50 text-rose-200"
                            : event.details.severity === "moderate"
                              ? "bg-amber-900/50 text-amber-200"
                              : "bg-slate-700/50 text-slate-200"
                        }`}
                      >
                        {event.details.severity}
                      </span>
                    )}
                  </div>

                  {/* Location & Region (combined) */}
                  {resolved ? (
                    <p className="text-[10px] text-slate-200 mb-2 leading-snug">
                      {formatResolvedLocation(resolved)}
                      {event.details.location && event.details.location !== "Unknown" && (
                        <span className="text-slate-500"> • {event.details.location}</span>
                      )}
                    </p>
                  ) : event.details.location ? (
                    <p className="text-[10px] text-slate-300 mb-2">
                      {event.details.location}
                    </p>
                  ) : null}

                  {/* Duration, Speed & Description */}
                  <div className="flex gap-3 text-[10px] flex-wrap">
                    {event.event_type === "speeding_incident" ? (
                      <span className="text-slate-400 flex-1">
                        {event.details.description && (
                          <>
                            <span className="font-medium text-rose-300">{event.duration_minutes} min</span> at{" "}
                            <span className="font-medium text-rose-300">{event.details.speed} mph</span>
                            {event.details.posted_limit ? (
                              <>
                                {" in "}<span className="text-slate-300">{event.details.posted_limit} zone</span>
                              </>
                            ) : null}
                          </>
                        )}
                      </span>
                    ) : null}
                    {event.event_type === "idling_episode" ? (() => {
                      const idleMins = (event.details.total_idling_minutes as number) ?? event.duration_minutes ?? 0;
                      const idlePct = (event.details.idle_percentage as number) ?? Math.round(event.metric_value * 100);
                      return (
                        <span className="text-slate-400 flex-1">
                          <span className="font-medium text-amber-400">{idleMins} min</span> idle
                          {" "}·{" "}<span className="font-medium text-amber-300">{idlePct}%</span> of engine-on time
                        </span>
                      );
                    })() : event.event_type !== "speeding_incident" && event.details.description ? (
                      <span className="text-slate-400 flex-1">
                        {event.details.description}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
