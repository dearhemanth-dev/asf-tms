import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Test endpoint to verify all Samsara API keys are available
 * GET /api/samsara/test-keys
 */
export async function GET(request: Request) {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser?.tenantId) {
      return NextResponse.json({ error: "No tenant found" }, { status: 401 });
    }

    const supabase = await getSupabaseServerClient();
    
    // Query all organizations with Samsara API keys for this tenant
    const { data: orgs, error: queryError } = await supabase
      .from("organizations")
      .select("id, organization_name, samsara_api_key")
      .eq("tenant_id", appUser.tenantId)
      .not("samsara_api_key", "is", null);

    if (queryError) {
      return NextResponse.json(
        { error: "Failed to query organizations", details: queryError.message },
        { status: 500 }
      );
    }

    if (!orgs || orgs.length === 0) {
      return NextResponse.json({
        message: "No organizations with Samsara API keys found",
        keyCount: 0,
        distinctKeys: [],
      });
    }

    // Extract distinct keys (some organizations might share the same key)
    const uniqueKeys = new Set<string>();
    const keysByOrg: Record<string, string[]> = {};

    for (const org of orgs) {
      const key = org.samsara_api_key?.trim();
      if (key) {
        uniqueKeys.add(key);
        if (!keysByOrg[org.organization_name]) {
          keysByOrg[org.organization_name] = [];
        }
        keysByOrg[org.organization_name].push(key);
      }
    }

    const distinctKeys = Array.from(uniqueKeys);

    // Test each distinct key with a simple API call
    const keyTests = await Promise.allSettled(
      distinctKeys.map(async (key) => {
        const response = await fetch("https://api.samsara.com/fleet/vehicles/locations?limit=1", {
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
          cache: "no-store",
        });

        return {
          key: key.substring(0, 20) + "...", // Show first 20 chars for security
          status: response.status,
          statusText: response.statusText,
          valid: response.ok,
        };
      })
    );

    const keyTestResults = keyTests.map((result, idx) => ({
      keyIndex: idx + 1,
      ...(result.status === "fulfilled"
        ? result.value
        : { key: "UNKNOWN", status: "ERROR", statusText: result.reason?.message || "Unknown error", valid: false }),
    }));

    return NextResponse.json({
      tenantId: appUser.tenantId,
      organizationCount: orgs.length,
      organizations: orgs.map((org) => ({
        name: org.organization_name,
        id: org.id,
      })),
      distinctKeyCount: distinctKeys.length,
      keysByOrganization: keysByOrg,
      keyTests: keyTestResults,
      summary: {
        allKeysValid: keyTestResults.every((test) => test.valid),
        validKeyCount: keyTestResults.filter((test) => test.valid).length,
        totalKeysConfigured: distinctKeys.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
