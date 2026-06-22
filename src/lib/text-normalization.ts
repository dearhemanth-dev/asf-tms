export function normalizeSingleSpaces(rawValue: string) {
  return rawValue.trim().replace(/\s+/g, " ");
}

export function normalizeUpperSingleSpaces(rawValue: string) {
  return normalizeSingleSpaces(rawValue).toUpperCase();
}

export function normalizeCompact(rawValue: string) {
  return rawValue.trim().replace(/\s+/g, "");
}

export function normalizeDigits(rawValue: string) {
  return rawValue.replace(/\D/g, "");
}
