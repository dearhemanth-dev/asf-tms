export const APP_ROLES = ["management", "accounts", "maintenance", "dispatch", "driver"] as const;

export type AppRole = (typeof APP_ROLES)[number];
