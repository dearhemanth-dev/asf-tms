import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type EstimateConfidence = "Low" | "Medium" | "High";

type AttemptStatus = "success" | "failed" | "skipped";

type ProviderAttempt = {
  provider: "NEXPART" | "MOTOR" | "FALLBACK";
  status: AttemptStatus;
  message: string;
};

type FallbackWindow = {
  laborHours: string;
  partsRange: string;
};

type LiveWindow = {
  low: number;
  high: number;
};

const REQUEST_TIMEOUT_MS = 8000;

async function resolveTenantId(request: Request): Promise<string | null> {
  const appUser = await getAppSessionUser(request);
  if (appUser?.tenantId) return appUser.tenantId;

  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profile?.tenant_id) return profile.tenant_id as string;

  const { data: userRow } = await supabase
    .from("Users")
    .select("tenant_id")
    .eq("id", session.user.id)
    .maybeSingle();

  return (userRow?.tenant_id as string | null) ?? null;
}

function classifyIssue(issue: string) {
  const blob = issue.toLowerCase();

  if (blob.includes("brake") || blob.includes("abs") || blob.includes("wheel speed") || blob.includes("retarder")) {
    return "brake_abs";
  }

  if (blob.includes("oil") || blob.includes("coolant") || blob.includes("pressure") || blob.includes("overheat")) {
    return "engine_protection";
  }

  if (blob.includes("def") || blob.includes("dpf") || blob.includes("scr") || blob.includes("nox") || blob.includes("emission")) {
    return "aftertreatment";
  }

  if (blob.includes("battery") || blob.includes("alternator") || blob.includes("voltage") || blob.includes("current")) {
    return "electrical";
  }

  return "powertrain_general";
}

function getFallbackWindow(issue: string): FallbackWindow {
  switch (classifyIssue(issue)) {
    case "brake_abs":
      return { laborHours: "1.5 - 4.0 hrs (~$275 - $840 labor)", partsRange: "$350 - $1,450" };
    case "engine_protection":
      return { laborHours: "2.0 - 8.0 hrs (~$360 - $1,680 labor)", partsRange: "$300 - $1,800" };
    case "aftertreatment":
      return { laborHours: "2.0 - 8.0 hrs (~$360 - $1,680 labor)", partsRange: "$900 - $4,500" };
    case "electrical":
      return { laborHours: "1.5 - 4.0 hrs (~$275 - $840 labor)", partsRange: "$250 - $1,250" };
    default:
      return { laborHours: "2.0 - 6.0 hrs (~$360 - $1,260 labor)", partsRange: "$400 - $2,200" };
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toUsd(low: number, high: number): string {
  const lowRounded = Math.max(0, Math.round(low));
  const highRounded = Math.max(lowRounded, Math.round(high));
  return `$${lowRounded.toLocaleString()} - $${highRounded.toLocaleString()}`;
}

function toHours(low: number, high: number): string {
  const safeLow = Math.max(0, low);
  const safeHigh = Math.max(safeLow, high);
  return `${safeLow.toFixed(1)} - ${safeHigh.toFixed(1)} hrs`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function queryNexpartParts(vin: string, issue: string, zip: string | null): Promise<LiveWindow | null> {
  const baseUrl = process.env.NEXPART_BASE_URL?.trim();
  const apiKey = process.env.NEXPART_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  const query = new URLSearchParams({ vin, issue });
  if (zip) query.set("zip", zip);

  const payload = await fetchJsonWithTimeout(`${baseUrl}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!payload) return null;

  const directLow = asNumber(payload.lowPrice ?? payload.minPrice ?? payload.partsLow ?? payload.priceLow);
  const directHigh = asNumber(payload.highPrice ?? payload.maxPrice ?? payload.partsHigh ?? payload.priceHigh);

  if (directLow !== null && directHigh !== null) {
    return { low: directLow, high: directHigh };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const prices = items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => asNumber(item.price ?? item.unitPrice ?? item.amount))
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;
  const low = prices[0];
  const high = prices[Math.min(prices.length - 1, 2)];
  return { low, high };
}

async function queryMotorLabor(vin: string, issue: string): Promise<LiveWindow | null> {
  const baseUrl = process.env.MOTOR_BASE_URL?.trim();
  const apiKey = process.env.MOTOR_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  const query = new URLSearchParams({ vin, issue });
  const payload = await fetchJsonWithTimeout(`${baseUrl}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!payload) return null;

  const low = asNumber(payload.lowHours ?? payload.minHours ?? payload.laborLow);
  const high = asNumber(payload.highHours ?? payload.maxHours ?? payload.laborHigh);

  if (low !== null && high !== null) {
    return { low, high };
  }

  return null;
}

export async function GET(request: Request) {
  const tenantId = await resolveTenantId(request);
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const vin = (url.searchParams.get("vin") ?? "").trim().toUpperCase();
  const issue = (url.searchParams.get("issue") ?? "General diagnostic issue").trim();
  const zip = (url.searchParams.get("zip") ?? "").trim() || null;

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return NextResponse.json({ error: "VIN is required and must be 17 characters" }, { status: 400 });
  }

  const fallback = getFallbackWindow(issue);
  const attempts: ProviderAttempt[] = [];

  const partsLive = await queryNexpartParts(vin, issue, zip);
  if (partsLive) {
    attempts.push({ provider: "NEXPART", status: "success", message: "Live parts pricing returned" });
  } else {
    const configured = Boolean(process.env.NEXPART_BASE_URL?.trim() && process.env.NEXPART_API_KEY?.trim());
    attempts.push({
      provider: "NEXPART",
      status: configured ? "failed" : "skipped",
      message: configured ? "No usable parts payload from provider" : "Provider not configured",
    });
  }

  const laborLive = await queryMotorLabor(vin, issue);
  if (laborLive) {
    attempts.push({ provider: "MOTOR", status: "success", message: "Live labor guide returned" });
  } else {
    const configured = Boolean(process.env.MOTOR_BASE_URL?.trim() && process.env.MOTOR_API_KEY?.trim());
    attempts.push({
      provider: "MOTOR",
      status: configured ? "failed" : "skipped",
      message: configured ? "No usable labor payload from provider" : "Provider not configured",
    });
  }

  attempts.push({ provider: "FALLBACK", status: "success", message: "ASF planning window applied when live data is unavailable" });

  const laborHours = laborLive ? `${toHours(laborLive.low, laborLive.high)} (provider labor guide)` : fallback.laborHours;
  const partsRange = partsLive ? toUsd(partsLive.low, partsLive.high) : fallback.partsRange;

  const confidence: EstimateConfidence = laborLive && partsLive ? "High" : laborLive || partsLive ? "Medium" : "Low";
  const basis =
    confidence === "High"
      ? "Live parts and labor providers responded for this VIN and issue. Use as planning guidance until technician confirmation."
      : confidence === "Medium"
        ? "One live provider responded and one fallback was used. Use this as directional planning only."
        : "Live providers unavailable. Using US-average heavy-duty planning bands until vendor quotes and shop labor are confirmed.";

  return NextResponse.json({
    vin,
    issue,
    estimate: {
      laborHours,
      partsRange,
      confidence,
      basis,
      providerPath: "NEXPART -> MOTOR -> ASF fallback",
    },
    attempts,
  });
}
