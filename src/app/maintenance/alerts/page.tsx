"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

type AlertSkin = {
  label: string;
  border: string;
  bg: string;
  chip: string;
};

function decodeSafe(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.trim() || fallback;
  } catch {
    return value.trim() || fallback;
  }
}

function getSkin(severity: string): AlertSkin {
  const normalized = severity.toLowerCase();
  if (normalized === "warning") {
    return {
      label: "Warning",
      border: "border-amber-400/60",
      bg: "bg-amber-500/10",
      chip: "bg-amber-400/20 text-amber-200",
    };
  }

  return {
    label: "Critical",
    border: "border-rose-400/60",
    bg: "bg-rose-500/10",
    chip: "bg-rose-400/20 text-rose-200",
  };
}

function formatLocalDateTime(rawValue: string): string {
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return rawValue;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function MaintenanceAlertPopupContent() {
  const searchParams = useSearchParams();
  const asValue = (key: string) => searchParams.get(key) ?? undefined;

  const severity = decodeSafe(asValue("severity"), "critical");
  const title = decodeSafe(asValue("title"), "ASF TMS Critical Maintenance Alert");
  const vehicle = decodeSafe(asValue("vehicle"), "Vehicle not provided");
  const fault = decodeSafe(asValue("fault"), "Fault description unavailable");
  const summary = decodeSafe(asValue("summary"), "Immediate review recommended.");
  const action = decodeSafe(asValue("action"), "Review fault details and dispatch service support.");
  const occurredAtRaw = decodeSafe(asValue("occurredAt"), new Date().toISOString());
  const occurredAt = useMemo(() => formatLocalDateTime(occurredAtRaw), [occurredAtRaw]);
  const highlightsRaw = decodeSafe(asValue("highlights"), "");

  const skin = getSkin(severity);
  const highlights = highlightsRaw
    .split("||")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-6 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,#f43f5e25_0%,transparent_32%),radial-gradient(circle_at_86%_18%,#fb718524_0%,transparent_36%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#020617_0%,#0f172a_48%,#111827_100%)]" />
      </div>

      <section className="relative mx-auto w-full max-w-3xl">
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-6" role="dialog" aria-modal="true">
          <div className={`w-full max-w-3xl rounded-2xl border ${skin.border} bg-slate-900/95 p-5 shadow-2xl`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300">Maintenance Alert Center</p>
                <h1 className="mt-1 text-xl font-bold text-slate-100">{title}</h1>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${skin.chip}`}>
                {skin.label}
              </span>
            </div>

            <div className={`mt-4 rounded-xl border ${skin.border} ${skin.bg} p-3`}>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Urgent Fault Summary</p>
              <p className="mt-2 text-sm text-slate-100">{summary}</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Vehicle</p>
                <p className="mt-1 text-sm text-slate-100">{vehicle}</p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Event Time</p>
                <p className="mt-1 text-sm text-slate-100">{occurredAt}</p>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Fault Description</p>
              <p className="mt-1 text-sm text-slate-100">{fault}</p>
            </div>

            {highlights.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Top Urgent Faults</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-100">
                  {highlights.map((line, index) => (
                    <li key={`${line}-${index}`} className="rounded bg-slate-900/70 px-2 py-1">
                      {index + 1}. {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Recommended Action</p>
              <p className="mt-1 text-sm text-slate-100">{action}</p>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <a
                href="/maintenance/fault-codes"
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700"
              >
                Open Fault Workspace
              </a>
              <a
                href="/fleet"
                className="rounded-md border border-cyan-500/50 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
              >
                Acknowledge
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function MaintenanceAlertPopupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <MaintenanceAlertPopupContent />
    </Suspense>
  );
}
