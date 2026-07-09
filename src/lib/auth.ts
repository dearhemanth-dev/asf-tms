export const APP_ROLES = ["admin", "management", "accounts", "maintenance", "dispatch", "driver"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type UserProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
};

export function normalizeAppRole(value: unknown, fallback: AppRole = "maintenance"): AppRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }

  if (normalized === "manager") return "management";
  return fallback;
}
