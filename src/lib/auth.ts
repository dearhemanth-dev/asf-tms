export const APP_ROLES = ["management", "accounts", "maintenance", "dispatch", "driver"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type UserProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
};
