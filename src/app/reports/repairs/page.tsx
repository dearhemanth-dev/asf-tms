"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, type AppRole } from "@/lib/auth";

type ParseConfidenceLevel = "high" | "medium" | "low";

type RepairLineItem = {
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string;
};

type RepairDraft = {
  breakdown_number: string;
  breakdown_time: string;
  breakdown_location: string;
  provider_name: string;
  provider_state: string;
  provider_country: string;
  provider_type: string;
  provider_account_id: string;
  source_document_hash: string;
  invoice_number: string;
  invoice_date: string;
  payment_due_date: string;
  po_so_number: string;
  bill_to_company: string;
  vendor_name: string;
  unit_number: string;
  vin: string;
  repair_category: string;
  notes: string;
  description: string;
  labor_amount: string;
  parts_amount: string;
  tax_amount: string;
  subtotal_amount: string;
  discount_amount: string;
  invoice_total: string;
  amount_due: string;
  total_amount: string;
  currency: string;
  source_file_name: string;
  raw_text_excerpt: string;
  line_items: RepairLineItem[];
  parse_confidence_level: ParseConfidenceLevel;
  parse_confidence_score: number;
  parse_confidence_reasons: string[];
  parse_warnings: string[];
};

type RepairsReportUnitSummary = {
  unit_number: string;
  total_repairs_cost: number;
  row_count: number;
  earliestInvoiceDate: string | null;
  assetType: string | null;
};

type RepairsReportInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  payment_due_date: string | null;
  notes_text: string | null;
  vendor_name: string | null;
  breakdown_location: string | null;
  breakdown_time: string | null;
  repair_category: string | null;
  discount_amount: number;
  unit_number: string;
  total_amount: number;
  currency: string | null;
  source_file_name: string | null;
  created_at: string | null;
  line_items: RepairLineItem[];
};

type RepairsReportPayload = {
  byUnit: RepairsReportUnitSummary[];
  totalUnits: number;
  period: "weekly" | "monthly";
  startDate: string;
  endDate: string;
};

type RepairsReportPeriod = "weekly" | "monthly";

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,$\s]/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildWarningList(warnings: Record<string, unknown> | undefined): string[] {
  if (!warnings) return [];
  return Object.entries(warnings)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key.replace(/_/g, " "));
}

function confidenceBadgeClass(level: ParseConfidenceLevel): string {
  if (level === "high") return "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
  if (level === "medium") return "border-amber-400/40 bg-amber-500/15 text-amber-200";
  return "border-rose-400/40 bg-rose-500/15 text-rose-200";
}

function money(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function moneyOrDash(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return money(value);
}

function formatDateOnly(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function RepairsParsingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [session, setSession] = useState<{ ready: boolean; role: AppRole | null }>({
    ready: false,
    role: null,
  });
  const [file, setFile] = useState<File | null>(null);
  const [unitOverride, setUnitOverride] = useState("");
  const [detectedUnitNumber, setDetectedUnitNumber] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<RepairDraft | null>(null);
  const [unitOverrideConfirm, setUnitOverrideConfirm] = useState<{ detected: string; current: string } | null>(null);
  const [showAdvancedTotals, setShowAdvancedTotals] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<RepairsReportPeriod>("weekly");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedStartDate, setAppliedStartDate] = useState<string | null>(null);
  const [appliedEndDate, setAppliedEndDate] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<RepairsReportPayload | null>(null);
  const [reportDetailLoading, setReportDetailLoading] = useState(false);
  const [reportDetailError, setReportDetailError] = useState<string | null>(null);
  const [selectedAssetUnit, setSelectedAssetUnit] = useState<string | null>(null);
  const [selectedAssetRows, setSelectedAssetRows] = useState<RepairsReportInvoice[]>([]);
  const [showUploadWorkflow, setShowUploadWorkflow] = useState(false);
  const [reportSortBy, setReportSortBy] = useState<"ranking" | "date">("ranking");
  const [saveErrorModalMessage, setSaveErrorModalMessage] = useState<string | null>(null);

  function selectReportPeriod(nextPeriod: RepairsReportPeriod) {
    setReportPeriod(nextPeriod);
    setFromDate("");
    setToDate("");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionRole = window.sessionStorage.getItem("demoRole");
    const normalizedRole = APP_ROLES.includes(sessionRole as AppRole) ? (sessionRole as AppRole) : null;
    setSession({ ready: true, role: normalizedRole });
  }, []);

  useEffect(() => {
    if (session.ready && session.role !== "accounts" && session.role !== "management") {
      router.replace("/fleet");
    }
  }, [router, session.ready, session.role]);

  useEffect(() => {
    if (!session.ready || (session.role !== "accounts" && session.role !== "management")) return;

    async function loadReport() {
      setReportLoading(true);
      setReportError(null);
      setReportDetailError(null);

      try {
        const query = new URLSearchParams({ period: reportPeriod });
        query.set("today", formatDateOnly(new Date()));
        if (fromDate) query.set("from", fromDate);
        if (toDate) query.set("to", toDate);

        const response = await fetch(`/api/repairs-expenses/report?${query.toString()}`, { cache: "no-store" });
        if (!response.ok) {
          const message = await safeReadErrorMessage(response, "Unable to load the repairs report.");
          setReportError(message);
          setReportData(null);
          setSelectedAssetUnit(null);
          setSelectedAssetRows([]);
          setAppliedStartDate(null);
          setAppliedEndDate(null);
          return;
        }

        const payload = (await response.json()) as RepairsReportPayload;

        setReportData(payload);
        setAppliedStartDate(payload.startDate ?? null);
        setAppliedEndDate(payload.endDate ?? null);

        setSelectedAssetUnit(null);
        setSelectedAssetRows([]);
      } catch {
        setReportError("Network error while loading the repairs report.");
        setReportData(null);
        setSelectedAssetUnit(null);
        setSelectedAssetRows([]);
        setAppliedStartDate(null);
        setAppliedEndDate(null);
      } finally {
        setReportLoading(false);
        setReportDetailLoading(false);
      }
    }

    void loadReport();
  }, [fromDate, reportPeriod, session.ready, session.role, toDate]);

  async function safeReadErrorMessage(response: Response, fallback: string) {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function handleParseInvoice() {
    if (!file) {
      setErrorMessage("Please choose a PDF invoice first.");
      setSuccessMessage(null);
      return;
    }

    setParseLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setDraft(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (unitOverride.trim()) {
        formData.append("unit_number", unitOverride.trim());
      }

      const response = await fetch("/api/repairs-expenses/import-invoice", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const message = await safeReadErrorMessage(response, "Unable to read the invoice.");
        setErrorMessage(message);
        return;
      }

      const payload = (await response.json()) as {
        row?: Record<string, unknown>;
        warnings?: Record<string, unknown>;
        confidence?: { level?: ParseConfidenceLevel; score?: number; reasons?: string[] };
      };

      const row = payload.row ?? {};
      const confidence = payload.confidence;
      const detectedUnit = String(row.unit_number ?? "");

      setDraft({
        breakdown_number: String(row.breakdown_number ?? ""),
        breakdown_time: String(row.breakdown_time ?? ""),
        breakdown_location: String(row.breakdown_location ?? ""),
        provider_name: String(row.provider_name ?? row.vendor_name ?? "Unknown"),
        provider_state: String(row.provider_state ?? ""),
        provider_country: String(row.provider_country ?? ""),
        provider_type: String(row.provider_type ?? "general"),
        provider_account_id: String(row.provider_account_id ?? ""),
        source_document_hash: String(row.source_document_hash ?? ""),
        invoice_number: String(row.invoice_number ?? ""),
        invoice_date: String(row.invoice_date ?? ""),
        payment_due_date: String(row.payment_due_date ?? ""),
        po_so_number: String(row.po_so_number ?? ""),
        bill_to_company: String(row.bill_to_company ?? ""),
        vendor_name: String(row.vendor_name ?? ""),
        unit_number: detectedUnit,
        vin: String(row.vin ?? ""),
        repair_category: String(row.repair_category ?? "General Repair"),
        notes: String(row.notes ?? ""),
        description: String(row.description ?? row.notes ?? ""),
        labor_amount: String(row.labor_amount ?? ""),
        parts_amount: String(row.parts_amount ?? ""),
        tax_amount: String(row.tax_amount ?? ""),
        subtotal_amount: String(row.subtotal_amount ?? ""),
        discount_amount: String(row.discount_amount ?? ""),
        invoice_total: String(row.invoice_total ?? row.total_amount ?? ""),
        amount_due: String(row.amount_due ?? row.total_amount ?? ""),
        total_amount: String(row.total_amount ?? row.amount_due ?? row.invoice_total ?? ""),
        currency: String(row.currency ?? "USD"),
        source_file_name: String(row.source_file_name ?? file.name),
        raw_text_excerpt: String(row.raw_text_excerpt ?? ""),
        line_items: Array.isArray(row.line_items) ? (row.line_items as RepairLineItem[]) : [],
        parse_confidence_level:
          confidence?.level === "high" || confidence?.level === "medium" || confidence?.level === "low"
            ? confidence.level
            : "medium",
        parse_confidence_score:
          typeof confidence?.score === "number" && Number.isFinite(confidence.score) ? confidence.score : 0,
        parse_confidence_reasons: Array.isArray(confidence?.reasons)
          ? confidence.reasons.filter((reason) => typeof reason === "string")
          : [],
        parse_warnings: buildWarningList(payload.warnings),
      });
      setDetectedUnitNumber(detectedUnit);
      setUnitOverride(detectedUnit);
      setShowUploadWorkflow(true);

      setSuccessMessage("Invoice is ready. Review each section and save.");
    } catch {
      setErrorMessage("Network error while reading the invoice.");
    } finally {
      setParseLoading(false);
    }
  }

  async function saveDraftRow(row: RepairDraft) {
    setSaveLoading(true);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/repairs-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row }),
      });

      if (!response.ok) {
        const message = await safeReadErrorMessage(response, "Failed to save repairs invoice.");
        setSaveErrorModalMessage(message);
        return;
      }

      setSuccessMessage(`Invoice ${row.invoice_number || "(no #)"} saved successfully.`);
      setDraft(null);
      setFile(null);
      setUnitOverride("");
      setDetectedUnitNumber("");
      setUnitOverrideConfirm(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setSaveErrorModalMessage("Network error while saving invoice.");
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleSaveDraft() {
    if (!draft) return;

    const normalizedDetectedUnit = detectedUnitNumber.trim();
    const normalizedCurrentUnit = (draft.unit_number ?? "").trim();
    const hasSensitiveOverride = normalizedCurrentUnit.length > 0 && normalizedCurrentUnit !== normalizedDetectedUnit;

    if (hasSensitiveOverride) {
      setUnitOverrideConfirm({
        detected: normalizedDetectedUnit || "(none)",
        current: normalizedCurrentUnit,
      });
      return;
    }

    await saveDraftRow(draft);
  }

  async function handleConfirmOverrideSave() {
    if (!draft) {
      setUnitOverrideConfirm(null);
      return;
    }

    setUnitOverrideConfirm(null);
    await saveDraftRow(draft);
  }

  function handleAcknowledgeSaveErrorModal() {
    setDraft(null);
    setFile(null);
    setUnitOverride("");
    setDetectedUnitNumber("");
    setSuccessMessage(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    setShowUploadWorkflow(true);
    setSaveErrorModalMessage(null);
    setUnitOverrideConfirm(null);
  }

  async function loadAssetDetail(unitNumber: string) {
    if (!reportData) return;

    if (selectedAssetUnit === unitNumber) {
      setSelectedAssetUnit(null);
      setSelectedAssetRows([]);
      setReportDetailError(null);
      return;
    }

    setSelectedAssetUnit(unitNumber);
    setReportDetailLoading(true);
    setReportDetailError(null);

    try {
      const response = await fetch(
        `/api/repairs-expenses?unit=${encodeURIComponent(unitNumber)}&from=${encodeURIComponent(reportData.startDate)}&to=${encodeURIComponent(reportData.endDate)}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        const message = await safeReadErrorMessage(response, "Unable to load asset details.");
        setReportDetailError(message);
        setSelectedAssetRows([]);
        return;
      }

      const payload = (await response.json()) as { rows?: RepairsReportInvoice[] };
      setSelectedAssetRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch {
      setReportDetailError("Network error while loading asset details.");
      setSelectedAssetRows([]);
    } finally {
      setReportDetailLoading(false);
    }
  }

  function updateLineItem(index: number, patch: Partial<RepairLineItem>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.line_items];
      next[index] = { ...next[index], ...patch };
      return { ...prev, line_items: next };
    });
  }

  if (!session.ready) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">Loading...</main>;
  }

  if (session.role !== "accounts" && session.role !== "management") {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-rose-300">Accounts access required.</main>;
  }

  const lineItemsTotal = draft
    ? draft.line_items.reduce((sum, item) => sum + asNumber(item.amount), 0)
    : 0;
  const parsedSubtotal = draft ? asNumber(draft.subtotal_amount) : 0;
  const parsedDiscount = draft ? asNumber(draft.discount_amount) : 0;
  const parsedTotal = draft ? asNumber(draft.total_amount || draft.invoice_total || draft.amount_due) : 0;
  const parsedAmountDue = draft ? asNumber(draft.amount_due || draft.total_amount) : 0;
  const derivedDiscountFromSubtotal = parsedSubtotal > 0 && parsedTotal > 0 ? parsedSubtotal - parsedTotal : 0;
  const derivedDiscountFromAmountDue = lineItemsTotal > 0 && parsedAmountDue > 0 ? lineItemsTotal - parsedAmountDue : 0;
  const customerDiscount = parsedDiscount !== 0
    ? Math.abs(parsedDiscount)
    : (derivedDiscountFromSubtotal !== 0 ? Math.abs(derivedDiscountFromSubtotal) : Math.abs(derivedDiscountFromAmountDue));
  const baseReportSummary = reportData?.byUnit ?? [];
  const usingCustomDates = Boolean(fromDate || toDate);
  const costRankedSummary = [...baseReportSummary].sort((a, b) => b.total_repairs_cost - a.total_repairs_cost);
  const rankingMap = new Map(costRankedSummary.map((row, idx) => [row.unit_number, idx + 1]));
  const totalRepairsExpense = baseReportSummary.reduce((sum, row) => sum + row.total_repairs_cost, 0);
  const reportSummary = [...baseReportSummary].sort((a, b) => {
    if (reportSortBy === "date") {
      const aDate = a.earliestInvoiceDate ?? "";
      const bDate = b.earliestInvoiceDate ?? "";
      return aDate.localeCompare(bDate);
    }
    return b.total_repairs_cost - a.total_repairs_cost;
  });

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#020617_0%,_#0b1220_55%,_#111827_100%)] text-slate-50">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-8">
        {showUploadWorkflow && (
        <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-[0_20px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">Step 1 · Upload & Verify</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">Upload Repairs Invoices with Verification</h1>
          <p className="mt-2 text-sm text-slate-300">
            Upload each invoice, verify every section, and save with confidence.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <label className="flex min-w-[300px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">
              <span className="text-slate-400">PDF Invoice</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setDraft(null);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setUnitOverride("");
                  setDetectedUnitNumber("");
                  setUnitOverrideConfirm(null);
                }}
                className="w-full text-xs text-slate-100"
              />
            </label>
            <button
              onClick={() => void handleParseInvoice()}
              disabled={parseLoading}
              className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:opacity-50"
            >
              {parseLoading ? "Reading invoice..." : "Check Invoice"}
            </button>
            <button
              onClick={() => setShowUploadWorkflow(false)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Back to Report
            </button>
          </div>

          {errorMessage && <p className="mt-3 text-sm text-rose-300">{errorMessage}</p>}
          {successMessage && <p className="mt-3 text-sm text-emerald-300">{successMessage}</p>}
        </section>
        )}

        {!showUploadWorkflow && (
        <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/75 p-4 shadow-[0_20px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => router.push("/fleet")}
              className="w-fit rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Back
            </button>
            <div>
              <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">Repairs Expense Report</h2>
              <p className="mt-1 text-sm font-semibold text-emerald-200">
                Total Repairs Expense: {money(totalRepairsExpense)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Report dates: {appliedStartDate ?? "-"} to {appliedEndDate ?? "-"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1 text-xs font-semibold text-slate-100">
              <button
                type="button"
                onClick={() => selectReportPeriod("weekly")}
                className={`rounded-lg px-3 py-1.5 transition ${!usingCustomDates && reportPeriod === "weekly" ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:text-white"}`}
              >
                Past 7 Days
              </button>
              <button
                type="button"
                onClick={() => selectReportPeriod("monthly")}
                className={`rounded-lg px-3 py-1.5 transition ${!usingCustomDates && reportPeriod === "monthly" ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:text-white"}`}
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
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1 text-[11px] font-semibold text-slate-100">
                <button
                  type="button"
                  onClick={() => setReportSortBy("ranking")}
                  className={`rounded-lg px-2 py-1 transition ${
                    reportSortBy === "ranking" ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:text-white"
                  }`}
                >
                  Ranking
                </button>
                <button
                  type="button"
                  onClick={() => setReportSortBy("date")}
                  className={`rounded-lg px-2 py-1 transition ${
                    reportSortBy === "date" ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:text-white"
                  }`}
                >
                  Date
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadWorkflow((prev) => !prev)}
                className="rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
              >
                {showUploadWorkflow ? "Hide Upload" : "Upload Invoice"}
              </button>
            </div>
          </div>

          {reportError && <p className="mt-3 text-sm text-rose-300">{reportError}</p>}

          <div className="mt-4 space-y-3">
            {reportLoading && (
              <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-400">
                Loading report...
              </div>
            )}

            {reportSummary.map((row) => {
              const isActive = row.unit_number === selectedAssetUnit;
              const rankingNumber = rankingMap.get(row.unit_number) ?? "?";
              const assetTypeLabel = row.assetType ? row.assetType.charAt(0).toUpperCase() + row.assetType.slice(1) : "Asset";

              return (
                <article key={row.unit_number} className="rounded-xl border border-cyan-400/15 bg-slate-900/45 p-3 shadow-[0_10px_30px_rgba(2,6,23,0.25)]">
                  <button
                    type="button"
                    onClick={() => void loadAssetDetail(row.unit_number)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-cyan-300/50 bg-cyan-400/15 ring-1 ring-cyan-400/25"
                        : "border-white/10 bg-slate-950/55 hover:border-cyan-300/35 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-cyan-50">#{rankingNumber} {assetTypeLabel} {row.unit_number}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {row.row_count} invoice{row.row_count === 1 ? "" : "s"} {row.earliestInvoiceDate && `· First: ${row.earliestInvoiceDate}`}
                          </p>
                        </div>
                        <p className="text-right text-base font-semibold text-cyan-200">{money(row.total_repairs_cost)}</p>
                      </div>
                  </button>

                  {isActive && reportDetailError && <p className="mt-3 text-sm text-rose-300">{reportDetailError}</p>}

                  {isActive && reportDetailLoading && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-400">
                      Loading invoice drilldown...
                    </div>
                  )}

                  {isActive && !reportDetailLoading && selectedAssetRows.length === 0 && !reportDetailError && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-400">
                      No invoice rows found for this asset in the selected period.
                    </div>
                  )}

                  {isActive && !reportDetailLoading && selectedAssetRows.length > 0 && (
                    <div className="mt-3 space-y-3 border-l-2 border-amber-400/30 pl-3">
                      {selectedAssetRows.map((invoice) => {
                        const invoiceLineItemTotal = invoice.line_items.reduce((sum, item) => sum + asNumber(item.amount), 0);
                        return (
                          <details key={invoice.id} className="rounded-xl border border-amber-400/20 bg-slate-950/70 p-3 shadow-[0_8px_20px_rgba(2,6,23,0.22)]">
                            <summary className="cursor-pointer list-none">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-amber-50">Invoice {invoice.invoice_number}</p>
                                  <p className="mt-1 text-xs text-slate-400">{invoice.vendor_name ?? "Unknown vendor"}</p>
                                  <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
                                    <p>Invoice Date: <span className="text-slate-200">{invoice.invoice_date ?? "-"}</span></p>
                                    <p>Due Date: <span className="text-slate-200">{invoice.payment_due_date ?? "-"}</span></p>
                                    <p>Repair Category: <span className="text-slate-200">{invoice.repair_category ?? "-"}</span></p>
                                    <p>Breakdown Time: <span className="text-slate-200">{invoice.breakdown_time ?? "-"}</span></p>
                                    <p className="sm:col-span-2">Breakdown Location: <span className="text-slate-200">{invoice.breakdown_location ?? "-"}</span></p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-base font-semibold text-emerald-200">{money(invoice.total_amount)}</p>
                                  <p className="mt-1 text-[11px] text-amber-200">Discount: {moneyOrDash(invoice.discount_amount)}</p>
                                  <p className="mt-1 text-[11px] text-slate-400">{invoice.line_items.length} line items</p>
                                </div>
                              </div>
                            </summary>

                            <div className="mt-3 rounded-lg border border-violet-400/15 bg-slate-900/75 p-3 text-xs text-slate-300">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-400/10 pb-2">
                                <p>Invoice total: <span className="font-semibold text-white">{money(invoice.total_amount)}</span></p>
                                <p>Line-item sum: <span className="font-semibold text-cyan-200">{money(invoiceLineItemTotal)}</span></p>
                              </div>

                              <div className="mt-3 space-y-2">
                                {invoice.line_items.length === 0 ? (
                                  <p className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-slate-400">No line items captured.</p>
                                ) : (
                                  invoice.line_items.map((item, lineIndex) => (
                                    <div key={`${invoice.id}-${lineIndex}`} className="rounded-lg border border-violet-400/10 bg-slate-950/60 p-2 pl-3 shadow-[inset_3px_0_0_rgba(167,139,250,0.45)]">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="truncate font-medium text-white">{item.description}</p>
                                          <p className="mt-1 text-[11px] text-slate-400">
                                            Qty {item.quantity ?? "-"} · Price {item.unit_price ?? "-"}
                                          </p>
                                        </div>
                                        <p className="font-semibold text-emerald-200">{money(asNumber(item.amount))}</p>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              {invoice.notes_text && invoice.notes_text.trim() && (
                                <div className="mt-3 rounded-lg border border-violet-400/12 bg-slate-950/55 p-2.5">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-200">Notes</p>
                                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{invoice.notes_text}</p>
                                </div>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Tap an asset to view invoices. Tap an invoice to view line items.
          </p>
        </section>
        )}

        {showUploadWorkflow && draft && (
          <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/75 p-4 shadow-[0_20px_40px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white sm:text-lg">Invoice Interpretation</h2>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${confidenceBadgeClass(
                  draft.parse_confidence_level
                )}`}
              >
                Confidence: {draft.parse_confidence_level} ({draft.parse_confidence_score})
              </span>
            </div>

            {(draft.parse_confidence_reasons.length > 0 || draft.parse_warnings.length > 0) && (
              <div className="mt-2 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-300">
                {draft.parse_confidence_reasons.length > 0 && (
                  <p>Confidence notes: {draft.parse_confidence_reasons.join("; ")}</p>
                )}
                {draft.parse_warnings.length > 0 && <p className="mt-1">Flags: {draft.parse_warnings.join(", ")}</p>}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Breakdown</p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Breakdown #</span>
                    <input
                      value={draft.breakdown_number}
                      onChange={(e) => setDraft((p) => (p ? { ...p, breakdown_number: e.target.value } : p))}
                      placeholder="Breakdown #"
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Breakdown Time</span>
                    <input
                      value={draft.breakdown_time}
                      onChange={(e) => setDraft((p) => (p ? { ...p, breakdown_time: e.target.value } : p))}
                      placeholder="Breakdown time HH:MM"
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Breakdown Location</span>
                    <input
                      value={draft.breakdown_location}
                      onChange={(e) => setDraft((p) => (p ? { ...p, breakdown_location: e.target.value } : p))}
                      placeholder="Breakdown location"
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-amber-200/90">Unit Override</span>
                    <input
                      value={unitOverride}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setUnitOverride(nextValue);
                        setDraft((p) => (p ? { ...p, unit_number: nextValue } : p));
                      }}
                      placeholder="Unit override"
                      className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-amber-100/60"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Truck/Unit #</span>
                    <input
                      value={draft.unit_number}
                      onChange={(e) => setDraft((p) => (p ? { ...p, unit_number: e.target.value } : p))}
                      placeholder="Truck/Unit #"
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Repair Category</span>
                    <input
                      value={draft.repair_category}
                      onChange={(e) => setDraft((p) => (p ? { ...p, repair_category: e.target.value } : p))}
                      placeholder="Repair category"
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Provider / Bill To</p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Provider Name</span>
                    <input value={draft.provider_name} onChange={(e) => setDraft((p) => (p ? { ...p, provider_name: e.target.value } : p))} placeholder="Provider name" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Provider State</span>
                    <input value={draft.provider_state} onChange={(e) => setDraft((p) => (p ? { ...p, provider_state: e.target.value } : p))} placeholder="Provider state" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Provider Country</span>
                    <input value={draft.provider_country} onChange={(e) => setDraft((p) => (p ? { ...p, provider_country: e.target.value } : p))} placeholder="Provider country" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Bill-To Company</span>
                    <input value={draft.bill_to_company} onChange={(e) => setDraft((p) => (p ? { ...p, bill_to_company: e.target.value } : p))} placeholder="Bill-to company" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Invoice Meta</p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Invoice #</span>
                    <input value={draft.invoice_number} onChange={(e) => setDraft((p) => (p ? { ...p, invoice_number: e.target.value } : p))} placeholder="Invoice #" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">PO/SO #</span>
                    <input value={draft.po_so_number} onChange={(e) => setDraft((p) => (p ? { ...p, po_so_number: e.target.value } : p))} placeholder="PO/SO #" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Invoice Date</span>
                    <input value={draft.invoice_date} onChange={(e) => setDraft((p) => (p ? { ...p, invoice_date: e.target.value } : p))} placeholder="Invoice date YYYY-MM-DD" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Payment Due Date</span>
                    <input value={draft.payment_due_date} onChange={(e) => setDraft((p) => (p ? { ...p, payment_due_date: e.target.value } : p))} placeholder="Payment due YYYY-MM-DD" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/55 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Line Items (Most Important)</p>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-white/10">
                <table className="min-w-full text-xs">
                  <thead className="bg-rose-700/70 text-white">
                    <tr>
                      <th className="px-2 py-2 text-left">Items</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Price</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-slate-950/50">
                    {draft.line_items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-slate-400">No line items extracted.</td>
                      </tr>
                    ) : (
                      draft.line_items.map((item, index) => (
                        <tr key={`${item.description}-${index}`}>
                          <td className="px-2 py-1.5">
                            <input
                              value={item.description}
                              onChange={(e) => updateLineItem(index, { description: e.target.value })}
                              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={item.quantity ?? ""}
                              onChange={(e) => updateLineItem(index, { quantity: e.target.value || null })}
                              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-right text-xs text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={item.unit_price ?? ""}
                              onChange={(e) => updateLineItem(index, { unit_price: e.target.value || null })}
                              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-right text-xs text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              value={item.amount}
                              onChange={(e) => updateLineItem(index, { amount: e.target.value })}
                              className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-right text-xs text-slate-100"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Totals</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Subtotal</span>
                    <input value={draft.subtotal_amount} onChange={(e) => setDraft((p) => (p ? { ...p, subtotal_amount: e.target.value } : p))} placeholder="Subtotal" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Customer Discount</span>
                    <input value={draft.discount_amount} onChange={(e) => setDraft((p) => (p ? { ...p, discount_amount: e.target.value } : p))} placeholder="Customer discount" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Total</span>
                    <input value={draft.total_amount} onChange={(e) => setDraft((p) => (p ? { ...p, total_amount: e.target.value } : p))} placeholder="Total" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedTotals((v) => !v)}
                  className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200"
                >
                  {showAdvancedTotals ? "▾ Hide advanced totals" : "▸ Show advanced totals"}
                </button>
                {showAdvancedTotals && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="grid gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Labor</span>
                      <input value={draft.labor_amount} onChange={(e) => setDraft((p) => (p ? { ...p, labor_amount: e.target.value } : p))} placeholder="Labor" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Parts</span>
                      <input value={draft.parts_amount} onChange={(e) => setDraft((p) => (p ? { ...p, parts_amount: e.target.value } : p))} placeholder="Parts" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Tax</span>
                      <input value={draft.tax_amount} onChange={(e) => setDraft((p) => (p ? { ...p, tax_amount: e.target.value } : p))} placeholder="Tax" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Invoice Total</span>
                      <input value={draft.invoice_total} onChange={(e) => setDraft((p) => (p ? { ...p, invoice_total: e.target.value } : p))} placeholder="Invoice total" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Amount Due</span>
                      <input value={draft.amount_due} onChange={(e) => setDraft((p) => (p ? { ...p, amount_due: e.target.value } : p))} placeholder="Amount due" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                    </label>
                  </div>
                )}
                <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-300">
                  <p>Line items sum: <span className="font-semibold text-emerald-200">{money(lineItemsTotal)}</span></p>
                  <p className="mt-1">Detected total: <span className="font-semibold text-cyan-200">{money(parsedTotal || parsedAmountDue)}</span></p>
                  <p className="mt-1">Customer Discount: <span className="font-semibold text-amber-200">{money(customerDiscount)}</span></p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">Notes / Terms</p>
                <label className="mt-2 grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">VIN</span>
                  <input value={draft.vin} onChange={(e) => setDraft((p) => (p ? { ...p, vin: e.target.value } : p))} placeholder="VIN" className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100" />
                </label>
                <label className="mt-2 grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">Notes / Terms</span>
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft((p) => (p ? { ...p, notes: e.target.value } : p))}
                    rows={5}
                    placeholder="Notes / Terms"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-100"
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void handleSaveDraft()}
                disabled={saveLoading}
                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:opacity-50"
              >
                {saveLoading ? "Saving..." : "Save Invoice"}
              </button>
              <button
                onClick={() => setDraft(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          </section>
        )}

        {unitOverrideConfirm && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6">
            <section className="w-full max-w-lg rounded-2xl border border-rose-500/50 bg-slate-950 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-300">Critical Confirmation</p>
              <h3 className="mt-1 text-base font-semibold text-rose-100 sm:text-lg">Unit Override Will Change Saved Data</h3>
              <p className="mt-2 text-sm text-slate-300">
                The unit value you are about to save does not match the value detected from the uploaded invoice.
              </p>

              <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-950/20 p-3 text-sm">
                <p className="text-slate-300">Detected Unit</p>
                <p className="mt-0.5 font-semibold text-rose-100">{unitOverrideConfirm.detected}</p>
                <p className="mt-2 text-slate-300">Unit To Save</p>
                <p className="mt-0.5 font-semibold text-amber-100">{unitOverrideConfirm.current}</p>
              </div>

              <p className="mt-3 text-xs text-slate-400">
                Continue only if you are certain this override is correct.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setUnitOverrideConfirm(null)}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmOverrideSave()}
                  className="rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 py-2.5 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30"
                >
                  Save With Override
                </button>
              </div>
            </section>
          </div>
        )}

        {saveErrorModalMessage && (
          <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6">
            <section className="w-full max-w-lg rounded-2xl border border-rose-500/50 bg-slate-950 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-300">Save Failed</p>
              <h3 className="mt-1 text-base font-semibold text-rose-100 sm:text-lg">Invoice could not be saved</h3>
              <p className="mt-2 text-sm text-slate-300">{saveErrorModalMessage}</p>
              <p className="mt-3 text-xs text-slate-400">Your previous invoice state has been restored.</p>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleAcknowledgeSaveErrorModal}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  OK
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}




