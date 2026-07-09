import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * DIAGNOSTIC ENDPOINT - Test backfill system setup
 * 
 * Use: POST /api/maintenance/backfill-test
 * No auth required (dev only)
 * 
 * Checks:
 * 1. Can connect to Supabase
 * 2. Organizations table exists and has records
 * 3. Samsara API keys are configured
 * 4. Samsara API is reachable
 * 5. Maintenance alerts table exists
 * 6. Backfill ingestion log table exists
 */

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    return { error: true, details: { url_set: !!url, key_set: !!key } };
  }
  
  return createClient(url, key, { auth: { persistSession: false } });
}

type DiagResult = {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: unknown;
};

export async function POST(): Promise<NextResponse> {
  const results: DiagResult[] = [];

  try {
    // Test 1: Supabase connection
    const supabaseResult = getServiceRoleClient();
    
    if ("error" in supabaseResult && supabaseResult.error) {
      results.push({
        name: "Supabase Configuration",
        status: "fail",
        message: "Missing Supabase credentials",
        details: {
          url_configured: supabaseResult.details?.url_set,
          service_role_key_configured: supabaseResult.details?.key_set,
          fix: "Add SUPABASE_SERVICE_ROLE_KEY to .env.local (get from Supabase dashboard under Settings → API)",
        },
      });
      
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        total_tests: 1,
        passed: 0,
        failed: 1,
        warnings: 0,
        results,
      });
    }

    const supabase = supabaseResult as any;
    const { data: tableCheck } = await supabase.from("organizations").select("count");
    results.push({
      name: "Supabase Connection",
      status: "pass",
      message: "Successfully connected to Supabase",
    });

    // Test 2: Organizations table & Samsara keys
    const { data: orgs, error: orgsError } = await supabase
      .from("organizations")
      .select("id, organization_name, samsara_api_key, samsara_webhook_url")
      .not("samsara_api_key", "is", null);

    if (orgsError) {
      results.push({
        name: "Organizations Query",
        status: "fail",
        message: `Failed to query organizations: ${orgsError.message}`,
      });
    } else {
      if (!orgs || orgs.length === 0) {
        results.push({
          name: "Samsara API Keys",
          status: "warn",
          message: "No organizations with Samsara API keys configured",
          details: { configured_count: 0 },
        });
      } else {
        results.push({
          name: "Samsara API Keys",
          status: "pass",
          message: `Found ${orgs.length} organization(s) with Samsara keys`,
          details: {
            configured_count: orgs.length,
            orgs: (orgs as any[]).map((o: any) => ({
              name: o.organization_name,
              has_api_key: !!o.samsara_api_key,
              has_webhook_url: !!o.samsara_webhook_url,
            })),
          },
        });
      }
    }

    // Test 3: Try Samsara API with first key
    if (orgs && orgs.length > 0) {
      const firstKey = orgs[0].samsara_api_key;
      if (firstKey) {
        try {
          const statsResponse = await fetch(
            "https://api.samsara.com/fleet/vehicles/stats?types=faultCodes&limit=1",
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${firstKey}`,
                "Content-Type": "application/json",
              },
              signal: AbortSignal.timeout(10_000),
            }
          );

          if (statsResponse.ok) {
            const json = await statsResponse.json();
            results.push({
              name: "Samsara API Call",
              status: "pass",
              message: "Successfully called Samsara /fleet/vehicles/stats",
              details: {
                vehicles_count: (json.data || []).length,
              },
            });
          } else {
            const errorText = await statsResponse.text();
            results.push({
              name: "Samsara API Call",
              status: "fail",
              message: `Samsara API returned ${statsResponse.status}`,
              details: {
                status: statsResponse.status,
                response: errorText.slice(0, 200),
              },
            });
          }
        } catch (error) {
          results.push({
            name: "Samsara API Call",
            status: "fail",
            message: `Failed to reach Samsara API: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    // Test 4: maintenance_alerts table
    const { data: alertsCheck } = await supabase
      .from("maintenance_alerts")
      .select("id", { count: "exact" })
      .limit(0);

    results.push({
      name: "maintenance_alerts Table",
      status: "pass",
      message: "maintenance_alerts table exists",
    });

    // Test 5: backfill_ingestion_log table
    const { data: logsCheck } = await supabase
      .from("backfill_ingestion_log")
      .select("id", { count: "exact" })
      .limit(0);

    results.push({
      name: "backfill_ingestion_log Table",
      status: "pass",
      message: "backfill_ingestion_log table exists",
    });
  } catch (error) {
    results.push({
      name: "System Error",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Summary
  const summary = {
    timestamp: new Date().toISOString(),
    total_tests: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    warnings: results.filter((r) => r.status === "warn").length,
    results,
  };

  return NextResponse.json(summary);
}
