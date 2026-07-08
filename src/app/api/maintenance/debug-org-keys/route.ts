/**
 * DEBUG - Check what API keys are in the database
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const supabase = getServiceRoleClient();

    // Get all organizations with their Samsara keys
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, organization_name, samsara_api_key, samsara_webhook_url")
      .order("organization_name");

    if (error) {
      return NextResponse.json({ error: error.message });
    }

    // Format for display (redact keys)
    const formatted = (orgs as any[]).map((org) => ({
      id: org.id,
      name: org.organization_name,
      samsara_key_set: !!org.samsara_api_key,
      samsara_key_prefix: org.samsara_api_key ? org.samsara_api_key.substring(0, 10) + "..." : null,
      webhook_url_set: !!org.samsara_webhook_url,
    }));

    return NextResponse.json({
      total_orgs: formatted.length,
      organizations: formatted,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
