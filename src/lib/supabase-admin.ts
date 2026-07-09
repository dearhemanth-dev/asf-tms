import { createClient } from "@supabase/supabase-js";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseAdminClient() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}