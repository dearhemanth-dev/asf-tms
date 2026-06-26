import { NextResponse } from "next/server";

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type NominatimElement = {
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
  boundingbox?: string[];
};

type DealerResult = {
  name: string;
  phone: string | null;
  distanceMiles: number;
  projectedParts: string;
  address: string;
  website: string | null;
  tip: string;
};

const MAX_RESULTS = 5;
const SEARCH_RADIUS_METERS = 40000;
const FALLBACK_RADIUS_METERS = 80000;
const SEARCH_TERMS = [
  "AutoZone",
  "O'Reilly Auto Parts",
  "Advance Auto Parts",
  "NAPA Auto Parts",
  "Pep Boys",
  "Carquest",
  "FleetPride",
  "TruckPro",
  "auto parts",
  "car dealership",
];

function asNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;

  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAddress(tags: Record<string, string>): string {
  const parts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:state"], tags["addr:postcode"]]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));

  return parts.length > 0 ? parts.join(", ") : "Address unavailable";
}

function buildTip(tags: Record<string, string>, index: number): string {
  const brand = (tags.brand ?? tags.name ?? "").toLowerCase();
  if (brand.includes("napa")) return "Ask for fleet or commercial account pricing and check for core return charges.";
  if (brand.includes("oreilly") || brand.includes("o'reilly")) return "Ask for online price matching and same-day pickup availability.";
  if (brand.includes("advance")) return "Ask whether a pro account or store coupon can beat the shelf price.";
  if (brand.includes("autozone")) return "Ask about commercial pricing and whether the part is stocked nearby.";
  return [
    "Ask for fleet, pro, or commercial pricing before you mention urgency.",
    "Request online price match and confirm any core charge.",
    "Have the VIN and part number ready before you call.",
    "Ask about same-day pickup and return policy.",
    "Check whether tax-exempt or account pricing applies.",
  ][Math.min(index, 4)];
}

function buildProjectedParts(partsRange: string, index: number): string {
  const match = partsRange.match(/\$(\d[\d,]*)\s*-\s*\$(\d[\d,]*)/);
  if (!match) return partsRange;

  const low = Number.parseInt(match[1].replace(/,/g, ""), 10);
  const high = Number.parseInt(match[2].replace(/,/g, ""), 10);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) return partsRange;

  const spread = [0, 0.03, 0.05, 0.07, 0.1][index] ?? 0.1;
  const adjustedLow = Math.max(0, Math.round(low * (1 - spread)));
  const adjustedHigh = Math.max(adjustedLow, Math.round(high * (1 + spread)));
  return `$${adjustedLow.toLocaleString()} - $${adjustedHigh.toLocaleString()}`;
}

function buildViewBox(lat: number, lon: number): string {
  const latSpan = 0.7;
  const lonSpan = 0.7;
  const west = lon - lonSpan;
  const east = lon + lonSpan;
  const south = lat - latSpan;
  const north = lat + latSpan;
  return `${west},${north},${east},${south}`;
}

function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNominatimResult(result: NominatimElement, index: number, lat: number, lon: number, partsRange: string): DealerResult | null {
  const resultLat = Number.parseFloat(result.lat ?? "");
  const resultLon = Number.parseFloat(result.lon ?? "");
  if (!Number.isFinite(resultLat) || !Number.isFinite(resultLon)) return null;

  const address = result.address ?? {};
  const tags = result.extratags ?? {};
  const name = result.name?.trim() || result.namedetails?.brand?.trim() || result.display_name?.split(",")[0]?.trim() || "Auto parts dealer";
  const phone = normalizePhone(tags.phone ?? tags["contact:phone"] ?? address.phone);
  const website = normalizePhone(tags.website ?? tags["contact:website"]);

  return {
    name,
    phone,
    distanceMiles: haversineMiles(lat, lon, resultLat, resultLon),
    projectedParts: buildProjectedParts(partsRange, index),
    address:
      [address.house_number, address.road, address.city, address.state, address.postcode]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part && part.length > 0))
        .join(", ") || result.display_name || "Address unavailable",
    website,
    tip: buildTip({ name, brand: result.namedetails?.brand ?? result.name ?? name }, index),
  };
}

async function fetchNominatimDealers(lat: number, lon: number, partsRange: string): Promise<DealerResult[]> {
  const viewbox = buildViewBox(lat, lon);
  const locationQuery = await fetch(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({
    format: "jsonv2",
    lat: lat.toString(),
    lon: lon.toString(),
    zoom: "10",
    addressdetails: "1",
  }).toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ASF-TMS/1.0",
    },
    cache: "no-store",
  }).then(async (response) => (response.ok ? (await response.json().catch(() => null)) : null)) as
    | { address?: Record<string, string> }
    | null;

  const address = locationQuery?.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county ?? "";
  const state = address.state ?? "";
  const locationLabel = [city, state].map((part) => part.trim()).filter(Boolean).join(" ");

  const results: NominatimElement[] = [];

  for (const term of SEARCH_TERMS) {
    const searchQuery = [term, locationLabel].filter(Boolean).join(" ");
    const query = new URLSearchParams({
      format: "jsonv2",
      limit: "8",
      addressdetails: "1",
      extratags: "1",
      namedetails: "1",
      bounded: "1",
      viewbox,
      q: searchQuery,
    });

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ASF-TMS/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) continue;

    const payload = (await response.json().catch(() => [])) as NominatimElement[];
    for (const entry of Array.isArray(payload) ? payload : []) {
      if (!entry.osm_type || !entry.osm_id) continue;
      const key = `${entry.osm_type}:${entry.osm_id}`;
      if (!results.some((candidate) => `${candidate.osm_type}:${candidate.osm_id}` === key)) {
        results.push(entry);
      }
    }

    if (results.length >= MAX_RESULTS) break;
  }

  return results
    .map((entry, index) => normalizeNominatimResult(entry, index, lat, lon, partsRange))
    .filter((dealer): dealer is DealerResult => dealer !== null)
    .sort((left, right) => left.distanceMiles - right.distanceMiles)
    .slice(0, MAX_RESULTS);
}

async function fetchOverpassDealers(lat: number, lon: number): Promise<OverpassElement[]> {
  const queries = [SEARCH_RADIUS_METERS, FALLBACK_RADIUS_METERS].map(
    (radius) => `
      [out:json][timeout:20];
      (
        node(around:${radius},${lat},${lon})[shop~"^(car_parts|auto_parts|tyres)$",i];
        way(around:${radius},${lat},${lon})[shop~"^(car_parts|auto_parts|tyres)$",i];
        relation(around:${radius},${lat},${lon})[shop~"^(car_parts|auto_parts|tyres)$",i];

        node(around:${radius},${lat},${lon})[amenity~"^(car_repair|car_parts)$",i];
        way(around:${radius},${lat},${lon})[amenity~"^(car_repair|car_parts)$",i];
        relation(around:${radius},${lat},${lon})[amenity~"^(car_repair|car_parts)$",i];

        node(around:${radius},${lat},${lon})[name~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];
        way(around:${radius},${lat},${lon})[name~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];
        relation(around:${radius},${lat},${lon})[name~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];

        node(around:${radius},${lat},${lon})[brand~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];
        way(around:${radius},${lat},${lon})[brand~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];
        relation(around:${radius},${lat},${lon})[brand~"(AutoZone|O'Reilly|Advance Auto Parts|NAPA|Pep Boys|Carquest|FleetPride|TruckPro|Bumper to Bumper)",i];
      );
      out center tags;
    `
  );

  for (const query of queries) {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query.trim() }).toString(),
      cache: "no-store",
    });

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json().catch(() => null)) as { elements?: OverpassElement[] } | null;
    if (Array.isArray(payload?.elements) && payload!.elements.length > 0) {
      return payload!.elements;
    }
  }

  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = asNumber(url.searchParams.get("lat"));
  const lon = asNumber(url.searchParams.get("lon"));
  const partsRange = url.searchParams.get("partsRange")?.trim() || "$0 - $0";

  if (lat === null || lon === null) {
    return NextResponse.json({ error: "Latitude and longitude are required." }, { status: 400 });
  }

  try {
    let dealers = await fetchNominatimDealers(lat, lon, partsRange);

    if (dealers.length === 0) {
      const elements = await fetchOverpassDealers(lat, lon);
      dealers = elements
        .map((element, index) => {
          const tags = element.tags ?? {};
          const dealerLat = element.lat ?? element.center?.lat;
          const dealerLon = element.lon ?? element.center?.lon;

          if (dealerLat === undefined || dealerLon === undefined) return null;

          const name = tags.name?.trim() || tags.brand?.trim() || "Auto parts dealer";
          const phone = tags["contact:phone"]?.trim() || tags.phone?.trim() || null;
          const website = tags["contact:website"]?.trim() || tags.website?.trim() || null;
          const distanceMiles = haversineMiles(lat, lon, dealerLat, dealerLon);

          return {
            name,
            phone,
            distanceMiles,
            projectedParts: buildProjectedParts(partsRange, index),
            address: formatAddress(tags),
            website,
            tip: buildTip(tags, index),
          } satisfies DealerResult;
        })
        .filter((dealer): dealer is DealerResult => dealer !== null)
        .sort((left, right) => left.distanceMiles - right.distanceMiles)
        .slice(0, MAX_RESULTS);
    }

    return NextResponse.json({ dealers }, { status: 200 });
  } catch {
    return NextResponse.json({
      dealers: [],
      error: "Nearby dealer lookup is unavailable right now.",
    }, { status: 200 });
  }
}
