import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { createHash } from "node:crypto";

const ALLOWED_ROLES = ["management", "accounts"] as const;

type PdfParseResult = { text?: string };
type PdfParseFunction = (dataBuffer: Buffer) => Promise<PdfParseResult>;

type ParseWarnings = {
  missing_invoice_number: boolean;
  missing_total_amount: boolean;
  unknown_provider: boolean;
  sparse_line_items: boolean;
};

type ParseConfidence = {
  level: "high" | "medium" | "low";
  score: number;
  reasons: string[];
};

type ProviderProfile = {
  provider_name: string;
  provider_type: string;
  signatures: RegExp[];
};

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const ALLOWED_PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "",
]);

const SUSPICIOUS_FILENAME_PATTERN = /\.(?:exe|js|vbs|bat|cmd|ps1|msi|scr|com|jar|hta)\.pdf$/i;
const PDF_DANGEROUS_MARKERS = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/OpenAction"];

const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    provider_name: "Uptime Elite",
    provider_type: "roadside",
    signatures: [/uptime\s*elite/i, /\bUE\b/i],
  },
  {
    provider_name: "Love's Truck Care",
    provider_type: "maintenance",
    signatures: [/love'?s\s+travel/i, /love'?s\s+truck\s+care/i],
  },
  {
    provider_name: "TA/Petro",
    provider_type: "maintenance",
    signatures: [/travelcenters\s+of\s+america/i, /\bpetro\b/i, /\bTA\b\s+truck/i],
  },
  {
    provider_name: "Rush Truck Centers",
    provider_type: "dealership",
    signatures: [/rush\s+truck\s+centers/i, /rush\s+enterprises/i],
  },
];

type ParsedInvoice = {
  invoice_number: string | null;
  invoice_date: string | null;
  payment_due_date: string | null;
  po_so_number: string | null;
  breakdown_number: string | null;
  breakdown_time: string | null;
  breakdown_location: string | null;
  bill_to_company: string | null;
  provider_name: string | null;
  provider_state: string | null;
  provider_country: string | null;
  provider_type: string | null;
  provider_account_id: string | null;
  source_document_hash: string | null;
  vendor_name: string | null;
  unit_number: string | null;
  vin: string | null;
  repair_category: string | null;
  notes: string | null;
  labor_amount: string | null;
  parts_amount: string | null;
  tax_amount: string | null;
  subtotal_amount: string | null;
  discount_amount: string | null;
  invoice_total: string | null;
  amount_due: string | null;
  total_amount: string | null;
  currency: string;
  raw_text_excerpt: string | null;
  line_items: {
    description: string;
    quantity: string | null;
    unit_price: string | null;
    amount: string;
  }[];
};

function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const mmddyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mmddyyyy) {
    const mm = mmddyyyy[1].padStart(2, "0");
    const dd = mmddyyyy[2].padStart(2, "0");
    const yyyy = mmddyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const yyyymmdd = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const yyyy = yyyymmdd[1];
    const mm = yyyymmdd[2].padStart(2, "0");
    const dd = yyyymmdd[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const monthName = trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthName) {
    const parsed = new Date(`${monthName[1]} ${monthName[2]}, ${monthName[3]} UTC`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const looseParsed = new Date(trimmed);
  if (!Number.isNaN(looseParsed.getTime())) {
    return looseParsed.toISOString().slice(0, 10);
  }

  return null;
}

function extractMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function parseMoney(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.replace(/[,$\s]/g, "").trim();
  if (!normalized) return null;

  const cleaned =
    normalized.startsWith("(") && normalized.endsWith(")")
      ? `-${normalized.slice(1, -1)}`
      : normalized;

  if (!cleaned) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

function parseMoneyToNumber(raw: string | null): number | null {
  const normalized = parseMoney(raw);
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function isMoneyToken(value: string): boolean {
  const cleaned = value.replace(/[$,()]/g, "").trim();
  return /^-?\d+(\.\d{1,2})?$/.test(cleaned);
}

function parseLineItemRow(rawLine: string): {
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string;
} | null {
  const line = rawLine.trim().replace(/\s+/g, " ");
  if (!line) return null;

  // Numeric-only rows (qty+unit_price+amount) must be handled by the
  // wrapped-description flow in extractLineItems.
  if (/^-?\d+(?:\.\d+)?\s*\$?\(?[0-9,]+(?:\.\d{1,2})?\)?\s*\$?\(?[0-9,]+(?:\.\d{1,2})?\)?$/.test(line)) {
    return null;
  }

  // Handles compact OCR rows like: "Roadside Labor2.25$162.99$366.73"
  const compact = line.match(/^(.+?)(-?\d+(?:\.\d+)?)\s*\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?\s*\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?$/);
  if (compact) {
    const description = compact[1].trim();
    const quantity = parseMoney(compact[2]);
    const unitPrice = parseMoney(compact[3]);
    const amount = parseMoney(compact[4]);
    if (description && quantity && unitPrice && amount) {
      return {
        description: description.slice(0, 200),
        quantity,
        unit_price: unitPrice,
        amount,
      };
    }
  }

  const strict = line.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)\s+\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?\s+\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?$/);
  if (strict) {
    const description = strict[1].trim();
    const quantity = parseMoney(strict[2]);
    const unitPrice = parseMoney(strict[3]);
    const amount = parseMoney(strict[4]);
    if (description && quantity && unitPrice && amount) {
      return {
        description: description.slice(0, 200),
        quantity,
        unit_price: unitPrice,
        amount,
      };
    }
  }

  // Fallback: parse from right side so OCR spacing variance still works.
  const tokens = line.split(" ").filter(Boolean);
  if (tokens.length < 4) return null;

  const amountToken = tokens[tokens.length - 1];
  const unitPriceToken = tokens[tokens.length - 2];
  const quantityToken = tokens[tokens.length - 3];

  if (!isMoneyToken(amountToken) || !isMoneyToken(unitPriceToken) || !isMoneyToken(quantityToken)) {
    return null;
  }

  const description = tokens.slice(0, -3).join(" ").trim();
  const quantity = parseMoney(quantityToken);
  const unitPrice = parseMoney(unitPriceToken);
  const amount = parseMoney(amountToken);
  if (!description || !quantity || !unitPrice || !amount) return null;

  return {
    description: description.slice(0, 200),
    quantity,
    unit_price: unitPrice,
    amount,
  };
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function inferCategory(text: string): string {
  const lowered = text.toLowerCase();
  if (/\bengine\b|dpf|regen|regan/.test(lowered)) return "Engine";
  if (/tire|tyre/.test(lowered)) return "Tires";
  if (/oil|filter|pm\b|preventive/.test(lowered)) return "Maintenance";
  if (/brake|rotor|pad/.test(lowered)) return "Brakes";
  if (/electrical|fuse|wiring|short|relay/.test(lowered)) return "Electrical";
  if (/tow|roadside|breakdown/.test(lowered)) return "Roadside";
  if (/battery|alternator|starter/.test(lowered)) return "Electrical";
  return "General Repair";
}

function extractLineItems(lines: string[]) {
  const items: {
    description: string;
    quantity: string | null;
    unit_price: string | null;
    amount: string;
  }[] = [];

  const ignored = /^(invoice|subtotal|total|customer discount|amount due|balance due|description|date|vendor|unit|items\s+quantity\s+price\s+amount|notes\s*\/\s*terms|bill to|p\.o\.\/s\.o\.\s*number|invoice number|invoice date|payment due)\b/i;
  let wrappedDescription = "";

  const amountOnlyPattern = /^(.+?)\s+\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?$/;
  const compactNumbersOnlyPattern = /^(-?\d+(?:\.\d+)?)\s*\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?\s*\$?\(?([0-9,]+(?:\.\d{1,2})?)\)?$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5 || ignored.test(line)) continue;

    const parsedRow = parseLineItemRow(line);
    if (parsedRow) {
      const description = [wrappedDescription, parsedRow.description].filter(Boolean).join(" ").trim();
      items.push({
        description: description.slice(0, 200),
        quantity: parsedRow.quantity,
        unit_price: parsedRow.unit_price,
        amount: parsedRow.amount,
      });
      wrappedDescription = "";
      continue;
    }

    // Handles wrapped descriptions where the next line contains only qty/price/amount,
    // e.g. "3$618.99$1,856.97" after tire name lines.
    const compactNumbersOnly = line.match(compactNumbersOnlyPattern);
    if (compactNumbersOnly && wrappedDescription) {
      const quantity = parseMoney(compactNumbersOnly[1]);
      const unitPrice = parseMoney(compactNumbersOnly[2]);
      const amount = parseMoney(compactNumbersOnly[3]);

      if (quantity && unitPrice && amount) {
        items.push({
          description: wrappedDescription.slice(0, 200),
          quantity,
          unit_price: unitPrice,
          amount,
        });
      }
      wrappedDescription = "";
      continue;
    }

    const trailingAmount = line.match(amountOnlyPattern);
    if (trailingAmount) {
      const description = [wrappedDescription, trailingAmount[1].trim()].filter(Boolean).join(" ").trim();
      const amount = parseMoney(trailingAmount[2]);
      if (description && amount) {
        items.push({
          description: description.slice(0, 200),
          quantity: null,
          unit_price: null,
          amount,
        });
      }
      wrappedDescription = "";
      continue;
    }

    const looksLikeStandaloneMeta = /^(asf|utah|united states)$/i.test(line);
    if (!looksLikeStandaloneMeta) wrappedDescription = [wrappedDescription, line].filter(Boolean).join(" ").trim();
  }

  return items.slice(0, 100);
}

function inferVendorName(lines: string[], fallback: string | null): string | null {
  const billToIndex = lines.findIndex((line) => /^bill to$/i.test(line));

  if (billToIndex > 0) {
    for (let i = billToIndex - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^(invoice|bill to)$/i.test(line)) continue;
      if (/^roadside\b/i.test(line)) continue;
      if (/^united states$/i.test(line)) continue;
      if (/^[A-Za-z]+$/.test(line) && line.length <= 3) continue;
      if (/\d/.test(line)) continue;
      return line;
    }
  }

  return fallback;
}

function detectProvider(text: string, inferredVendor: string | null) {
  const lowered = text.toLowerCase();

  for (const profile of PROVIDER_PROFILES) {
    if (profile.signatures.some((signature) => signature.test(lowered))) {
      return {
        provider_name: profile.provider_name,
        provider_type: profile.provider_type,
        matched: true,
      };
    }
  }

  return {
    provider_name: inferredVendor ?? "Unknown",
    provider_type: "general",
    matched: false,
  };
}

function isLikelyLocationLine(value: string): boolean {
  if (!value) return false;
  if (/\d/.test(value)) return false;
  if (/^(invoice|bill to|notes\s*\/\s*terms)$/i.test(value)) return false;
  return /^[A-Za-z .'-]{2,}$/.test(value);
}

function inferProviderBlock(lines: string[], detectedProvider: string | null) {
  const billToIndex = lines.findIndex((line) => /^bill to$/i.test(line));
  if (billToIndex <= 0) {
    return {
      provider_name: detectedProvider,
      provider_state: null,
      provider_country: null,
      bill_to_company: null,
    };
  }

  const billToName = lines[billToIndex + 1]?.trim() || null;
  const providerContext = lines.slice(Math.max(0, billToIndex - 6), billToIndex).filter(Boolean);

  const locationCandidates = providerContext.filter((line) => isLikelyLocationLine(line));
  const providerCountry =
    locationCandidates.find((line) => /united states|usa|canada|mexico/i.test(line)) ??
    locationCandidates.at(-1) ??
    null;

  const providerState =
    providerCountry && locationCandidates.length > 1
      ? locationCandidates[locationCandidates.length - 2]
      : locationCandidates.find((line) => line !== providerCountry) ?? null;

  const providerName =
    detectedProvider ??
    providerContext.find((line) => !/^(invoice|bill to)$/i.test(line) && !/\d/.test(line) && line.length > 3) ??
    null;

  return {
    provider_name: providerName,
    provider_state: providerState,
    provider_country: providerCountry,
    bill_to_company: billToName,
  };
}

function extractItemSectionLines(lines: string[]): string[] {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const startIndex = lines.findIndex((line) => {
    const normalized = normalize(line);
    return normalized.includes("itemsquantitypriceamount");
  });
  if (startIndex < 0) return lines;

  const section: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const normalized = normalize(line);
    if (
      normalized.startsWith("subtotal") ||
      normalized.startsWith("customerdiscount") ||
      normalized.startsWith("total") ||
      normalized.startsWith("amountdue") ||
      normalized.startsWith("notesterms") ||
      normalized.startsWith("notes")
    ) {
      break;
    }
    section.push(line);
  }

  return section;
}

function sumLineItemsByPattern(
  lineItems: { description: string; amount: string }[],
  pattern: RegExp
): number {
  return lineItems.reduce((sum, item) => {
    if (!pattern.test(item.description)) return sum;
    const amount = parseMoneyToNumber(item.amount);
    return sum + (amount ?? 0);
  }, 0);
}

function extractSummaryMoney(text: string, labelPattern: RegExp): string | null {
  const line = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => labelPattern.test(candidate));

  if (!line) return null;
  const amountMatch = line.match(/\$?\(?([0-9,]+(?:\.[0-9]{1,2})?)\)?\s*$/);
  if (!amountMatch) return null;
  const hasParens = /\([0-9,]+(?:\.[0-9]{1,2})?\)\s*$/.test(line);
  return parseMoney(hasParens ? `(${amountMatch[1]})` : amountMatch[1]);
}

function extractVin(text: string): string | null {
  const match = text.match(/\bvin\s*[:#-]?\s*([A-HJ-NPR-Z0-9]{11,17})\b/i);
  if (match?.[1]) {
    const vin = match[1].trim().toUpperCase();
    return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin) ? vin : null;
  }

  // Fallback for providers that include VIN without the "VIN" label.
  const loose = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (!loose?.[1]) return null;
  return loose[1].toUpperCase();
}

function extractNotes(lines: string[]): string | null {
  const notesIndex = lines.findIndex((line) => /^notes\s*\/\s*terms$/i.test(line));
  if (notesIndex < 0) return null;

  const rawNotes = lines.slice(notesIndex + 1).join(" ").replace(/\s+/g, " ").trim();
  if (!rawNotes) return null;

  // Keep the full first line details (year/make/model + VIN + narrative)
  // for exact Block 6 interpretation.
  return rawNotes;
}

function extractBreakdownHeader(lines: string[]) {
  const headerLine =
    lines.find((line) => /^(breakdown|roadside|tow)\s*-/i.test(line)) ??
    lines.find((line) => /@\s*\d{1,2}:\d{2}/i.test(line) && /\b(truck|trailer|trlr?)\b/i.test(line)) ??
    null;
  if (!headerLine) {
    return {
      breakdown_number: null,
      breakdown_time: null,
      breakdown_location: null,
      unit_number: null,
      repair_category: null,
    };
  }

  const numberMatch = headerLine.match(/^[^-]+-\s*([A-Z0-9-]{4,})/i);
  const timeMatch = headerLine.match(/@\s*(\d{1,2}:\d{2})/i);
  const unitMatch = headerLine.match(/\b(?:truck|trailer|trlr?)\s*#?\s*([A-Z0-9-]{1,20})\b/i);
  const categoryMatch = headerLine.match(/-\s*(engine|electrical|tires?|maintenance|brakes?|roadside|tow|general\s*repair)\s*-/i);
  const locationMatch = headerLine.match(/-\s*[^-]+\s*-\s*([^\-]+(?:,\s*[A-Za-z]{2,})?)\s*$/i);

  return {
    breakdown_number: numberMatch?.[1]?.trim() ?? null,
    breakdown_time: timeMatch?.[1]?.trim() ?? null,
    breakdown_location: locationMatch?.[1]?.trim() ?? null,
    unit_number: unitMatch?.[1]?.trim() ?? null,
    repair_category: categoryMatch?.[1]?.trim() ?? null,
  };
}

function parseInvoiceText(text: string): ParsedInvoice {
  const normalized = text.replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? null;

  const invoiceNumber =
    extractMatch(normalized, /invoice\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9\-]+)/i) ??
    extractMatch(normalized, /inv\s*#\s*[:#-]?\s*([A-Z0-9\-]+)/i);

  const invoiceDateRaw =
    extractMatch(normalized, /invoice\s*date\s*[:#-]?\s*([A-Za-z]{3,}\s+\d{1,2},\s*\d{4}|[0-9\/-]{8,10})/i) ??
    extractMatch(normalized, /date\s*[:#-]?\s*([A-Za-z]{3,}\s+\d{1,2},\s*\d{4}|[0-9\/-]{8,10})/i);

  const paymentDueRaw = extractMatch(
    normalized,
    /payment\s*due\s*[:#-]?\s*([A-Za-z]{3,}\s+\d{1,2},\s*\d{4}|[0-9\/-]{8,10})/i
  );

  const poSoNumber = extractMatch(normalized, /p\.?o\.?\s*\/\s*s\.?o\.?\s*number\s*[:#-]?\s*([A-Z0-9\-]+)/i);

  const breakdown = extractBreakdownHeader(lines);

  const unitNumber =
    breakdown.unit_number ??
    extractMatch(normalized, /unit\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9\-]+)/i) ??
    extractMatch(normalized, /truck\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9\-]+)/i) ??
    extractMatch(normalized, /trailer\s*(?:number|#)?\s*[:#-]?\s*([A-Z0-9\-]+)/i);
  const vin = extractVin(normalized);

  const totalRaw =
    extractSummaryMoney(normalized, /^total\b/i) ??
    extractSummaryMoney(normalized, /^amount\s*due\b/i) ??
    extractMatch(normalized, /balance\s*due\s*[:$]?\s*\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);

  const subtotalRaw = extractSummaryMoney(normalized, /^subtotal\b/i);
  const discountRaw = extractSummaryMoney(normalized, /^customer\s*discount\b/i) ??
    extractSummaryMoney(normalized, /^discount\b/i);

  const laborRaw = extractMatch(normalized, /labor\s*[:$]?\s*\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const partsRaw = extractMatch(normalized, /parts\s*[:$]?\s*\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const taxRaw =
    extractSummaryMoney(normalized, /^tax\b/i) ??
    extractMatch(normalized, /tax\s*[:$]?\s*\$?([0-9,]+(?:\.[0-9]{1,2})?)/i);

  const vendorNameRaw =
    extractMatch(normalized, /vendor\s*[:#-]?\s*(.+)/i) ??
    extractMatch(normalized, /from\s*[:#-]?\s*(.+)/i) ??
    firstLine;

  const vendorName = inferVendorName(lines, vendorNameRaw);
  const provider = detectProvider(normalized, vendorName);
  const providerBlock = inferProviderBlock(lines, provider.provider_name);

  const invoiceDate = invoiceDateRaw ? toIsoDate(invoiceDateRaw) : null;
  const paymentDueDate = paymentDueRaw ? toIsoDate(paymentDueRaw) : null;
  const invoiceTotal = extractSummaryMoney(normalized, /^total\b/i) ?? parseMoney(totalRaw);
  const amountDue = extractSummaryMoney(normalized, /^amount\s*due\b/i) ?? parseMoney(totalRaw);
  const totalAmount = amountDue ?? invoiceTotal;
  const itemSectionLines = extractItemSectionLines(lines);
  const lineItems = extractLineItems(itemSectionLines);
  const derivedLabor = sumLineItemsByPattern(lineItems, /\blabor\b/i);
  const derivedParts = sumLineItemsByPattern(lineItems, /\b(parts?|fuel|surcharge|material|supply|shop)\b/i);
  const derivedTax = sumLineItemsByPattern(lineItems, /\btax\b/i);
  const laborAmount = parseMoney(laborRaw) ?? (derivedLabor > 0 ? formatMoney(derivedLabor) : null);
  const partsAmount = parseMoney(partsRaw) ?? (derivedParts > 0 ? formatMoney(derivedParts) : null);
  const taxAmount = parseMoney(taxRaw) ?? (derivedTax > 0 ? formatMoney(derivedTax) : null);
  const currencyCode =
    extractMatch(normalized, /amount\s*due\s*\(([A-Z]{3})\)/i) ??
    extractMatch(normalized, /total\s*\(([A-Z]{3})\)/i) ??
    "USD";

  const notes = extractNotes(lines);

  return {
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    payment_due_date: paymentDueDate,
    po_so_number: poSoNumber,
    breakdown_number: breakdown.breakdown_number,
    breakdown_time: breakdown.breakdown_time,
    breakdown_location: breakdown.breakdown_location,
    bill_to_company: providerBlock.bill_to_company,
    provider_name: (providerBlock.provider_name ?? provider.provider_name).slice(0, 200),
    provider_state: providerBlock.provider_state,
    provider_country: providerBlock.provider_country,
    provider_type: provider.provider_type,
    provider_account_id: null,
    source_document_hash: null,
    vendor_name: vendorName?.slice(0, 200) ?? null,
    unit_number: unitNumber,
    vin,
    repair_category: breakdown.repair_category ?? inferCategory(normalized),
    notes,
    labor_amount: laborAmount,
    parts_amount: partsAmount,
    tax_amount: taxAmount,
    subtotal_amount: parseMoney(subtotalRaw),
    discount_amount: parseMoney(discountRaw),
    invoice_total: invoiceTotal,
    amount_due: amountDue,
    total_amount: totalAmount,
    currency: currencyCode,
    raw_text_excerpt: normalized || null,
    line_items: lineItems,
  };
}

function calculateParseConfidence(invoice: ParsedInvoice, warnings: ParseWarnings): ParseConfidence {
  let score = 100;
  const reasons: string[] = [];

  if (warnings.missing_invoice_number) {
    score -= 30;
    reasons.push("Missing invoice number");
  }

  if (warnings.missing_total_amount) {
    score -= 35;
    reasons.push("Missing total amount");
  }

  if (warnings.unknown_provider) {
    score -= 15;
    reasons.push("Provider could not be confidently identified");
  }

  if (warnings.sparse_line_items) {
    score -= 15;
    reasons.push("Only a few line items were detected");
  }

  if (!invoice.invoice_date) {
    score -= 10;
    reasons.push("Missing invoice date");
  }

  if (!invoice.unit_number) {
    score -= 10;
    reasons.push("Missing unit number");
  }

  score = Math.max(0, Math.min(100, score));

  if (score >= 80) return { level: "high", score, reasons };
  if (score >= 55) return { level: "medium", score, reasons };
  return { level: "low", score, reasons };
}

function bytesStartWithPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function scanPdfForDangerousMarkers(bytes: Uint8Array): string | null {
  const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 256 * 1024))).toString("latin1");
  const marker = PDF_DANGEROUS_MARKERS.find((candidate) => sample.includes(candidate));
  return marker ?? null;
}

function validateInvoiceLikeContent(parsedText: string, invoice: ParsedInvoice): string | null {
  const normalized = parsedText.toLowerCase();
  const keywordMatches = [
    /\binvoice\b/.test(normalized),
    /\bbill\s+to\b/.test(normalized),
    /\bamount\s+due\b/.test(normalized),
    /\bsubtotal\b/.test(normalized),
    /\btotal\b/.test(normalized),
    /\bvendor\b|\bprovider\b/.test(normalized),
  ].filter(Boolean).length;

  const hasCurrencyAmount = /\$\s*\d|\b\d{1,3}(?:,\d{3})*\.\d{2}\b/.test(parsedText);
  const hasCoreInvoiceField = Boolean(invoice.invoice_number || invoice.total_amount || invoice.invoice_date);

  if (parsedText.trim().length < 80) {
    return "Upload rejected: unable to read enough text from this PDF. Please upload a clear invoice PDF file.";
  }

  if (keywordMatches < 2 || !hasCurrencyAmount || !hasCoreInvoiceField) {
    return "Upload rejected: this file does not appear to be a valid invoice document. Please upload a legitimate invoice PDF only.";
  }

  return null;
}

export async function POST(request: Request) {
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(appUser.role as (typeof ALLOWED_ROLES)[number])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Unable to read uploaded file." }, { status: 400 });
  }

  const file = formData.get("file");
  const overrideUnit = formData.get("unit_number");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!file.name || /[\\/\x00-\x1F]/.test(file.name)) {
    return NextResponse.json({ error: "Upload rejected: invalid filename." }, { status: 400 });
  }

  if (!file.name.match(/\.pdf$/i)) {
    return NextResponse.json({ error: "Upload rejected: only PDF invoice files are allowed." }, { status: 400 });
  }

  if (!ALLOWED_PDF_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Upload rejected: invalid file type. Please upload a PDF invoice." }, { status: 400 });
  }

  if (SUSPICIOUS_FILENAME_PATTERN.test(file.name)) {
    return NextResponse.json({ error: "Upload rejected: suspicious file naming detected. Please upload a genuine invoice PDF." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: "Upload rejected: file must be between 1 byte and 10 MB." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytesStartWithPdfSignature(bytes)) {
      return NextResponse.json({ error: "Upload rejected: file content is not a valid PDF document." }, { status: 400 });
    }

    const dangerousMarker = scanPdfForDangerousMarkers(bytes);
    if (dangerousMarker) {
      return NextResponse.json(
        { error: `Security warning: upload rejected due to potentially harmful PDF content (${dangerousMarker}).` },
        { status: 400 }
      );
    }

    const sourceDocumentHash = createHash("sha256").update(bytes).digest("hex");
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (pdfParseModule.default ?? pdfParseModule) as PdfParseFunction;
    const parsed = await pdfParse(Buffer.from(bytes));
    const parsedText = parsed.text ?? "";

    const invoice = parseInvoiceText(parsedText);
    const invoiceValidationError = validateInvoiceLikeContent(parsedText, invoice);
    if (invoiceValidationError) {
      return NextResponse.json({ error: invoiceValidationError }, { status: 400 });
    }

    if (overrideUnit && typeof overrideUnit === "string" && overrideUnit.trim()) {
      invoice.unit_number = overrideUnit.trim();
    }

    invoice.source_document_hash = sourceDocumentHash;

    const warnings: ParseWarnings = {
      missing_invoice_number: !invoice.invoice_number,
      missing_total_amount: !invoice.total_amount,
      unknown_provider: invoice.provider_name === "Unknown",
      sparse_line_items: invoice.line_items.length < 2,
    };

    const confidence = calculateParseConfidence(invoice, warnings);

    const debugLines = parsedText.replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
    const debugSectionLines = extractItemSectionLines(debugLines);

    return NextResponse.json({
      row: {
        ...invoice,
        source_file_name: file.name,
      },
      warnings,
      confidence,
      debug: {
        all_lines: debugLines,
        section_lines: debugSectionLines,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse PDF invoice.";
    return NextResponse.json({ error: `Failed to parse PDF invoice: ${message}` }, { status: 400 });
  }
}
