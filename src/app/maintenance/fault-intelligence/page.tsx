"use client";

import { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import { normalizeAppRole, type AppRole } from "@/lib/auth";

type FaultKnowledgeRow = {
  id: number;
  spn: number;
  fmi: number;
  affected_system: string;
  mechanic_repair_steps: string;
  operational_danger: string;
  mechanic_speak: string;
  default_dispatch_action: string;
  source_type: string;
};

type PersonaOutput = {
  driver_speak?: Record<string, unknown>;
  mechanic_speak?: Record<string, unknown>;
  dispatcher_speak?: Record<string, unknown>;
  manager_speak?: Record<string, unknown>;
};

type PersonaNarratives = {
  driver: string;
  dispatcher: string;
  mechanic: string;
  manager: string;
};

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function toDisplayName(username: string): string {
  const value = username.trim();
  if (!value) return "ASF User";
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listToSentence(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.map((item) => asString(item)).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "Not provided";
  }

  const plain = asString(value);
  return plain || "Not provided";
}

function resourceLabel(token: string): string {
  const normalized = token.trim().toUpperCase();
  if (normalized === "PARTS_REQUIRED") return "Replacement parts and consumables";
  if (normalized === "LABOR_ONLY") return "Labor diagnostics and physical inspection";
  if (normalized === "DIAGNOSTIC_SOFTWARE_FLASH") return "OEM diagnostic software/flash session";
  return token;
}

function decodeResources(value: unknown): string {
  if (!Array.isArray(value)) return listToSentence(value);
  const labels = value
    .map((item) => resourceLabel(asString(item)))
    .filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "Not provided";
}

function mechanicReferenceSteps(selectedFault: FaultKnowledgeRow | null): string {
  if (!selectedFault) return "No baseline repair procedure available.";
  const text = selectedFault.mechanic_repair_steps.trim();
  if (!text) return "No baseline repair procedure available.";
  const lines = text
    .split(/(?=\d+\)|\d+\.|- )/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  return lines.length > 0 ? lines.join("\n") : text;
}

function compactList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => asString(item)).filter(Boolean).join(", ");
  }
  return asString(value);
}

type EstimateRow = {
  label: string;
  value: string;
};

function areEquivalentEstimates(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left.replace(/\s+/g, "").toLowerCase() === right.replace(/\s+/g, "").toLowerCase();
}

function pushIf(rows: EstimateRow[], label: string, value: string): void {
  if (!value) return;
  rows.push({ label, value });
}

function buildManagerEstimateRows(source: Record<string, unknown>): EstimateRow[] {
  const total = asString(source.total_estimated_cost_usd);
  const partsCost = asString(source.parts_cost_usd);
  const likelyPartsCost = asString(source.likely_parts_costs_usd);
  const laborHours = asString(source.estimated_labor_hours);
  const shopRate = asString(source.standard_shop_rate_usd_per_hour);
  const roadsideRate = asString(source.roadside_rate_usd_per_hour);
  const laborCost = asString(source.labor_cost_usd);
  const likelyLaborCost = asString(source.likely_labor_costs_usd);
  const towCost = asString(source.tow_cost_usd);
  const roadsideFee = asString(source.roadside_fee_usd);
  const roadsideExposure = asString(source.estimated_roadside_cost_usd);
  const summary = asString(source.cost_breakdown_summary);

  const rows: EstimateRow[] = [];
  pushIf(rows, "Total estimated cost", total);
  pushIf(rows, "Roadside exposure", roadsideExposure);

  if (likelyPartsCost) {
    pushIf(rows, "Parts cost", likelyPartsCost);
    if (partsCost && !areEquivalentEstimates(likelyPartsCost, partsCost)) {
      pushIf(rows, "Parts cost (baseline)", partsCost);
    }
  } else {
    pushIf(rows, "Parts cost", partsCost);
  }

  if (likelyLaborCost) {
    pushIf(rows, "Labor cost", likelyLaborCost);
    if (laborCost && !areEquivalentEstimates(likelyLaborCost, laborCost)) {
      pushIf(rows, "Labor cost (baseline)", laborCost);
    }
  } else {
    pushIf(rows, "Labor cost", laborCost);
  }

  pushIf(rows, "Estimated labor hours", laborHours);
  if (shopRate || roadsideRate) {
    pushIf(rows, "Labor rates (shop / roadside)", `${shopRate || "N/A"} / ${roadsideRate || "N/A"}`);
  }
  pushIf(rows, "Tow / recovery", towCost);
  pushIf(rows, "Emergency road-call fee", roadsideFee);
  pushIf(rows, "Why this bill happens", summary);

  if (rows.length === 0) {
    rows.push({ label: "Estimate", value: "Not provided" });
  }

  return rows;
}

function renderEstimateTable(source: Record<string, unknown> | null) {
  if (!source) {
    return <p className="mt-2 text-xs text-slate-400">No estimate captured yet.</p>;
  }

  const rows = buildManagerEstimateRows(source);

  return (
    <div className="mt-2 overflow-hidden rounded border border-slate-800">
      <table className="w-full border-collapse text-left text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-800 last:border-b-0">
              <th className="w-1/2 bg-slate-950/80 px-3 py-2 font-medium text-slate-300">{row.label}</th>
              <td className="bg-slate-950 px-3 py-2 text-slate-100">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-800 bg-slate-950/90 px-3 py-2 text-[11px] text-slate-400">
        Numeric estimates are generated from the deterministic rule engine; AI is used for the narrative layer only.
      </div>
    </div>
  );
}

function renderManagerIntelligence(source: Record<string, unknown> | null, title: string) {
  if (!source) {
    return <p className="mt-2 text-xs text-slate-400">No manager intelligence captured yet.</p>;
  }

  const recurrence = asString(source.root_cause_recurrence_intelligence) || "Not provided";
  const riskDrivers = asString(source.risk_drivers) || asString(source.failure_risk_drivers) || "Not provided";
  const preventivePlan =
    asString(source.preventive_action_plan) ||
    asString(source.preventive_plan) ||
    asString(source.recurrence_prevention_plan) ||
    "Not provided";

  return (
    <div className="mt-2 overflow-hidden rounded border border-slate-800">
      <div className="border-b border-slate-800 bg-slate-950/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
        {title}
      </div>
      <div className="space-y-2 bg-slate-950 px-3 py-2 text-xs text-slate-100">
        <p>
          <span className="font-semibold text-slate-300">Recurrence intelligence:</span> {recurrence}
        </p>
        <p>
          <span className="font-semibold text-slate-300">Risk drivers:</span> {riskDrivers}
        </p>
        <p>
          <span className="font-semibold text-slate-300">Preventive action plan:</span> {preventivePlan}
        </p>
      </div>
    </div>
  );
}

function extractPersonaOutput(responsePayload: Record<string, unknown> | null): PersonaOutput | null {
  if (!responsePayload) return null;

  const nested = asObject(responsePayload.output);
  const source = nested ?? responsePayload;

  return {
    driver_speak: asObject(source.driver_speak) ?? undefined,
    mechanic_speak: asObject(source.mechanic_speak) ?? undefined,
    dispatcher_speak: asObject(source.dispatcher_speak) ?? undefined,
    manager_speak: asObject(source.manager_speak) ?? undefined,
  };
}

function buildNarratives(source: PersonaOutput | null, selectedFault: FaultKnowledgeRow | null): PersonaNarratives {
  if (!source) {
    return {
      driver: "No run captured yet.",
      dispatcher: "No run captured yet.",
      mechanic: "No run captured yet.",
      manager: "No run captured yet.",
    };
  }

  const driver = source.driver_speak ?? {};
  const mechanic = source.mechanic_speak ?? {};
  const dispatcher = source.dispatcher_speak ?? {};
  const manager = source.manager_speak ?? {};

  const severity = asString(driver.severity) || "Not provided";
  const safeMiles = asString(driver.safe_miles_remaining) || "Not provided";
  const safetyDetails = asString(driver.safety_details) || "Not provided";

  const requiredResources = listToSentence(mechanic.required_resources);
  const inspectionFocus = asString(mechanic.inspection_focus) || "Not provided";
  const likelyFailureChain = asString(mechanic.likely_failure_chain);
  const first30MinActions = listToSentence(mechanic.first_30_minute_actions);
  const partsToPreStage = listToSentence(mechanic.parts_to_pre_stage);
  const likelyPartsNeeded = compactList(mechanic.likely_parts_needed) || "Not provided";
  const laborTimeEstimate = asString(mechanic.labor_time_estimate_hours) || "Not provided";
  const partsSpecifics = asString(mechanic.parts_specifics) || "Not provided";

  const milesVsDeliveryStatus = asString(dispatcher.miles_vs_delivery_status) || "Not provided";
  const postBreakdownTimeline = asString(dispatcher.post_breakdown_timeline_hours) || "Not provided";

  const recurrenceIntel = asString(manager.root_cause_recurrence_intelligence) || "Not provided";

  return {
    driver:
      `Severity: ${severity}.\n` +
      `Safe miles remaining: ${safeMiles}.\n` +
      `Driver action: ${safetyDetails}`,
    dispatcher:
      `Dispatch impact: ${milesVsDeliveryStatus}\n` +
      `If breakdown happens, expected downtime: ${postBreakdownTimeline} hours window.`,
    mechanic:
      `Resources to stage: ${decodeResources(mechanic.required_resources) || requiredResources}.\n` +
      `Likely parts needed: ${likelyPartsNeeded}.\n` +
      `Parts specifics: ${partsSpecifics}.\n` +
      `Labor time estimate: ${laborTimeEstimate}.\n` +
      `First inspection focus: ${inspectionFocus}\n` +
      `First 30-minute actions: ${first30MinActions !== "Not provided" ? first30MinActions : mechanicReferenceSteps(selectedFault)}\n` +
      `Pre-stage parts/tools: ${partsToPreStage !== "Not provided" ? partsToPreStage : decodeResources(mechanic.required_resources)}${
        likelyFailureChain ? `\nLikely failure chain: ${likelyFailureChain}` : ""
      }`,
    manager: `Recurrence intelligence: ${recurrenceIntel}`,
  };
}

export default function FaultIntelligencePage() {
  const [modelProfile, setModelProfile] = useState<"economy" | "balanced" | "trusted">("balanced");
  const [executionMode, setExecutionMode] = useState<"auto" | "ai" | "local">("auto");
  const [vin, setVin] = useState("");
  const [truckMileage, setTruckMileage] = useState("1002450");
  const [remainingTripDistance, setRemainingTripDistance] = useState("");
  const [samsaraVehicleId, setSamsaraVehicleId] = useState("");
  const [faultRows, setFaultRows] = useState<FaultKnowledgeRow[]>([]);
  const [selectedFaultId, setSelectedFaultId] = useState("");
  const [loadingFaults, setLoadingFaults] = useState(false);
  const [faultsError, setFaultsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<Record<string, unknown> | null>(null);
  const [localOutput, setLocalOutput] = useState<Record<string, unknown> | null>(null);
  const [aiOutput, setAiOutput] = useState<Record<string, unknown> | null>(null);
  const [lastMode, setLastMode] = useState<string | null>(null);

  const { username, role, fullName } = useMemo(() => {
    const sessionUsername = typeof window !== "undefined" ? window.sessionStorage.getItem("demoUsername") ?? "" : "";
    const cookieUsername = readCookie("asf_login");
    const username = (sessionUsername || cookieUsername).trim();

    const sessionRole = typeof window !== "undefined" ? window.sessionStorage.getItem("demoRole") ?? "" : "";
    const cookieRole = readCookie("asf_role");
    const role = normalizeAppRole(sessionRole || cookieRole || "maintenance") as AppRole;

    return {
      username,
      role,
      fullName: toDisplayName(username),
    };
  }, []);

  const isHkMaintenance = username.trim().toLowerCase() === "hkmaintenance";

  const selectedFault = useMemo(() => {
    if (faultRows.length === 0) return null;
    if (!selectedFaultId) return faultRows[0];
    return faultRows.find((row) => String(row.id) === selectedFaultId) ?? faultRows[0];
  }, [faultRows, selectedFaultId]);

  const readableOutput = useMemo(() => extractPersonaOutput(output), [output]);
  const readableAiOutput = useMemo(() => extractPersonaOutput(aiOutput), [aiOutput]);
  const readableLocalOutput = useMemo(() => extractPersonaOutput(localOutput), [localOutput]);
  const latestNarratives = useMemo(() => buildNarratives(readableOutput, selectedFault), [readableOutput, selectedFault]);
  const aiNarratives = useMemo(() => buildNarratives(readableAiOutput, selectedFault), [readableAiOutput, selectedFault]);
  const localNarratives = useMemo(() => buildNarratives(readableLocalOutput, selectedFault), [readableLocalOutput, selectedFault]);
  const decodedAssetProfile = useMemo(() => {
    const root = asObject(output);
    const inputContext = asObject(root?.input_context);
    return asObject(inputContext?.asset_profile);
  }, [output]);

  useEffect(() => {
    if (!isHkMaintenance) return;

    let cancelled = false;

    async function loadFaultKnowledgeRows() {
      setLoadingFaults(true);
      setFaultsError(null);

      try {
        const response = await fetch("/api/maintenance/fault-intelligence/options", {
          method: "GET",
          cache: "no-store",
        });

        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          if (!cancelled) {
            setFaultsError(typeof data.error === "string" ? data.error : "Failed to load fault knowledge rows.");
          }
          return;
        }

        const rows = Array.isArray(data.rows) ? (data.rows as FaultKnowledgeRow[]) : [];
        if (!cancelled) {
          setFaultRows(rows);
          if (rows.length > 0) {
            setSelectedFaultId(String(rows[0].id));
          }
        }
      } catch {
        if (!cancelled) {
          setFaultsError("Request failed while loading fault knowledge rows.");
        }
      } finally {
        if (!cancelled) {
          setLoadingFaults(false);
        }
      }
    }

    void loadFaultKnowledgeRows();

    return () => {
      cancelled = true;
    };
  }, [isHkMaintenance]);

  async function runTransform() {
    if (!selectedFault) {
      setError("Select a fault knowledge row first.");
      return;
    }

    setLoading(true);
    setError(null);
    setOutput(null);

    const payload = {
      model_profile: modelProfile,
      execution_mode: executionMode,
      spn: selectedFault.spn,
      fmi: selectedFault.fmi,
      affected_system: selectedFault.affected_system,
      mechanic_repair_steps: selectedFault.mechanic_repair_steps,
      operational_danger: selectedFault.operational_danger,
      truck_mileage: truckMileage.trim() ? Number(truckMileage) : null,
      remaining_trip_distance_miles: remainingTripDistance.trim() ? Number(remainingTripDistance) : null,
      samsara_vehicle_id: samsaraVehicleId.trim() || undefined,
      vin: vin.trim().toUpperCase() || undefined,
    };

    try {
      const response = await fetch("/api/maintenance/fault-intelligence/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Transform failed.");
        return;
      }

      setOutput(data);
      const mode = typeof data.mode === "string" ? data.mode : "unknown";
      setLastMode(mode);
      if (mode === "deterministic_local") {
        setLocalOutput(data);
      }
      if (mode === "ai_two_pass" || mode === "hybrid_trusted") {
        setAiOutput(data);
      }
    } catch {
      setError("Request failed. Please check network/API configuration.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <TopNav fullName={fullName} role={role} backHref="/fleet" backLabel="Fleet" />
      <main className="theme-page-shell mx-auto w-full max-w-6xl p-4 sm:p-6">
        <section className="rounded-2xl border border-cyan-800/50 bg-slate-900/75 p-5 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">Fault Intelligence</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Persona Transform Test Harness</h1>
          <p className="mt-3 text-sm text-slate-300">
            Test-only transformation flow for Driver, Mechanic, Dispatcher, and Manager views.
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200/90">
            No database writes in this workflow.
          </p>

          {isHkMaintenance ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/60 p-4">
                <p className="text-sm font-semibold text-emerald-200">Input Context</p>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Fault Knowledge Row (SPN/FMI)</span>
                  <select
                    value={selectedFault ? String(selectedFault.id) : ""}
                    onChange={(e) => setSelectedFaultId(e.target.value)}
                    disabled={loadingFaults || faultRows.length === 0}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm disabled:opacity-60"
                  >
                    {faultRows.map((row) => (
                      <option key={row.id} value={String(row.id)}>
                        SPN {row.spn} / FMI {row.fmi} - {row.affected_system}
                      </option>
                    ))}
                  </select>
                  {loadingFaults ? <p className="mt-1 text-[11px] text-slate-400">Loading fault knowledge rows...</p> : null}
                  {faultsError ? <p className="mt-1 text-[11px] text-rose-300">{faultsError}</p> : null}
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Execution Mode</span>
                  <p className="mb-2 text-[11px] text-slate-400">
                    Trusted Hybrid uses deterministic numbers and AI only for narrative text. That is the supported enterprise path.
                  </p>
                  <div className="grid grid-cols-3 gap-1 rounded border border-slate-700 bg-slate-950 p-1">
                    {[
                      { key: "auto", label: "Trusted Hybrid" },
                      { key: "ai", label: "Hybrid AI" },
                      { key: "local", label: "Deterministic Only" },
                    ].map((item) => {
                      const selected = executionMode === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setExecutionMode(item.key as "auto" | "ai" | "local")}
                          className={`rounded px-2 py-1 text-xs font-semibold ${selected ? "bg-cyan-900/55 text-cyan-100" : "text-slate-300 hover:bg-slate-800"}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">AI Model Profile</span>
                  <select
                    value={modelProfile}
                    onChange={(e) => setModelProfile(e.target.value as "economy" | "balanced" | "trusted")}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                  >
                    <option value="economy">Economy (gpt-4o-mini + gpt-4o-mini)</option>
                    <option value="balanced">Balanced (gpt-4o-mini + gpt-4o)</option>
                    <option value="trusted">Trusted (gpt-4o + gpt-4o)</option>
                  </select>
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-300">SPN</span>
                    <input value={selectedFault?.spn ?? ""} readOnly className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-300">FMI</span>
                    <input value={selectedFault?.fmi ?? ""} readOnly className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-300">Truck Mileage</span>
                    <input value={truckMileage} onChange={(e) => setTruckMileage(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-slate-300">Remaining Trip Miles</span>
                    <input value={remainingTripDistance} onChange={(e) => setRemainingTripDistance(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" placeholder="optional" />
                  </label>
                </div>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Affected System</span>
                  <input value={selectedFault?.affected_system ?? ""} readOnly className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Samsara Vehicle Id (optional)</span>
                  <input value={samsaraVehicleId} onChange={(e) => setSamsaraVehicleId(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm" placeholder="used when Truck Mileage is empty" />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">VIN (optional, improves asset-specific context)</span>
                  <input
                    value={vin}
                    onChange={(e) => setVin(e.target.value.toUpperCase())}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
                    placeholder="17-character VIN"
                    maxLength={17}
                  />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Mechanic Repair Steps</span>
                  <textarea value={selectedFault?.mechanic_repair_steps ?? ""} readOnly rows={6} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
                </label>

                <label className="block text-xs">
                  <span className="mb-1 block text-slate-300">Operational Danger</span>
                  <textarea value={selectedFault?.operational_danger ?? ""} readOnly rows={4} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
                </label>

                <button onClick={() => void runTransform()} disabled={loading} className="rounded border border-cyan-600 bg-cyan-900/40 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-800/45 disabled:opacity-60">
                  {loading ? "Transforming..." : "Run Persona Transform"}
                </button>
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-slate-950/60 p-4">
                <p className="text-sm font-semibold text-cyan-200">Output</p>
                <div className="mt-3 rounded border border-cyan-900/60 bg-cyan-950/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">What Hybrid AI Adds For Mechanics</p>
                  <p className="mt-1 text-xs text-slate-200">
                    AI can convert the same fault context into a likely failure chain, first 30-minute bay actions, and pre-stage guidance so the technician starts with a concrete plan instead of only resource tags.
                  </p>
                </div>
                {lastMode ? (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">Last run mode: {lastMode}</p>
                ) : null}
                {decodedAssetProfile ? (
                  <div className="mt-2 rounded border border-cyan-900/60 bg-cyan-950/20 p-2 text-[11px] text-cyan-100">
                    <p className="font-semibold uppercase tracking-[0.12em] text-cyan-300">VIN Asset Context</p>
                    <p className="mt-1">
                      VIN: {asString(decodedAssetProfile.vin) || "N/A"} | Year: {asString(decodedAssetProfile.year) || "N/A"} | Make: {asString(decodedAssetProfile.make) || "N/A"} | Model: {asString(decodedAssetProfile.model) || "N/A"}
                    </p>
                    <p className="mt-1">
                      Body: {asString(decodedAssetProfile.body_class) || "N/A"} | Fuel: {asString(decodedAssetProfile.fuel_type) || "N/A"} | Source: {asString(decodedAssetProfile.source) || "N/A"}
                    </p>
                  </div>
                ) : null}
                {error ? <p className="mt-3 rounded border border-rose-700/60 bg-rose-950/35 p-3 text-sm text-rose-200">{error}</p> : null}
                {!error && !output ? <p className="mt-3 text-sm text-slate-300">Run a transform to compare AI and Non-AI outputs in plain language.</p> : null}

                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <div className="rounded border border-cyan-800/60 bg-slate-950/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">AI narrative view</p>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Driver</span>
                      <textarea readOnly rows={4} value={aiNarratives.driver} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Dispatcher</span>
                      <textarea readOnly rows={4} value={aiNarratives.dispatcher} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Mechanic</span>
                      <textarea readOnly rows={4} value={aiNarratives.mechanic} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Manager</span>
                      {renderEstimateTable(readableAiOutput?.manager_speak ?? null)}
                      {renderManagerIntelligence(readableAiOutput?.manager_speak ?? null, "Manager intelligence (AI)")}
                      <p className="mt-2 whitespace-pre-line rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-200">
                        {aiNarratives.manager}
                      </p>
                    </label>
                  </div>

                  <div className="rounded border border-emerald-800/60 bg-slate-950/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300">Non-AI narrative view</p>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Driver</span>
                      <textarea readOnly rows={4} value={localNarratives.driver} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Dispatcher</span>
                      <textarea readOnly rows={4} value={localNarratives.dispatcher} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Mechanic</span>
                      <textarea readOnly rows={4} value={localNarratives.mechanic} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Manager</span>
                      {renderEstimateTable(readableLocalOutput?.manager_speak ?? null)}
                      {renderManagerIntelligence(readableLocalOutput?.manager_speak ?? null, "Manager intelligence (non-AI)")}
                      <p className="mt-2 whitespace-pre-line rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-200">
                        {localNarratives.manager}
                      </p>
                    </label>
                  </div>
                </div>

                {output ? (
                  <div className="mt-4 rounded border border-slate-800/80 bg-slate-950/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300">Latest run narrative snapshot</p>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Driver</span>
                      <textarea readOnly rows={4} value={latestNarratives.driver} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Dispatcher</span>
                      <textarea readOnly rows={4} value={latestNarratives.dispatcher} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Mechanic</span>
                      <textarea readOnly rows={4} value={latestNarratives.mechanic} className="w-full rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-100" />
                    </label>
                    <label className="mt-2 block text-xs">
                      <span className="mb-1 block text-slate-300">Manager</span>
                      {renderEstimateTable(readableOutput?.manager_speak ?? null)}
                      {renderManagerIntelligence(readableOutput?.manager_speak ?? null, "Manager intelligence (latest run)")}
                      <p className="mt-2 whitespace-pre-line rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-200">
                        {latestNarratives.manager}
                      </p>
                    </label>
                  </div>
                ) : null}

                <div className="mt-4 rounded border border-slate-800 bg-slate-950/70 p-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">JSON reference</p>
                  {output ? (
                    <details className="mt-2 rounded border border-slate-800 bg-slate-950/80 p-2" open={false}>
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Latest run raw JSON</summary>
                      <pre className="mt-2 max-h-[18rem] overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(output, null, 2)}
                      </pre>
                    </details>
                  ) : null}

                  {aiOutput ? (
                    <details className="mt-2 rounded border border-slate-800 bg-slate-950/80 p-2" open={false}>
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">AI snapshot raw JSON</summary>
                      <pre className="mt-2 max-h-[14rem] overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(aiOutput, null, 2)}
                      </pre>
                    </details>
                  ) : null}

                  {localOutput ? (
                    <details className="mt-2 rounded border border-slate-800 bg-slate-950/80 p-2" open={false}>
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Non-AI snapshot raw JSON</summary>
                      <pre className="mt-2 max-h-[14rem] overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(localOutput, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/35 p-4">
              <p className="text-sm font-semibold text-amber-200">Reserved test page.</p>
              <p className="mt-1 text-sm text-amber-100/90">
                This test harness is restricted to hkmaintenance.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
