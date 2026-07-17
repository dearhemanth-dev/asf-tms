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
  truck_stop_name: string | null;
  truck_stop_city: string | null;
  truck_stop_state: string | null;
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

type DetailContext = {
  tx: FuelTransactionLine;
  peers: FuelTransactionLine[];
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

function toReadableCase(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return normalized;

  const lettersOnly = normalized.replace(/[^A-Za-z]/g, "");
  const looksAllCaps = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
  if (!looksAllCaps) return normalized;

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStopName(transaction: FuelTransactionLine) {
  const stop = transaction.truck_stop_name?.trim();
  if (!stop) return "Unknown Truck Stop";
  return toReadableCase(stop);
}

function formatStopCityState(transaction: FuelTransactionLine) {
  const city = transaction.truck_stop_city?.trim();
  const state = transaction.truck_stop_state?.trim();
  const formattedCity = city ? toReadableCase(city) : null;
  if (formattedCity && state) return `${formattedCity}, ${state}`;
  if (formattedCity) return formattedCity;
  if (state) return state;
  return "Location unavailable";
}

function summarizeDrivers(transactions: FuelTransactionLine[]) {
  const unique = Array.from(
    new Set(
      transactions
        .map((item) => item.driver_name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  );

  if (unique.length === 0) return "Unassigned";
  if (unique.length <= 2) return unique.join(", ");
  return `${unique[0]}, ${unique[1]} +${unique.length - 2} more`;
}

function summarizeTopStops(transactions: FuelTransactionLine[]) {
  const counts = new Map<string, { label: string; count: number }>();

  for (const transaction of transactions) {
    const stopName = formatStopName(transaction);
    const cityState = formatStopCityState(transaction);
    const key = `${stopName}::${cityState}`;
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        label: cityState === "Location unavailable" ? stopName : `${stopName} (${cityState})`,
        count: 1,
      });
    }
  }

  const topStops = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);

  if (topStops.length === 0) return "No stop data";

  return topStops.map((stop) => `${stop.label} (${stop.count})`).join(" • ");
}

function getHighPriceThreshold(transactions: FuelTransactionLine[]) {
  const prices = transactions
    .map((transaction) => transaction.price_per_gallon)
    .filter((price): price is number => price !== null)
    .sort((a, b) => a - b);

  if (prices.length < 3) return null;
  if (prices[0] === prices[prices.length - 1]) return null;

  const thresholdIndex = Math.floor((prices.length - 1) * 0.75);
  return prices[thresholdIndex] ?? null;
}

function isHigherUnitPrice(pricePerGallon: number | null, threshold: number | null) {
  if (pricePerGallon === null || threshold === null) return false;
  return pricePerGallon >= threshold;
}

function getTypeSkin(type: FuelTransactionLine["type"]) {
  if (type === "Diesel") {
    return {
      panel: "border-cyan-500/30 bg-cyan-500/8 ring-cyan-500/20",
      chip: "border-cyan-300/30 bg-cyan-400/15 text-cyan-100",
      tableHead: "bg-cyan-900/30",
      stripe: "odd:bg-cyan-500/[0.04] even:bg-slate-950/30",
    };
  }

  if (type === "DEF") {
    return {
      panel: "border-emerald-500/30 bg-emerald-500/8 ring-emerald-500/20",
      chip: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
      tableHead: "bg-emerald-900/30",
      stripe: "odd:bg-emerald-500/[0.04] even:bg-slate-950/30",
    };
  }

  if (type === "Reefer") {
    return {
      panel: "border-indigo-500/30 bg-indigo-500/8 ring-indigo-500/20",
      chip: "border-indigo-300/30 bg-indigo-400/15 text-indigo-100",
      tableHead: "bg-indigo-900/30",
      stripe: "odd:bg-indigo-500/[0.04] even:bg-slate-950/30",
    };
  }

  if (type === "Cash Advance") {
    return {
      panel: "border-amber-500/30 bg-amber-500/8 ring-amber-500/20",
      chip: "border-amber-300/30 bg-amber-400/15 text-amber-100",
      tableHead: "bg-amber-900/30",
      stripe: "odd:bg-amber-500/[0.04] even:bg-slate-950/30",
    };
  }

  return {
    panel: "border-fuchsia-500/30 bg-fuchsia-500/8 ring-fuchsia-500/20",
    chip: "border-fuchsia-300/30 bg-fuchsia-400/15 text-fuchsia-100",
    tableHead: "bg-fuchsia-900/30",
    stripe: "odd:bg-fuchsia-500/[0.04] even:bg-slate-950/30",
  };
}

function transactionCategory(type: FuelTransactionLine["type"]) {
  if (type === "Diesel" || type === "DEF" || type === "Reefer") return "Fuel Purchase";
  if (type === "Cash Advance") return "Cash Advance";
  return "Operational Charge";
}

function transactionRankByTotal(tx: FuelTransactionLine, peers: FuelTransactionLine[]) {
  const sorted = [...peers].sort((a, b) => b.total - a.total);
  const rank = sorted.findIndex((entry) => entry.id === tx.id);
  if (rank < 0) return null;
  return `${rank + 1}/${sorted.length}`;
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
  const [detailTransaction, setDetailTransaction] = useState<DetailContext | null>(null);

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
        [cacheKey]: null,
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
    <main className="theme-light-flip theme-page-fuel-report min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#111827_100%)] text-slate-50">
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
                          <div className="space-y-2">
                            {typeRows.map((typeRow) => {
                              const isTypeExpanded = expandedType === typeRow.type;
                              const typeTransactions = drilldownData?.transactionsByType[typeRow.type] ?? [];
                              const highPriceThreshold = getHighPriceThreshold(typeTransactions);
                              const typeSkin = getTypeSkin(typeRow.type);
                              const showGallonsColumn = typeTransactions.some((tx) => tx.gallons !== null);
                              const showUnitPriceColumn = typeTransactions.some((tx) => tx.price_per_gallon !== null);
                              const tableMinWidthClass =
                                showGallonsColumn && showUnitPriceColumn
                                  ? "min-w-[600px]"
                                  : showGallonsColumn || showUnitPriceColumn
                                    ? "min-w-[540px]"
                                    : "min-w-[460px]";
                              const stopColWidthClass =
                                showGallonsColumn || showUnitPriceColumn ? "w-[132px]" : "w-[122px]";
                              return (
                                <div key={typeRow.type} className="space-y-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleType(cacheKey, typeRow.type)}
                                    className={`fuel-type-toggle w-full rounded-xl border p-3 text-left transition ${
                                      isTypeExpanded
                                        ? "border-cyan-300/30 bg-slate-900"
                                        : "border-white/10 bg-slate-900/70 hover:bg-slate-900"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                          <p className={`fuel-type-chip inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${typeSkin.chip}`}>
                                            {typeRow.type}
                                          </p>
                                        <p className="text-[11px] text-slate-300">{typeRow.transaction_count} transactions</p>
                                      </div>
                                      <p className="text-sm font-semibold text-emerald-200">{currency(typeRow.total)}</p>
                                    </div>
                                  </button>

                                  {isTypeExpanded && (
                                      <div className={`rounded-xl border p-3 ring-1 ${typeSkin.panel}`}>
                                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-white">{typeRow.type} Transactions</p>
                                          <p className="text-xs text-slate-400">Driver(s): {summarizeDrivers(typeTransactions)}</p>
                                          <p className="text-xs text-slate-300">Frequent Stops: {summarizeTopStops(typeTransactions)}</p>
                                        </div>
                                        <p className="w-fit rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">
                                          {typeTransactions.length} rows
                                        </p>
                                      </div>

                                        <div className="overflow-x-auto">
                                          <table className={`${tableMinWidthClass} table-fixed border-collapse`}>
                                          <colgroup>
                                            <col className="w-[80px]" />
                                            {showGallonsColumn && <col className="w-[58px]" />}
                                            {showUnitPriceColumn && <col className="w-[76px]" />}
                                            <col className={stopColWidthClass} />
                                            <col className="w-[80px]" />
                                            <col className="w-[64px]" />
                                            <col className="w-[44px]" />
                                          </colgroup>
                                          <thead>
                                            <tr>
                                                <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Total$</th>
                                                {showGallonsColumn && (
                                                  <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Gal</th>
                                                )}
                                                {showUnitPriceColumn && (
                                                  <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Unit$</th>
                                                )}
                                                <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>STOP</th>
                                                <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Date</th>
                                                <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Txn</th>
                                                <th className={`border border-white/10 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300 sm:px-3 sm:py-2 ${typeSkin.tableHead}`}>Info</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {typeTransactions.map((tx) => {
                                              const highUnitPrice = isHigherUnitPrice(tx.price_per_gallon, highPriceThreshold);
                                              return (
                                                <tr key={tx.id} className={`${typeSkin.stripe} hover:bg-white/5 ${highUnitPrice ? "bg-amber-300/8" : ""}`}>
                                                  <td className={`whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] font-semibold sm:px-3 sm:py-2 sm:text-xs ${highUnitPrice ? "text-amber-200" : "text-emerald-200"}`}>{currency(tx.total)}</td>
                                                  {showGallonsColumn && (
                                                    <td className={`whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs ${highUnitPrice ? "font-semibold text-amber-200" : "text-slate-200"}`}>{numberText(tx.gallons, 4)}</td>
                                                  )}
                                                  {showUnitPriceColumn && (
                                                    <td className={`whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs ${highUnitPrice ? "font-semibold text-amber-200" : "text-slate-200"}`}>
                                                      {tx.price_per_gallon === null ? "-" : `$${numberText(tx.price_per_gallon, 6)}`}
                                                    </td>
                                                  )}
                                                  <td className="border border-white/10 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs">
                                                    <p className="truncate font-medium text-cyan-200">{formatStopName(tx)}</p>
                                                    <p className="truncate text-slate-300">{formatStopCityState(tx)}</p>
                                                  </td>
                                                  <td className="whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] text-slate-200 sm:px-3 sm:py-2 sm:text-xs">{formatDateTime(tx.transaction_date, tx.transaction_time)}</td>
                                                  <td className="whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] text-slate-200 sm:px-3 sm:py-2 sm:text-xs">{tx.transaction_number}</td>
                                                  <td className="whitespace-nowrap border border-white/10 px-2 py-1.5 text-[11px] sm:px-3 sm:py-2 sm:text-xs">
                                                    <button
                                                      type="button"
                                                      onClick={() => setDetailTransaction({ tx, peers: typeTransactions })}
                                                      className="rounded-md border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:bg-white/15"
                                                    >
                                                      Details
                                                    </button>
                                                  </td>
                                                </tr>
                                            )})}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                  </div>
                              );
                            })}
                          </div>
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

      {detailTransaction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 p-3 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Transaction Details</p>
                <p className="mt-1 text-base font-semibold text-white">{formatStopName(detailTransaction.tx)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailTransaction(null)}
                className="rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs font-semibold text-slate-100 transition hover:bg-white/15"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Type</p>
                <p className="mt-1 font-semibold text-slate-100">{detailTransaction.tx.type}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Total $</p>
                <p className="mt-1 font-semibold text-emerald-200">{currency(detailTransaction.tx.total)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Category</p>
                <p className="mt-1 font-semibold text-slate-100">{transactionCategory(detailTransaction.tx.type)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Txn #</p>
                <p className="mt-1 font-semibold text-slate-100">{detailTransaction.tx.transaction_number}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Type Share</p>
                <p className="mt-1 font-semibold text-slate-100">
                  {detailTransaction.peers.length > 0
                    ? `${numberText(
                        (detailTransaction.tx.total /
                          detailTransaction.peers.reduce((sum, peer) => sum + peer.total, 0)) *
                          100,
                        2
                      )}%`
                    : "-"}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Rank In Type</p>
                <p className="mt-1 font-semibold text-slate-100">{transactionRankByTotal(detailTransaction.tx, detailTransaction.peers) ?? "-"}</p>
              </div>
              {detailTransaction.tx.driver_name && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Driver</p>
                  <p className="mt-1 font-semibold text-slate-100">{detailTransaction.tx.driver_name}</p>
                </div>
              )}
              {detailTransaction.tx.gallons !== null && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Gallons</p>
                  <p className="mt-1 font-semibold text-slate-100">{numberText(detailTransaction.tx.gallons, 4)}</p>
                </div>
              )}
              {detailTransaction.tx.price_per_gallon !== null && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Unit $</p>
                  <p className="mt-1 font-semibold text-slate-100">${numberText(detailTransaction.tx.price_per_gallon, 6)}</p>
                </div>
              )}
              {detailTransaction.tx.gallons !== null && detailTransaction.tx.gallons > 0 && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Effective $/Gal</p>
                  <p className="mt-1 font-semibold text-slate-100">${numberText(detailTransaction.tx.total / detailTransaction.tx.gallons, 6)}</p>
                </div>
              )}
              {detailTransaction.tx.gallons !== null &&
                detailTransaction.tx.gallons > 0 &&
                detailTransaction.tx.price_per_gallon !== null && (
                <>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Base Fuel $</p>
                    <p className="mt-1 font-semibold text-slate-100">
                      {currency(detailTransaction.tx.gallons * detailTransaction.tx.price_per_gallon)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Other Cost $</p>
                    <p className="mt-1 font-semibold text-slate-100">
                      {currency(
                        detailTransaction.tx.total -
                          detailTransaction.tx.gallons * detailTransaction.tx.price_per_gallon
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-slate-200">
              <p><span className="text-slate-400">Location:</span> {formatStopCityState(detailTransaction.tx)}</p>
              <p className="mt-1"><span className="text-slate-400">Date/Time:</span> {formatDateTime(detailTransaction.tx.transaction_date, detailTransaction.tx.transaction_time)}</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
