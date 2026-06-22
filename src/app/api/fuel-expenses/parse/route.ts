import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAppSessionUser } from "@/lib/app-session";

// Normalize a header string: trim, collapse runs of whitespace to a single space, lower-case.
function normalizeHeader(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// Parse a cell value to a decimal string while preserving input precision.
function toDecimal(value: unknown, displayText?: string): string | null {
  const rawText = (displayText ?? "").trim();
  const cleanedText = rawText.replace(/[,$\s]/g, "");

  // Prefer the formatted cell text so we keep the same number of decimals as Excel displays.
  if (cleanedText) {
    if (/^-?\d+(\.\d+)?$/.test(cleanedText)) {
      return cleanedText;
    }
  }

  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    // Fallback when formatted text is unavailable.
    return value.toString();
  }

  const asString = String(value).trim().replace(/[,$\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(asString)) {
    return asString;
  }

  return null;
}

// Parse a cell value to a date string (YYYY-MM-DD), returning null when empty.
function toDateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const d = value;
    if (Number.isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(value).trim();
  if (!s) return null;

  // Excel serial date support (days since 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 0) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const ms = Math.round(serial * 24 * 60 * 60 * 1000);
      const d = new Date(excelEpoch.getTime() + ms);
      if (!Number.isNaN(d.getTime())) {
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  // Try common US date format MM/DD/YYYY
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (c && c.length === 4) {
      // MM/DD/YYYY
      return `${c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    if (a && a.length === 4) {
      // YYYY-MM-DD already
      return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
    }
  }

  // Unrecognized date formats are ignored to avoid import failures.
  return null;
}

function toString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

// Parse a cell value to HH:MM (24-hour), returning null when empty/unparseable.
function toTime24(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Excel time serials can come as numbers: fraction of day.
  if (typeof value === "number" && Number.isFinite(value)) {
    const dayFraction = value % 1;
    const totalMinutes = Math.round(dayFraction * 24 * 60) % (24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  // Accept formats like H:MM, HH:MM, H:MM:SS, HH:MM:SS and strip seconds.
  const match24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  // Accept 12-hour clock values with AM/PM and convert to 24-hour.
  const match12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i);
  if (match12) {
    let hour = Number(match12[1]);
    const minute = Number(match12[2]);
    const ampm = match12[3].toUpperCase();
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (ampm === "AM") {
        if (hour === 12) hour = 0;
      } else if (hour !== 12) {
        hour += 12;
      }
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  return null;
}

// Map a normalized header to the DB column name.
const HEADER_MAP: Record<string, string> = {
  "customer id": "customer_id",
  "transaction date": "transaction_date",
  "transaction time": "transaction_time",
  "transaction number": "transaction_number",
  "comchek card number": "comchek_card_number",
  "driver's name": "driver_name",
  "drivers name": "driver_name",
  "unit number": "unit_number",
  "truck stop code": "truck_stop_code",
  "service center chain code": "service_center_chain_code",
  "truck stop name": "truck_stop_name",
  "truck stop city": "truck_stop_city",
  "truck stop state": "truck_stop_state",
  "truck stop invoice number": "truck_stop_invoice_number",
  "total amount due": "total_amount_due",
  "fees for fuel & oil & products": "fees_fuel_oil_products",
  "diesel gallons": "diesel_gallons",
  "diesel price per gallon": "diesel_price_per_gallon",
  "diesel cost": "diesel_cost",
  "def gallons": "def_gallons",
  "def price per gallon": "def_price_per_gallon",
  "def cost": "def_cost",
  "reefer gallons": "reefer_gallons",
  "reefer price per gallon": "reefer_price_per_gallon",
  "cost of reefer fuel": "reefer_fuel_cost",
  "number of quarts of oil": "quarts_of_oil",
  "total cost of oil": "total_oil_cost",
  "additional product amount": "additional_product_amount",
  "cash advance amount": "cash_advance_amount",
  "charges for cash advance": "cash_advance_charges",
  "rebate amount": "rebate_amount",
  "total amount due comdata": "total_amount_due_comdata",
  "date of original": "date_of_original",
};

const DATE_COLUMNS = new Set(["transaction_date", "date_of_original"]);
const NUMBER_COLUMNS = new Set([
  "total_amount_due",
  "fees_fuel_oil_products",
  "diesel_gallons",
  "diesel_price_per_gallon",
  "diesel_cost",
  "def_gallons",
  "def_price_per_gallon",
  "def_cost",
  "reefer_gallons",
  "reefer_price_per_gallon",
  "reefer_fuel_cost",
  "quarts_of_oil",
  "total_oil_cost",
  "additional_product_amount",
  "cash_advance_amount",
  "cash_advance_charges",
  "rebate_amount",
  "total_amount_due_comdata",
]);

function detectHeaderRow(worksheet: ExcelJS.Worksheet) {
  const maxRowsToScan = Math.min(Math.max(worksheet.actualRowCount, 1), 30);
  let bestRowNumber = 1;
  let bestColMap = new Map<number, string>();

  for (let rowNumber = 1; rowNumber <= maxRowsToScan; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const candidateMap = new Map<number, string>();

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const normalized = normalizeHeader(cell.value);
      const dbCol = HEADER_MAP[normalized];
      if (dbCol) {
        candidateMap.set(colNumber, dbCol);
      }
    });

    if (candidateMap.size > bestColMap.size) {
      bestRowNumber = rowNumber;
      bestColMap = candidateMap;
    }
  }

  return { rowNumber: bestRowNumber, colMap: bestColMap };
}

export async function POST(request: Request) {
  const appUser = await getAppSessionUser(request);

  if (!appUser?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Unable to read uploaded file." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const allowedTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ];
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
    return NextResponse.json({ error: "Only .xlsx and .xls files are supported." }, { status: 400 });
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File must be 10 MB or smaller." }, { status: 400 });
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    // ExcelJS expects a Node.js Buffer; cast via Uint8Array to satisfy the type.
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json({ error: "No worksheet found in file." }, { status: 400 });
    }

    // Build column index → db column map from detected header row.
    const { rowNumber: headerRowNumber, colMap } = detectHeaderRow(worksheet);

    if (colMap.size === 0) {
      return NextResponse.json(
        { error: "No recognized Comdata columns found. Make sure the sheet contains Comdata headers." },
        { status: 400 }
      );
    }

    const rows: Record<string, unknown>[] = [];
    const skipped: number[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return; // skip pre-header rows and header row

      const record: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const dbCol = colMap.get(colNumber);
        if (!dbCol) return;

        if (DATE_COLUMNS.has(dbCol)) {
          record[dbCol] = toDateString(cell.value);
        } else if (dbCol === "transaction_time") {
          record[dbCol] = toTime24(cell.value);
        } else if (NUMBER_COLUMNS.has(dbCol)) {
          record[dbCol] = toDecimal(cell.value, cell.text);
        } else {
          record[dbCol] = toString(cell.value);
        }
      });

      // Skip rows that have no transaction number (blank/summary rows).
      const txnNo = record["transaction_number"];
      if (!txnNo || String(txnNo).trim() === "") {
        skipped.push(rowNumber);
        return;
      }

      rows.push(record);
    });

    return NextResponse.json({
      rows,
      totalParsed: rows.length,
      skipped: skipped.length,
      columns: Array.from(colMap.values()),
      headerRowNumber,
    });
  } catch (err) {
    console.error("Excel parse error:", err);
    return NextResponse.json(
      { error: "Unable to read the uploaded file. Make sure it is a valid Comdata Excel export." },
      { status: 400 }
    );
  }
}
