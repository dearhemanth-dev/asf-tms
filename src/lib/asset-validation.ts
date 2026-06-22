import { normalizeUpperSingleSpaces } from "@/lib/text-normalization";

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};

export const VIN_MAX_LENGTH = 17;
export const US_LICENSE_PLATE_MAX_LENGTH = 8;
export const LICENSE_PLATE_ERROR_MESSAGE = "License Plate is not valid. Use 2-7 letters/numbers with one optional space or dash.";

const US_LICENSE_PLATE_FORMAT_PATTERN = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)?$/;
const US_LICENSE_PLATE_COMPACT_PATTERN = /^[A-Z0-9]{2,7}$/;

export function isValidUsVin(rawVin: string) {
  const vin = rawVin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < vin.length; i += 1) {
    const char = vin[i];
    const value = VIN_TRANSLITERATION[char] ?? Number.parseInt(char, 10);
    if (Number.isNaN(value)) {
      return false;
    }
    sum += value * VIN_WEIGHTS[i];
  }

  const expectedCheckDigit = sum % 11 === 10 ? "X" : String(sum % 11);
  return vin[8] === expectedCheckDigit;
}

export function isValidUsLicensePlate(rawPlate: string) {
  const plate = normalizeUpperSingleSpaces(rawPlate);
  if (!plate) {
    return true;
  }

  if (!US_LICENSE_PLATE_FORMAT_PATTERN.test(plate)) {
    return false;
  }

  const compactPlate = plate.replace(/[ -]/g, "");
  return US_LICENSE_PLATE_COMPACT_PATTERN.test(compactPlate);
}
