export const DRIVER_NAME_MAX_LENGTH = 40;
export const DRIVER_TEXT_MAX_LENGTH = 80;
export const DRIVER_STREET_MAX_LENGTH = 120;
export const DRIVER_NOTES_MAX_LENGTH = 500;

export const DRIVER_NAME_PATTERN = /^[A-Z][A-Z' -]*$/;
export const DRIVER_CITY_COUNTRY_PATTERN = /^[A-Z][A-Z .'-]*$/;
export const DRIVER_EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
export const DRIVER_LICENSE_PATTERN = /^[A-Z0-9]{5,20}$/;
export const US_ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

export function isValidDriverName(rawName: string) {
  const normalizedName = rawName.trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalizedName || normalizedName.length > DRIVER_NAME_MAX_LENGTH) {
    return false;
  }

  return DRIVER_NAME_PATTERN.test(normalizedName);
}

export function isValidDriverEmail(rawEmail: string) {
  const email = rawEmail.trim();
  if (!email) {
    return true;
  }

  if (!DRIVER_EMAIL_PATTERN.test(email)) {
    return false;
  }

  return !email.includes("..");
}
