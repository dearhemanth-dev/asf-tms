"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";

type FuelUnitSummary = {
  unit_number: string;
  total_fuel_cost: number;
  row_count: number;
};

type FuelReportPeriod = "weekly" | "monthly";

type FuelTransactionLine = {
  id: string;
  transaction_number: string;
  transaction_date: string | null;
  transaction_time: string | null;
  driver_name: string | null;
  type: "Cash Advance" | "Diesel" | "DEF" | "Reefer" | "Other";
  price_per_gallon: number | null;
  gallons: number | null;
  total: number;
};

type FuelTypeSummary = {
  type: FuelTransactionLine["type"];
  total: number;
  transaction_count: number;
};

type FuelTypeDrilldown = {
  byType: FuelTypeSummary[];
  transactionsByType: Record<FuelTransactionLine["type"], FuelTransactionLine[]>;
  count: number;
};

type FuelReportResponse = {
  byUnit: FuelUnitSummary[];
  totalUnits: number;
  period?: FuelReportPeriod;
  startDate?: string;
  endDate?: string;
  error?: string;
};

type FuelDrilldownResponse = {
  unit: string;
  byType?: FuelTypeSummary[];
  transactionsByType?: Record<FuelTransactionLine["type"], FuelTransactionLine[]>;
  transactions: FuelTransactionLine[];
  count: number;
  period?: FuelReportPeriod;
  startDate?: string;
  endDate?: string;
  error?: string;
};

function currency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatDateTime(date: string | null, time: string | null) {
  if (!date && !time) return "-";
  if (!date) return time ?? "-";
  if (!time) return date;
  return `${date} ${time}`;
}

function numberText(value: number | null, maxFractionDigits: number) {
  if (value === null) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

export default function FuelReportPage() {
  const router = useRouter();
  const [session, setSession] = useState<{ ready: boolean; role: AppRole | null }>({
    ready: false,
    role: null,
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FuelUnitSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<FuelReportPeriod>("monthly");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedStartDate, setAppliedStartDate] = useState<string | null>(null);
  const [appliedEndDate, setAppliedEndDate] = useState<string | null>(null);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [drilldownCache, setDrilldownCache] = useState<Record<string, FuelTypeDrilldown>>({});
  const [expandedTypeByUnit, setExpandedTypeByUnit] = useState<Record<string, FuelTransactionLine["type"] | null>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionRole = window.sessionStorage.getItem("demoRole");
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    setSession({ ready: true, role: normalizedRole });
  }, []);

  useEffect(() => {
    if (session.ready && session.role !== "accounts" && session.role !== "management") {
      router.replace("/fleet");
      return;
    }

    if (!session.ready) return;

    async function loadReport() {
      setLoading(true);
      setError(null);
      setExpandedUnit(null);
      setDrilldownError(null);
      try {
        const query = new URLSearchParams({ period });
        if (fromDate) query.set("from", fromDate);
        if (toDate) query.set("to", toDate);

        const response = await fetch(`/api/fuel-expenses/report?${query.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as FuelReportResponse;
        if (!response.ok) {
          setError(payload.error ?? "Unable to load fuel report.");
          return;
        }
        setRows(payload.byUnit ?? []);
        setAppliedStartDate(payload.startDate ?? null);
        setAppliedEndDate(payload.endDate ?? null);
      } catch {
        setError("Network error while loading fuel report.");
      } finally {
        setLoading(false);
      }
    }

    void loadReport();
  }, [fromDate, period, router, session.ready, session.role, toDate]);

  const grandTotal = useMemo(() => rows.reduce((acc, r) => acc + r.total_fuel_cost, 0), [rows]);

  async function toggleUnit(unit: string) {
    if (expandedUnit === unit) {
      setExpandedUnit(null);
      setDrilldownError(null);
      return;
    }

    setExpandedUnit(unit);
    setDrilldownError(null);

    const cacheKey = `${period}::${fromDate || "none"}::${toDate || "none"}::${unit}`;

    if (drilldownCache[cacheKey]) {
      return;
    }

    setDrilldownLoading(true);
    try {
      const response = await fetch(
        `/api/fuel-expenses/report?unit=${encodeURIComponent(unit)}&period=${period}${
          fromDate ? `&from=${encodeURIComponent(fromDate)}` : ""
        }${toDate ? `&to=${encodeURIComponent(toDate)}` : ""}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as FuelDrilldownResponse;
      if (!response.ok) {
        setDrilldownError(payload.error ?? "Unable to load transaction drill-down.");
        return;
      }

      const transactionsByType = payload.transactionsByType ?? {
        "Cash Advance": [],
        Diesel: [],
        DEF: [],
        Reefer: [],
        Other: [],
      };

      setDrilldownCache((prev) => ({
        ...prev,
        [cacheKey]: {
          byType: payload.byType ?? [],
          transactionsByType,
          count: payload.count ?? 0,
        },
      }));

      setExpandedTypeByUnit((prev) => ({
        ...prev,
        [cacheKey]: (payload.byType ?? [])[0]?.type ?? null,
      }));
    } catch {
      setDrilldownError("Network error while loading unit transactions.");
    } finally {
      setDrilldownLoading(false);
    }
  }

  function toggleType(cacheKey: string, type: FuelTransactionLine["type"]) {
    setExpandedTypeByUnit((prev) => ({
      ...prev,
      [cacheKey]: prev[cacheKey] === type ? null : type,
    }));
  }

  if (!session.ready) {
    return <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-300">Loading...</main>;
  }

  if (session.role !== "accounts" && session.role !== "management") {
    return <main className="min-h-screen grid place-items-center bg-slate-950 text-rose-300">Accounts access required.</main>;
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#111827_100%)] text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-6">
        <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-3 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-4">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => router.push("/fleet")}
              className="w-fit rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Back
            </button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
              <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">Fuel Report by Unit</h1>
              <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                Filter by date range, then tap a unit to see Type totals and transactions by Type.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Active range: {appliedStartDate ?? "-"} to {appliedEndDate ?? "-"}
              </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setPeriod("weekly")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    period === "weekly"
                      ? "bg-cyan-400/20 text-cyan-100"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Past 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod("monthly")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    period === "monthly"
                      ? "bg-cyan-400/20 text-cyan-100"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Past 30 Days
                </button>
              </div>
              <label className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="rounded border border-white/10 bg-slate-900/80 px-1.5 py-0.5 text-xs text-slate-100"
                />
              </label>
              <label className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="rounded border border-white/10 bg-slate-900/80 px-1.5 py-0.5 text-xs text-slate-100"
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Clear Dates
                </button>
              )}
              <button
                onClick={() => router.push("/fuel-expenses/import")}
                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
              >
                Fuel Import
              </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-3 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Units</p>
              <p className="mt-1 text-xl font-semibold text-white">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Total fuel cost</p>
              <p className="mt-1 text-xl font-semibold text-emerald-200">{currency(grandTotal)}</p>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </section>
        )}

        <section className="space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-8 text-center text-sm text-slate-300">
              Loading fuel report...
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/65 px-4 py-8 text-center text-sm text-slate-300">
              No fuel records found.
            </div>
          ) : (
            rows.map((row, index) => {
              const isExpanded = expandedUnit === row.unit_number;
              const cacheKey = `${period}::${fromDate || "none"}::${toDate || "none"}::${row.unit_number}`;
              const drilldownData = drilldownCache[cacheKey];
              const typeRows = drilldownData?.byType ?? [];
              const expandedType = expandedTypeByUnit[cacheKey] ?? null;
              const selectedTypeTransactions = expandedType
                ? drilldownData?.transactionsByType[expandedType] ?? []
                : [];
              return (
                <article
                  key={`${row.unit_number}-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/65 shadow-[0_18px_40px_rgba(2,6,23,0.45)]"
                >
                  <button
                    type="button"
                    onClick={() => void toggleUnit(row.unit_number)}
                    className="w-full p-3 text-left transition hover:bg-white/5 sm:p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">#{index + 1} Unit</p>
                        <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">{row.unit_number}</h2>
                        <p className="mt-1 text-xs text-slate-300">{row.row_count} imported transactions</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-emerald-200 sm:text-base">{currency(row.total_fuel_cost)}</p>
                        <p className="mt-1 text-xs text-cyan-200">{isExpanded ? "Hide details" : "View details"}</p>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/10 bg-slate-950/70 px-3 py-3 sm:px-4 sm:py-4">
                      {drilldownLoading && !drilldownCache[cacheKey] && (
                        <p className="text-sm text-slate-300">Loading unit transactions...</p>
                      )}

                      {drilldownError && <p className="text-sm text-rose-300">{drilldownError}</p>}

                      {!drilldownLoading && !drilldownError && typeRows.length === 0 && (
                        <p className="text-sm text-slate-300">No Type-level transactions found for this unit.</p>
                      )}

                      {typeRows.length > 0 && (
                        <>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {typeRows.map((typeRow) => {
                              const isTypeExpanded = expandedType === typeRow.type;
                              return (
                                <button
                                  key={typeRow.type}
                                  type="button"
                                  onClick={() => toggleType(cacheKey, typeRow.type)}
                                  className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-left transition hover:bg-slate-900"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-semibold text-cyan-200">{typeRow.type}</p>
                                      <p className="text-[11px] text-slate-300">{typeRow.transaction_count} transactions</p>
                                    </div>
                                    <p className="text-sm font-semibold text-emerald-200">{currency(typeRow.total)}</p>
                                  </div>
                                  <p className="mt-1 text-[11px] text-slate-400">
                                    {isTypeExpanded ? "Hide transactions" : "View transactions"}
                                  </p>
                                </button>
                              );
                            })}
                          </div>

                          {expandedType && (
                            <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-cyan-100">{expandedType} Transactions</p>
                                <p className="text-xs text-slate-400">{selectedTypeTransactions.length} rows</p>
                              </div>

                              <div className="space-y-2 md:hidden">
                                {selectedTypeTransactions.map((tx) => (
                                  <div key={tx.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <p className="text-xs font-semibold text-cyan-200">{tx.type}</p>
                                        <p className="text-[11px] text-slate-300">Txn #{tx.transaction_number}</p>
                                      </div>
                                      <p className="text-sm font-semibold text-emerald-200">{currency(tx.total)}</p>
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                                      <p>Date/Time: {formatDateTime(tx.transaction_date, tx.transaction_time)}</p>
                                      <p>Driver: {tx.driver_name ?? "-"}</p>
                                      <p>Price/gal: {tx.price_per_gallon === null ? "-" : `$${numberText(tx.price_per_gallon, 6)}`}</p>
                                      <p>Gallons: {numberText(tx.gallons, 4)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="hidden overflow-x-auto md:block">
                                <table className="min-w-full border-collapse">
                                  <thead>
                                    <tr>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Date/Time</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Type</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Txn #</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Driver</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Price/gal</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Gallons</th>
                                      <th className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedTypeTransactions.map((tx) => (
                                      <tr key={tx.id} className="hover:bg-white/3">
                                        <td className="border border-white/10 px-3 py-2 text-xs text-slate-200">{formatDateTime(tx.transaction_date, tx.transaction_time)}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs font-medium text-cyan-200">{tx.type}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs text-slate-200">{tx.transaction_number}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs text-slate-200">{tx.driver_name ?? "-"}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs text-slate-200">{tx.price_per_gallon === null ? "-" : `$${numberText(tx.price_per_gallon, 6)}`}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs text-slate-200">{numberText(tx.gallons, 4)}</td>
                                        <td className="border border-white/10 px-3 py-2 text-xs font-semibold text-emerald-200">{currency(tx.total)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
