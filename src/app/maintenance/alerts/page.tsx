"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

type AlertSkin = {
  label: string;
  border: string;
  panel: string;
  chip: string;
};

type ViewerRole = "maintenance" | "management" | "driver" | "unknown";

type RoleContent = {
  roleLabel: string;
  planLabel: string;
  actionFallback: string;
  financeLabel: string;
  primaryCta: string;
  primaryHref: string;
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
  if (normalized === "info") {
    return {
      label: "Info",
      border: "border-cyan-400/55",
      panel: "bg-cyan-500/12",
      chip: "bg-cyan-400/20 text-cyan-100",
    };
  }

  if (normalized === "warning") {
    return {
      label: "Warning",
      border: "border-amber-400/60",
      panel: "bg-amber-500/12",
      chip: "bg-amber-400/20 text-amber-200",
    };
  }

  return {
    label: "Critical",
    border: "border-rose-400/60",
    panel: "bg-rose-500/12",
    chip: "bg-rose-400/20 text-rose-200",
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeRole(rawValue: string | undefined): ViewerRole {
  const normalized = (rawValue ?? "").trim().toLowerCase();
  if (normalized === "maintenance") return "maintenance";
  if (normalized === "management" || normalized === "manager") return "management";
  if (normalized === "driver") return "driver";
  return "unknown";
}

function pickViewerRole(roleHint: string | undefined, audienceHint: string | undefined): ViewerRole {
  const explicit = normalizeRole(roleHint);
  if (explicit !== "unknown") return explicit;

  const cookieRole = normalizeRole(readCookie("asf_role") ?? undefined);
  if (cookieRole !== "unknown") return cookieRole;

  const audienceList = (audienceHint ?? "")
    .split(",")
    .map((entry) => normalizeRole(entry))
    .filter((entry) => entry !== "unknown");

  if (audienceList.includes("maintenance")) return "maintenance";
  if (audienceList.includes("management")) return "management";
  if (audienceList.includes("driver")) return "driver";
  return "unknown";
}

function getRoleContent(role: ViewerRole): RoleContent {
  if (role === "management") {
    return {
      roleLabel: "Manager",
      planLabel: "Service Plan",
      actionFallback: "Approve shop path, prioritize parts, and lock downtime window.",
      financeLabel: "Cost, Uptime & Liability",
      primaryCta: "Open Fleet View",
      primaryHref: "/fleet",
    };
  }

  if (role === "driver") {
    return {
      roleLabel: "Driver",
      planLabel: "Roadside Plan",
      actionFallback: "Reduce risk immediately and follow the assigned support workflow.",
      financeLabel: "Cost & Safety Impact",
      primaryCta: "Open Driver Workflow",
      primaryHref: "/tasks",
    };
  }

  if (role === "maintenance") {
    return {
      roleLabel: "Maintenance",
      planLabel: "Shop Plan",
      actionFallback: "Review active faults, contact driver, and dispatch maintenance support.",
      financeLabel: "Cost, Uptime & Liability",
      primaryCta: "Open Fault Workspace",
      primaryHref: "/maintenance/fault-codes",
    };
  }

  return {
    roleLabel: "Fleet",
    planLabel: "Response Plan",
    actionFallback: "Review this alert and coordinate with fleet support.",
    financeLabel: "Exposure Snapshot",
    primaryCta: "Open Fleet",
    primaryHref: "/fleet",
  };
}

function looksLowValueDiagnosis(value: string): boolean {
  const blob = value.toLowerCase();
  return (
    blob.includes("dvir submitted") ||
    blob.includes("dvir") ||
    blob.includes("inspection submitted") ||
    blob.includes("driver report") ||
    blob.includes("maintenance event")
  );
}

function cleanLine(value: string): string {
  return value.replace(/^\d+\.\s*/, "").trim();
}

function toMechanicDiagnosis(providedDiagnosis: string, fault: string, faultBreakdown: string, summary: string): string {
  const preferred = cleanLine(providedDiagnosis);
  if (preferred && !looksLowValueDiagnosis(preferred)) return preferred;

  const breakdown = cleanLine(faultBreakdown);
  if (breakdown && breakdown !== "SPN/FMI breakdown unavailable from live feed.") return breakdown;

  const faultLine = cleanLine(fault);
  if (faultLine && faultLine !== "Fault description unavailable" && !looksLowValueDiagnosis(faultLine)) return faultLine;

  return cleanLine(summary);
}

function toMechanicPrognosis(providedPrognosis: string, sourceStatus: string, safety: string, projectedRepair: string): string {
  const preferred = cleanLine(providedPrognosis);
  if (preferred && !looksLowValueDiagnosis(preferred)) return preferred;

  const state = sourceStatus.toLowerCase() === "open" ? "active" : sourceStatus.toLowerCase();
  const safetySignal = safety && safety !== "Safety signal unavailable." ? safety : "Monitor risk until inspected.";
  const repairWindow =
    projectedRepair && projectedRepair !== "Projected repair window unavailable."
      ? projectedRepair
      : "Repair window depends on parts and bay availability.";
  return `${state.toUpperCase()}: ${safetySignal} ${repairWindow}`;
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

function extractDollarSignal(value: string, fallback: string): string {
  const matches = value.match(/\$\d[\d,]*(?:\s*-\s*\$\d[\d,]*)?/g);
  if (!matches || matches.length === 0) return fallback;
  const unique = Array.from(new Set(matches.map((entry) => entry.replace(/\s+/g, " ").trim())));
  return unique.slice(0, 2).join(" | ");
}

function extractLaborSignal(value: string, fallback: string): string {
  const match = value.match(/\b\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?\s*hrs?\b|\b\d+(?:\.\d+)?\s*hrs?\b/i);
  if (!match) return fallback;
  return match[0].replace(/\s+/g, " ").trim();
}

function deriveDowntimeSignal(labor: string): string {
  if (labor === "TBD") return "TBD";
  return `${labor} bay time`;
}

function isMeaningfulSignal(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  const hiddenValues = new Set([
    "tbd",
    "cost pending",
    "parts tbd",
    "exposure pending",
    "no prior spend",
    "projected repair window unavailable.",
    "historical repair spend unavailable.",
    "moderate liability risk if operating condition degrades.",
  ]);

  if (hiddenValues.has(normalized)) return false;
  return true;
}

type CostRow = {
  label: string;
  value: string;
};

function prioritizeCostRows(role: ViewerRole, rows: CostRow[]): CostRow[] {
  const priorityByRole: Record<ViewerRole, string[]> = {
    management: ["Exposure", "Downtime", "Liability", "Repair Parts", "Labor", "Decision Window", "Historical", "Parts Signal"],
    maintenance: ["Repair Parts", "Labor", "Downtime", "Parts Signal", "Liability", "Exposure", "Decision Window", "Historical"],
    driver: ["Downtime", "Liability", "Exposure", "Decision Window", "Repair Parts", "Labor", "Historical", "Parts Signal"],
    unknown: ["Exposure", "Downtime", "Liability", "Repair Parts", "Labor", "Decision Window", "Historical", "Parts Signal"],
  };

  const order = new Map<string, number>(priorityByRole[role].map((label, index) => [label, index]));
  return [...rows].sort((left, right) => {
    const leftRank = order.get(left.label) ?? 999;
    const rightRank = order.get(right.label) ?? 999;
    return leftRank - rightRank;
  });
}

function getBestAction(severity: string, rows: CostRow[]): string {
  const level = severity.trim().toLowerCase();
  const hasDowntime = rows.some((row) => row.label === "Downtime");
  const hasLiability = rows.some((row) => row.label === "Liability");
  const hasExposure = rows.some((row) => row.label === "Exposure");

  if (level === "critical" && (hasLiability || hasDowntime || hasExposure)) {
    return "Repair now before next dispatch";
  }

  if (level === "warning" || hasDowntime) {
    return "Repair end of shift with parts ready";
  }

  return "Monitor and schedule diagnostics";
}

function getConfidenceMeta(rowCount: number): { label: string; widthClass: string; toneClass: string } {
  if (rowCount >= 6) {
    return { label: "High", widthClass: "w-full", toneClass: "bg-emerald-400/90" };
  }
  if (rowCount >= 4) {
    return { label: "Medium", widthClass: "w-2/3", toneClass: "bg-amber-400/90" };
  }
  return { label: "Low", widthClass: "w-1/3", toneClass: "bg-rose-400/90" };
}

function MaintenanceAlertPopupContent() {
  const searchParams = useSearchParams();
  const asValue = (key: string) => searchParams.get(key) ?? undefined;

  const severity = decodeSafe(asValue("severity"), "critical");
  const title = decodeSafe(asValue("title"), "ASF TMS Critical Alert");
  const headline = decodeSafe(asValue("headline"), "Immediate attention required");
  const vehicle = decodeSafe(asValue("vehicle"), "Vehicle not provided");
  const fault = decodeSafe(asValue("fault"), "Fault description unavailable");
  const summary = decodeSafe(asValue("summary"), "Immediate review recommended.");
  const audience = decodeSafe(asValue("audience"), "maintenance,management");
  const viewerRole = pickViewerRole(asValue("role"), audience);
  const roleContent = getRoleContent(viewerRole);
  const action = decodeSafe(asValue("action"), roleContent.actionFallback);
  const decision = decodeSafe(asValue("decision"), "Confirm go/no-go operational decision for this unit.");
  const collaboration = decodeSafe(asValue("collaboration"), "Align maintenance and operations on owner, ETA, and escalation path.");
  const financial = decodeSafe(asValue("financial"), "Potential avoidable cost exposure if action is delayed.");
  const liability = decodeSafe(asValue("liability"), "Moderate liability risk if operating condition degrades.");
  const guidance = decodeSafe(asValue("guidance"), "AI guidance: assign owner, define ETA, and checkpoint outcome in this shift.");
  const safety = decodeSafe(asValue("safety"), "Safety signal unavailable.");
  const highValueParts = decodeSafe(asValue("highValueParts"), "No recent parts cost signal available.");
  const projectedRepair = decodeSafe(asValue("projectedRepair"), "Projected repair window unavailable.");
  const historicalSpend = decodeSafe(asValue("historicalSpend"), "Historical repair spend unavailable.");
  const decisionWindow = decodeSafe(asValue("decisionWindow"), "Decision window: now to next dispatch cycle.");
  const confidenceNote = decodeSafe(asValue("confidence"), "Confidence: based on latest telematics signal and alert history.");
  const sourceEventType = decodeSafe(asValue("sourceEventType"), "EngineFaultOn");
  const sourceStatus = decodeSafe(asValue("sourceStatus"), "open");
  const isTestMode = decodeSafe(asValue("testMode"), "0") === "1";
  const occurredAtRaw = decodeSafe(asValue("occurredAt"), new Date().toISOString());
  const occurredAt = useMemo(() => formatLocalDateTime(occurredAtRaw), [occurredAtRaw]);
  const providedDiagnosis = decodeSafe(asValue("mechanicDiagnosis"), "");
  const providedPrognosis = decodeSafe(asValue("mechanicPrognosis"), "");
  const faultBreakdown = decodeSafe(asValue("faultBreakdown"), "");

  const skin = getSkin(severity);
  const diagnosis = toMechanicDiagnosis(providedDiagnosis, fault, faultBreakdown, summary);
  const prognosis = toMechanicPrognosis(providedPrognosis, sourceStatus, safety, projectedRepair);
  const historicalCost = extractDollarSignal(historicalSpend, "No prior spend");
  const projectedCost = extractDollarSignal(projectedRepair, "Cost pending");
  const partsCost = extractDollarSignal(highValueParts, "Parts TBD");
  const exposureCost = extractDollarSignal(financial, "Exposure pending");
  const laborProjection = extractLaborSignal(projectedRepair, "TBD");
  const downtimeProjection = deriveDowntimeSignal(laborProjection);
  const decisionWindowSignal = cleanLine(decisionWindow);

  const costExposureRows = prioritizeCostRows(viewerRole, [
    { label: "Repair Parts", value: projectedCost },
    { label: "Labor", value: laborProjection },
    { label: "Downtime", value: downtimeProjection },
    { label: "Parts Signal", value: partsCost },
    { label: "Historical", value: historicalCost },
    { label: "Exposure", value: exposureCost },
    { label: "Liability", value: cleanLine(liability) },
    { label: "Decision Window", value: decisionWindowSignal },
  ].filter((row) => isMeaningfulSignal(row.value)));
  const bestAction = getBestAction(severity, costExposureRows);
  const confidence = getConfidenceMeta(costExposureRows.length);

  return (
    <main className="theme-page-shell relative min-h-screen overflow-hidden bg-slate-950 px-3 py-3 text-slate-100 sm:px-4 sm:py-5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_11%_15%,#f43f5e2c_0%,transparent_36%),radial-gradient(circle_at_85%_14%,#06b6d428_0%,transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#020617_0%,#0b1324_42%,#111827_100%)]" />
      </div>

      <section className="relative mx-auto w-full max-w-md">
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-950/82 px-3 py-3 sm:px-4 sm:py-5" role="dialog" aria-modal="true">
          <div className={`relative flex h-[calc(100svh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border ${skin.border} bg-slate-900/95 p-3 shadow-2xl sm:h-[calc(100svh-2.5rem)] sm:p-4`}>
            {isTestMode && (
              <div className="pointer-events-none absolute right-[-30px] top-[42px] rotate-90 rounded bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-950 shadow-lg">
                Test Drill
              </div>
            )}

            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300">ASF AI Alert Center</p>
                <h1 className="mt-1 line-clamp-2 text-base font-bold leading-tight text-slate-100 sm:text-lg">{title}</h1>
                <p className="mt-1 text-[11px] text-slate-300">Role: {roleContent.roleLabel}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${skin.chip}`}>
                {skin.label}
              </span>
            </div>

            <div className="mt-2 flex-1 space-y-2 overflow-y-auto pr-1">
              <div className={`rounded-xl border ${skin.border} ${skin.panel} p-2.5`}>
                <p className="text-sm text-slate-100 line-clamp-2">{summary}</p>
                <p className="mt-2 rounded-lg bg-slate-950/45 px-2 py-1.5 text-sm font-semibold text-white line-clamp-2">{headline}</p>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/65 p-2.5">
                <p className="line-clamp-1 text-xs text-slate-200"><span className="text-slate-400">Unit:</span> {vehicle}</p>
                <p className="mt-1 line-clamp-1 text-xs text-slate-200"><span className="text-slate-400">Time:</span> {occurredAt}</p>
                <p className="mt-1 line-clamp-1 text-xs text-slate-200"><span className="text-slate-400">Event:</span> {sourceEventType}</p>
                <p className="mt-1 line-clamp-1 text-xs uppercase text-slate-200"><span className="text-slate-400 normal-case">State:</span> {sourceStatus}</p>
              </div>

              <div className={`rounded-xl border ${skin.border} ${skin.panel} p-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-xs font-semibold text-white">Best action: {bestAction}</p>
                  <span className="shrink-0 rounded-full border border-slate-500/50 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-200">Confidence {confidence.label}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-800/80">
                  <div className={`h-1.5 rounded-full ${confidence.widthClass} ${confidence.toneClass}`} />
                </div>
                <div className="mt-1.5 space-y-1">
                  {costExposureRows.length > 0 ? (
                    costExposureRows.slice(0, 6).map((row) => (
                      <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-2 rounded bg-slate-950/55 px-2 py-1 text-[11px]">
                        <span className="text-slate-300">{row.label}</span>
                        <span className="line-clamp-1 text-right text-slate-100">{row.value}</span>
                      </div>
                    ))
                  ) : (
                    <p className="rounded bg-slate-950/55 px-2 py-1 text-[11px] text-slate-300">Detailed cost projection is still calculating for this alert.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/65 p-2.5">
                <p className="mt-1 line-clamp-2 text-sm text-slate-100">{diagnosis}</p>
                {faultBreakdown && faultBreakdown !== "SPN/FMI breakdown unavailable from live feed." && (
                  <p className="mt-1 line-clamp-1 text-[11px] text-slate-300">{faultBreakdown}</p>
                )}
                <p className="mt-2 line-clamp-2 text-xs text-slate-100">{prognosis}</p>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/65 p-2.5">
                <p className="mt-1 line-clamp-2 text-sm text-slate-100">{action}</p>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-950/65 p-2.5">
                <p className="mt-1 line-clamp-2 text-xs text-cyan-100">{decision}</p>
              </div>
            </div>

            <div className="mt-2 grid shrink-0 grid-cols-2 gap-2 border-t border-slate-800/80 pt-2">
              <a
                href={roleContent.primaryHref}
                className="rounded-lg border border-cyan-500/60 bg-cyan-500/20 px-3 py-2 text-center text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30"
              >
                {roleContent.primaryCta}
              </a>
              <a
                href="/fleet"
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-slate-100 hover:bg-slate-700"
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
