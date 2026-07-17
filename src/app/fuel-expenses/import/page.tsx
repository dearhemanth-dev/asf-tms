"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";

type ParsedRow = Record<string, unknown>;

type ParseResult = {
  rows: ParsedRow[];
  totalParsed: number;
  skipped: number;
  columns: string[];
};

type ConflictItem = {
  conflictKey: string;
  kind: "transaction_number_conflict";
  incoming: {
    uploadIndex: number;
    transaction_number: string | null;
    transaction_date: string | null;
    transaction_time: string | null;
    truck_stop_name: string | null;
    truck_stop_city: string | null;
    truck_stop_state: string | null;
    truck_stop_invoice_number: string | null;
    driver_name: string | null;
    unit_number: string | null;
    diesel_gallons: string | number | null;
    diesel_price_per_gallon: string | number | null;
    diesel_cost: string | number | null;
    total_amount_due_comdata: string | number | null;
  };
  existing: {
    id: string;
    transaction_number: string | null;
    transaction_date: string | null;
    transaction_time: string | null;
    truck_stop_name: string | null;
    truck_stop_city: string | null;
    truck_stop_state: string | null;
    truck_stop_invoice_number: string | null;
    driver_name: string | null;
    unit_number: string | null;
    diesel_gallons: string | number | null;
    diesel_price_per_gallon: string | number | null;
    diesel_cost: string | number | null;
    total_amount_due_comdata: string | number | null;
  };
};

type ValidateResponse = {
  action: "validate";
  totalRows: number;
  importableCount: number;
  exactDuplicates: Array<{
    uploadIndex: number;
    transaction_number: string | null;
    transaction_date: string | null;
    truck_stop_invoice_number: string | null;
  }>;
  conflicts: ConflictItem[];
  requiresReview: boolean;
};

type MissingDatesReport = {
  startDate: string;
  endDate: string;
  checkedDays: number;
  presentDays: number;
  missingCount: number;
  missingDates: string[];
  error?: string;
};

type MissingDatesState = "idle" | "loading" | "done";

type ImportState = "idle" | "parsing" | "previewing" | "importing" | "done" | "error";

const PREVIEW_COLUMNS = [
  { key: "transaction_date", label: "Date" },
  { key: "transaction_number", label: "Transaction #" },
  { key: "unit_number", label: "Unit #" },
  { key: "driver_name", label: "Driver" },
  { key: "truck_stop_name", label: "Truck Stop" },
  { key: "truck_stop_state", label: "State" },
  { key: "diesel_gallons", label: "Diesel Gal" },
  { key: "diesel_cost", label: "Diesel $" },
  { key: "total_amount_due_comdata", label: "Total $" },
];

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatLocation(city: string | null, state: string | null, name: string | null): string {
  const cityState = [city, state].filter(Boolean).join(", ");
  if (name && cityState) return `${name} (${cityState})`;
  return name || cityState || "—";
}

export default function FuelExpensesImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [session] = useState<{ ready: boolean; role: AppRole | null }>(() => {
    if (typeof window === "undefined") {
      return { ready: false, role: null };
    }

    const sessionRole = window.sessionStorage.getItem("demoRole");
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    return { ready: true, role: normalizedRole };
  });
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [importedCount, setImportedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missingDatesState, setMissingDatesState] = useState<MissingDatesState>("idle");
  const [missingDatesReport, setMissingDatesReport] = useState<MissingDatesReport | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [exactDuplicateCount, setExactDuplicateCount] = useState(0);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [decisionByConflictKey, setDecisionByConflictKey] = useState<Record<string, "keep_both" | "skip">>({});
  const [pendingConflictDecision, setPendingConflictDecision] = useState<{ conflictKey: string; decision: "keep_both" | "skip" } | null>(null);
  const [showDecisionConfirmModal, setShowDecisionConfirmModal] = useState(false);
  const [ackReviewedConflicts, setAckReviewedConflicts] = useState(false);
  const [ackUnderstandImpact, setAckUnderstandImpact] = useState(false);
  const [insertedSummary, setInsertedSummary] = useState<{ inserted: number; skippedConflicts: number; skippedExactDuplicates: number } | null>(null);
  const decidedCount = Object.keys(decisionByConflictKey).length;
  const unresolvedCount = Math.max(0, conflicts.length - decidedCount);
  const selectedKeepBothCount = Object.values(decisionByConflictKey).filter((value) => value === "keep_both").length;
  const selectedSkipCount = Object.values(decisionByConflictKey).filter((value) => value === "skip").length;
  const nonConflictInsertableCount = Math.max(0, (parseResult?.rows.length ?? 0) - exactDuplicateCount - conflicts.length);
  const projectedInsertCount = nonConflictInsertableCount + selectedKeepBothCount;

  useEffect(() => {
    if (session.ready && session.role !== "management" && session.role !== "accounts") {
      router.replace("/fleet");
    }
  }, [router, session.ready, session.role]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setParseResult(null);
    setImportState("idle");
    setErrorMessage(null);
    setImportedCount(0);
    setConflicts([]);
    setExactDuplicateCount(0);
    setShowConflictModal(false);
    setDecisionByConflictKey({});
    setPendingConflictDecision(null);
    setShowDecisionConfirmModal(false);
    setAckReviewedConflicts(false);
    setAckUnderstandImpact(false);
    setInsertedSummary(null);
  }

  async function handleCheckMissingDates() {
    setMissingDatesState("loading");
    setMissingDatesReport(null);
    try {
      const response = await fetch("/api/fuel-expenses/missing-dates", { cache: "no-store" });
      const payload = (await response.json()) as MissingDatesReport & { error?: string };
      if (!response.ok) {
        setMissingDatesReport({ startDate: "-", endDate: "-", checkedDays: 60, presentDays: 0, missingCount: 0, missingDates: [], error: payload.error ?? "Unable to check missing dates." });
      } else {
        setMissingDatesReport(payload);
      }
    } catch {
      setMissingDatesReport({ startDate: "-", endDate: "-", checkedDays: 60, presentDays: 0, missingCount: 0, missingDates: [], error: "Network error while checking missing dates." });
    } finally {
      setMissingDatesState("done");
    }
  }

  async function parseSelectedFile() {
    if (!file) {
      throw new Error("No file selected.");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/fuel-expenses/parse", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as ParseResult & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to read file.");
    }

    return payload;
  }

  async function handleParse() {
    if (!file) return;
    setImportState("parsing");
    setErrorMessage(null);
    setParseResult(null);

    try {
      const payload = await parseSelectedFile();

      setParseResult(payload);
      setMissingDatesReport(null);
      setConflicts([]);
      setExactDuplicateCount(0);
      setShowConflictModal(false);
      setDecisionByConflictKey({});
      setPendingConflictDecision(null);
      setShowDecisionConfirmModal(false);
      setAckReviewedConflicts(false);
      setAckUnderstandImpact(false);
      setInsertedSummary(null);
      setImportState("previewing");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Network error while reading file.");
      setImportState("error");
    }
  }

  async function handleImport() {
    if (!parseResult || parseResult.rows.length === 0) return;
    setImportState("importing");
    setErrorMessage(null);

    try {
      const validateResponse = await fetch("/api/fuel-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parseResult.rows, action: "validate" }),
      });

      const validatePayload = (await validateResponse.json()) as ValidateResponse & { error?: string };

      if (!validateResponse.ok) {
        setErrorMessage(validatePayload.error ?? "Unable to validate import.");
        setImportState("error");
        return;
      }

      setExactDuplicateCount(validatePayload.exactDuplicates.length);

      if (validatePayload.requiresReview && validatePayload.conflicts.length > 0) {
        setConflicts(validatePayload.conflicts);
        setDecisionByConflictKey({});
        setPendingConflictDecision(null);
        setShowDecisionConfirmModal(false);
        setAckReviewedConflicts(false);
        setAckUnderstandImpact(false);
        setShowConflictModal(true);
        setImportState("previewing");
        return;
      }

      const commitResponse = await fetch("/api/fuel-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parseResult.rows, action: "commit" }),
      });

      const payload = (await commitResponse.json()) as {
        inserted?: number;
        skippedConflicts?: number;
        skippedExactDuplicates?: number;
        error?: string;
      };

      if (!commitResponse.ok) {
        setErrorMessage(payload.error ?? "Import failed.");
        setImportState("error");
        return;
      }

      setImportedCount(payload.inserted ?? 0);
      setInsertedSummary({
        inserted: payload.inserted ?? 0,
        skippedConflicts: payload.skippedConflicts ?? 0,
        skippedExactDuplicates: payload.skippedExactDuplicates ?? 0,
      });
      setImportState("done");
    } catch {
      setErrorMessage("Network error during import.");
      setImportState("error");
    }
  }

  function openDecisionConfirmation(conflictKey: string, decision: "keep_both" | "skip") {
    if (!ackReviewedConflicts || !ackUnderstandImpact || importState === "importing") return;
    setPendingConflictDecision({ conflictKey, decision });
    setShowDecisionConfirmModal(true);
  }

  function confirmConflictDecision() {
    if (!pendingConflictDecision) return;
    const nextDecisionMap = {
      ...decisionByConflictKey,
      [pendingConflictDecision.conflictKey]: pendingConflictDecision.decision,
    };

    setDecisionByConflictKey(nextDecisionMap);
    setShowDecisionConfirmModal(false);
    setPendingConflictDecision(null);

    // If this was the last unresolved conflict and acknowledgements are done,
    // auto-commit so the user doesn't get stuck in the modal flow.
    if (ackReviewedConflicts && ackUnderstandImpact && Object.keys(nextDecisionMap).length === conflicts.length) {
      void submitCommitWithDecisions(nextDecisionMap);
    }
  }

  async function submitCommitWithDecisions(decisionMap: Record<string, "keep_both" | "skip">) {
    if (!parseResult || parseResult.rows.length === 0) return;

    const unresolved = conflicts.filter((conflict) => !decisionMap[conflict.conflictKey]).length;
    if (unresolved > 0) {
      setErrorMessage(`Please select and confirm a decision for all conflicts. Remaining: ${unresolved}.`);
      return;
    }

    setImportState("importing");
    setErrorMessage(null);

    try {
      const conflictDecisions = conflicts.map((conflict) => ({
        conflictKey: conflict.conflictKey,
        decision: decisionMap[conflict.conflictKey],
      }));

      const response = await fetch("/api/fuel-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: parseResult.rows,
          action: "commit",
          conflictDecisions,
          acknowledgements: {
            reviewedConflicts: ackReviewedConflicts,
            understandImpact: ackUnderstandImpact,
          },
        }),
      });

      const payload = (await response.json()) as {
        inserted?: number;
        skippedConflicts?: number;
        skippedExactDuplicates?: number;
        conflicts?: ConflictItem[];
        requiresReview?: boolean;
        error?: string;
      };

      if (!response.ok) {
        if (payload.requiresReview && Array.isArray(payload.conflicts)) {
          setConflicts(payload.conflicts);
          setShowConflictModal(true);
          setDecisionByConflictKey({});
          setShowDecisionConfirmModal(false);
          setPendingConflictDecision(null);
          setImportState("previewing");
          setErrorMessage(payload.error ?? "Conflict decisions are required before import.");
          return;
        }

        setErrorMessage(payload.error ?? "Import failed.");
        setImportState("error");
        return;
      }

      setImportedCount(payload.inserted ?? 0);
      setInsertedSummary({
        inserted: payload.inserted ?? 0,
        skippedConflicts: payload.skippedConflicts ?? 0,
        skippedExactDuplicates: payload.skippedExactDuplicates ?? 0,
      });
      setShowDecisionConfirmModal(false);
      setPendingConflictDecision(null);
      setShowConflictModal(false);
      setImportState("done");
    } catch {
      setErrorMessage("Network error during import.");
      setImportState("error");
    }
  }

  async function handleCommitWithDecisions() {
    await submitCommitWithDecisions(decisionByConflictKey);
  }

  function handleReset() {
    setFile(null);
    setParseResult(null);
    setImportState("idle");
    setErrorMessage(null);
    setImportedCount(0);
    setConflicts([]);
    setExactDuplicateCount(0);
    setShowConflictModal(false);
    setDecisionByConflictKey({});
    setPendingConflictDecision(null);
    setShowDecisionConfirmModal(false);
    setAckReviewedConflicts(false);
    setAckUnderstandImpact(false);
    setInsertedSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (!session.ready) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-950 text-slate-300">
        Loading...
      </main>
    );
  }

  if (session.role !== "management" && session.role !== "accounts") {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-950 text-rose-300">
        Manager or Accounts access required.
      </main>
    );
  }

  return (
    <main className="theme-page-shell min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#111827_100%)] text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-4 px-3 py-4 sm:px-4 lg:px-6">

        {/* Header */}
        <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-3 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Import Fuel Expenses
              </h1>
              <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                Upload a Comdata Excel export (.xlsx / .xls). Rows without a Transaction Number are skipped automatically.
              </p>
            </div>
            <button
              onClick={() => router.push("/fleet")}
              className="self-start rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10 sm:self-auto"
            >
              Back
            </button>
          </div>
        </section>

        {/* Check Missing Dates — DB check */}
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-100">Check Missing Dates</p>
              <p className="mt-1 text-xs text-slate-400">
                Checks the database for missing dates in the past 60 days (up to yesterday).
              </p>
            </div>
            <button
              onClick={() => void handleCheckMissingDates()}
              disabled={missingDatesState === "loading"}
              className="shrink-0 rounded-xl border border-amber-400/40 bg-amber-400/15 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {missingDatesState === "loading" ? "Checking..." : "Check Missing Dates"}
            </button>
          </div>

          {missingDatesReport && (
            <div className="mt-3 border-t border-amber-400/20 pt-3">
              {missingDatesReport.error ? (
                <p className="text-xs text-rose-300">{missingDatesReport.error}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-slate-300">Range: <span className="text-white">{missingDatesReport.startDate}</span> → <span className="text-white">{missingDatesReport.endDate}</span></span>
                    <span className="text-slate-300">Days with data: <span className="text-emerald-200">{missingDatesReport.presentDays}</span></span>
                    <span className="text-slate-300">Missing: <span className={missingDatesReport.missingCount > 0 ? "text-rose-300 font-semibold" : "text-emerald-200"}>{missingDatesReport.missingCount}</span></span>
                  </div>
                  {missingDatesReport.missingCount === 0 ? (
                    <p className="mt-2 text-xs text-emerald-200">No missing dates — all days covered in the database.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {missingDatesReport.missingDates.slice(0, 90).map((date) => (
                        <span key={date} className="rounded-full border border-rose-400/30 bg-rose-950/40 px-2 py-0.5 text-[11px] text-rose-200">
                          {date}
                        </span>
                      ))}
                      {missingDatesReport.missingDates.length > 90 && (
                        <span className="text-xs text-slate-400">+{missingDatesReport.missingDates.length - 90} more</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Upload card */}
        {importState !== "done" && (
          <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-4 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <p className="mb-3 text-sm font-medium text-slate-200">Step 1 — Choose file</p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-xs text-slate-400 mb-1" htmlFor="fuel-file-input">
                  Comdata export (.xlsx or .xls, max 10 MB)
                </label>
                <input
                  id="fuel-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  className="block w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-900/60 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-cyan-100 focus:outline-none"
                />
              </div>

              <button
                onClick={() => void handleParse()}
                disabled={!file || importState === "parsing" || importState === "importing"}
                className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importState === "parsing" ? "Reading file..." : "Review file"}
              </button>
            </div>

            {file && importState === "idle" && (
              <p className="mt-2 text-xs text-slate-400">
                Selected: <span className="text-slate-200">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </section>
        )}

        {/* Error */}
        {errorMessage && (
          <section className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {errorMessage}
            <button onClick={handleReset} className="ml-4 underline text-rose-200 text-xs hover:text-rose-100">
              Try again
            </button>
          </section>
        )}

        {/* Success */}
        {importState === "done" && (
          <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-4">
            <p className="text-base font-semibold text-emerald-100">
              Import complete — {importedCount} rows inserted into fuel_expenses.
            </p>
            {insertedSummary && (
              <p className="mt-2 text-xs text-emerald-100/90">
                Skipped conflicts: {insertedSummary.skippedConflicts} | Skipped exact duplicates: {insertedSummary.skippedExactDuplicates}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleReset}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Import another file
              </button>
              <button
                onClick={() => router.push("/fleet")}
                className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
              >
                Go to Fleet
              </button>
            </div>
          </section>
        )}

        {/* Preview */}
        {(importState === "previewing" || importState === "importing") && parseResult && (
          <>
            <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-4 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Step 2 — Review &amp; confirm import</p>
                  <p className="mt-1 text-xs text-slate-400">
                    <span className="text-white">{parseResult.totalParsed}</span> data rows ready to import.
                    {parseResult.skipped > 0 && (
                      <> &nbsp;<span className="text-amber-300">{parseResult.skipped} blank rows skipped.</span></>
                    )}
                  </p>
                  {exactDuplicateCount > 0 && (
                    <p className="mt-1 text-xs text-amber-200">
                      {exactDuplicateCount} exact duplicate rows will be skipped automatically.
                    </p>
                  )}
                  {conflicts.length > 0 && (
                    <p className="mt-1 text-xs text-cyan-200">
                      {conflicts.length} transaction conflicts need your decision before commit.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    Columns detected: {parseResult.columns.length}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={importState === "importing"}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleImport()}
                    disabled={importState === "importing" || parseResult.totalParsed === 0}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-wait disabled:opacity-60"
                  >
                    {importState === "importing"
                      ? "Importing..."
                      : conflicts.length > 0
                        ? "Review conflicts"
                        : `Import ${parseResult.totalParsed} rows`}
                  </button>
                </div>
              </div>
            </section>

            {/* Preview table — first 20 rows */}
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/65 shadow-[0_18px_40px_rgba(2,6,23,0.45)]">
              <p className="border-b border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Preview — first {Math.min(parseResult.rows.length, 20)} of {parseResult.totalParsed} rows
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {PREVIEW_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className="border border-white/10 bg-slate-900 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300 whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parseResult.rows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="hover:bg-white/3">
                        {PREVIEW_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className="border border-white/10 px-3 py-2 text-slate-200 whitespace-nowrap"
                          >
                            {displayCell(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {showConflictModal && conflicts.length > 0 && (
          <section className="fixed inset-0 z-50 bg-slate-950/80 px-3 py-4 sm:px-6">
            <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto rounded-2xl border border-cyan-400/30 bg-slate-950/95 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-100">Conflict Review Required</h2>
                  <p className="mt-1 text-xs text-slate-300">
                    Review each conflicting transaction and choose whether to keep both records or skip incoming.
                  </p>
                </div>
                <button
                  onClick={() => setShowConflictModal(false)}
                  className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
                >
                  Close (does not import)
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {conflicts.map((conflict) => {
                  const selectedDecision = decisionByConflictKey[conflict.conflictKey] ?? null;
                  return (
                    <article key={conflict.conflictKey} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-100">
                          Transaction #{displayCell(conflict.incoming.transaction_number)}
                        </p>
                        {selectedDecision ? (
                          <span className={selectedDecision === "keep_both" ? "rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200" : "rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[11px] font-semibold text-rose-200"}>
                            {selectedDecision === "keep_both" ? "Decision: Keep both" : "Decision: Skip incoming"}
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                            Decision pending
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200">Incoming (Upload)</p>
                          <p className="mt-1 text-xs text-slate-200">Date/Time: {displayCell(conflict.incoming.transaction_date)} {displayCell(conflict.incoming.transaction_time)}</p>
                          <p className="text-xs text-slate-200">Location: {formatLocation(conflict.incoming.truck_stop_city, conflict.incoming.truck_stop_state, conflict.incoming.truck_stop_name)}</p>
                          <p className="text-xs text-slate-200">Driver: {displayCell(conflict.incoming.driver_name)} | Unit: {displayCell(conflict.incoming.unit_number)}</p>
                          <p className="text-xs text-slate-200">Invoice: {displayCell(conflict.incoming.truck_stop_invoice_number)}</p>
                          <p className="text-xs text-slate-200">Diesel: {displayCell(conflict.incoming.diesel_gallons)} gal @ ${displayCell(conflict.incoming.diesel_price_per_gallon)}</p>
                          <p className="text-xs text-slate-200">Diesel Cost: ${displayCell(conflict.incoming.diesel_cost)} | Total: ${displayCell(conflict.incoming.total_amount_due_comdata)}</p>
                        </div>

                        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200">Existing (Database)</p>
                          <p className="mt-1 text-xs text-slate-200">Date/Time: {displayCell(conflict.existing.transaction_date)} {displayCell(conflict.existing.transaction_time)}</p>
                          <p className="text-xs text-slate-200">Location: {formatLocation(conflict.existing.truck_stop_city, conflict.existing.truck_stop_state, conflict.existing.truck_stop_name)}</p>
                          <p className="text-xs text-slate-200">Driver: {displayCell(conflict.existing.driver_name)} | Unit: {displayCell(conflict.existing.unit_number)}</p>
                          <p className="text-xs text-slate-200">Invoice: {displayCell(conflict.existing.truck_stop_invoice_number)}</p>
                          <p className="text-xs text-slate-200">Diesel: {displayCell(conflict.existing.diesel_gallons)} gal @ ${displayCell(conflict.existing.diesel_price_per_gallon)}</p>
                          <p className="text-xs text-slate-200">Diesel Cost: ${displayCell(conflict.existing.diesel_cost)} | Total: ${displayCell(conflict.existing.total_amount_due_comdata)}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          onClick={() => openDecisionConfirmation(conflict.conflictKey, "skip")}
                          disabled={!ackReviewedConflicts || !ackUnderstandImpact || importState === "importing"}
                          className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/20 disabled:opacity-50"
                        >
                          Skip incoming
                        </button>
                        <button
                          onClick={() => openDecisionConfirmation(conflict.conflictKey, "keep_both")}
                          disabled={!ackReviewedConflicts || !ackUnderstandImpact || importState === "importing"}
                          className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                        >
                          Keep both
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/75 p-3">
                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={ackReviewedConflicts}
                    onChange={(event) => setAckReviewedConflicts(event.target.checked)}
                    className="h-4 w-4"
                  />
                  I reviewed all conflicts shown above.
                </label>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={ackUnderstandImpact}
                    onChange={(event) => setAckUnderstandImpact(event.target.checked)}
                    className="h-4 w-4"
                  />
                  I understand these decisions affect expenses and reporting totals.
                </label>
                <p className="mt-3 text-xs text-slate-300">
                  Decisions confirmed: {decidedCount} / {conflicts.length} | Pending: {unresolvedCount}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Selected keep both: {selectedKeepBothCount} | Selected skip incoming: {selectedSkipCount}
                </p>
                <p className="mt-1 text-xs text-cyan-200">
                  Projected inserts after selections: {projectedInsertCount} (exact duplicates auto-skipped: {exactDuplicateCount})
                </p>
              </div>

              <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-2 border-t border-white/10 bg-slate-950/95 pt-3">
                <button
                  onClick={() => setShowConflictModal(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCommitWithDecisions()}
                  disabled={!ackReviewedConflicts || !ackUnderstandImpact || unresolvedCount > 0 || importState === "importing"}
                  className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  {importState === "importing" ? "Committing..." : "Commit selected decisions and import"}
                </button>
              </div>
            </div>
          </section>
        )}

        {showDecisionConfirmModal && pendingConflictDecision && (
          <section className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/85 px-3 py-4 sm:px-6">
            <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-950 p-4 shadow-2xl">
              <h3 className="text-base font-semibold text-white">
                Confirm conflict decision
              </h3>
              <p className="mt-2 text-sm text-slate-300">
                {pendingConflictDecision.decision === "keep_both"
                  ? "Set this conflict to KEEP BOTH?"
                  : "Set this conflict to SKIP INCOMING?"}
              </p>
              <p className="mt-2 text-xs text-slate-300">
                This applies only to transaction #{displayCell(conflicts.find((c) => c.conflictKey === pendingConflictDecision.conflictKey)?.incoming.transaction_number)}.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                You can still change this decision before final commit.
              </p>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowDecisionConfirmModal(false);
                    setPendingConflictDecision(null);
                  }}
                  disabled={importState === "importing"}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-50"
                >
                  No, go back
                </button>
                <button
                  onClick={confirmConflictDecision}
                  disabled={importState === "importing"}
                  className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
                >
                  Yes, confirm decision
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
