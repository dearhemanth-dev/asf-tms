"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";

type UserProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
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

type FaultDetail = {
  code: string;
  spn: string;
  fmi: string;
  severity: string;
  description: string;
  protocol: string;
  timestamp: string;
  raw: unknown;
};

type VehicleFaultView = {
  vehicleKey: string;
  vehicleLabel: string;
  sourceKeyIndex: number;
  faultCount: number;
  faults: FaultDetail[];
  rawVehicle: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
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

function normalizeFaultDetail(value: unknown): FaultDetail {
  const row = asRecord(value) ?? {};

  const code =
    toText(row.code) ||
    toText(row.dtc) ||
    toText(row.diagnosticTroubleCode) ||
    toText(row.sid) ||
    "-";

  const spn = toText(row.spn) || toText(row.suspectParameterNumber) || "-";
  const fmi = toText(row.fmi) || toText(row.failureModeIdentifier) || "-";
  const severity = toText(row.severity) || toText(row.level) || toText(row.priority) || "-";

  const description =
    toText(row.description) ||
    toText(row.label) ||
    toText(row.message) ||
    toText(row.name) ||
    "No description";

  const protocol = toText(row.protocol) || toText(row.sourceProtocol) || toText(row.standard) || "-";

  const timestamp =
    toText(row.detectedAtTime) ||
    toText(row.startTime) ||
    toText(row.time) ||
    toText(row.timestamp) ||
    toText(row.endTime) ||
    "-";

  return {
    code,
    spn,
    fmi,
    severity,
    description,
    protocol,
    timestamp,
    raw: value,
  };
}

function formatTime(value: string): string {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getDisplayName(username: string): string {
  return username || "User";
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

  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<FaultCodesResponse | null>(null);

  useEffect(() => {
    if (demoMode) {
      setLoadingProfile(false);
      return;
    }

    async function init() {
      const supabase = getSupabaseBrowserClient();

      const username = typeof window !== "undefined" ? window.sessionStorage.getItem("demoUsername") : null;
      if (username) {
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
      const response = await fetch("/api/samsara/fault-codes", { cache: "no-store" });
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

  useEffect(() => {
    if (loadingProfile || effectiveRole !== "maintenance") return;
    void loadFaultCodes(false);
  }, [loadingProfile, effectiveRole]);

  const vehicles = useMemo<VehicleFaultView[]>(() => {
    if (!payload?.faults?.length) return [];

    return payload.faults.map((row, index) => {
      const vehicleKey = row.vehicleId || `unknown-${index}`;
      const vehicleLabel = row.vehicleName?.trim() ? row.vehicleName : `Vehicle ${vehicleKey}`;
      const details = toList(row.faultCodes).map(normalizeFaultDetail);

      return {
        vehicleKey,
        vehicleLabel,
        sourceKeyIndex: row.sourceKeyIndex,
        faultCount: details.length,
        faults: details,
        rawVehicle: row.rawVehicle,
      };
    });
  }, [payload]);

  const totalFaults = useMemo(() => {
    return vehicles.reduce((sum, row) => sum + row.faultCount, 0);
  }, [vehicles]);

  if (loadingProfile) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading maintenance workspace...</main>;
  }

  if (effectiveRole !== "maintenance") {
    return <main className="min-h-screen grid place-items-center text-slate-300">Redirecting...</main>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <TopNav fullName={effectiveName} role="maintenance" compact />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Maintenance</p>
              <h1 className="mt-1 text-2xl font-black text-slate-100">Fault Codes</h1>
              <p className="mt-1 text-sm text-slate-300">Live vehicle fault-code feed from Samsara stats.</p>
            </div>

            <button
              type="button"
              onClick={() => void loadFaultCodes(true)}
              disabled={refreshing || loadingData}
              className="rounded-md border border-cyan-500/45 bg-cyan-700/25 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-700/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Vehicles Returned</p>
              <p className="mt-1 text-2xl font-extrabold text-cyan-200">{vehicles.length}</p>
            </article>
            <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Total Fault Records</p>
              <p className="mt-1 text-2xl font-extrabold text-amber-200">{totalFaults}</p>
            </article>
            <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Samsara Keys Used</p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-200">{payload?.keyCount ?? 0}</p>
            </article>
          </div>

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
              {vehicles.map((vehicle) => (
                <article key={`${vehicle.sourceKeyIndex}-${vehicle.vehicleKey}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-bold text-slate-100">{vehicle.vehicleLabel}</h2>
                      <p className="text-xs text-slate-400">Vehicle ID: {vehicle.vehicleKey}</p>
                    </div>
                    <span className="inline-flex w-fit rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                      {vehicle.faultCount} fault{vehicle.faultCount === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="mt-3 overflow-x-auto">
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
                            <td className="px-2 py-2">{formatTime(fault.timestamp)}</td>
                            <td className="px-2 py-2">{fault.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <details className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-300">Show raw payload</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-200">
                      {JSON.stringify(vehicle.rawVehicle, null, 2)}
                    </pre>
                  </details>
                </article>
              ))}
            </div>
          )}

          {payload?.failures && payload.failures.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-200">Some Samsara keys failed</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-100">
                {payload.failures.map((failure, idx) => (
                  <li key={`${failure.sourceKeyIndex}-${idx}`}>
                    Key #{failure.sourceKeyIndex + 1}: {failure.status ?? "n/a"} - {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
