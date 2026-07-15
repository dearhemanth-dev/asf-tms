const { createClient } = require("@supabase/supabase-js");

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function main() {
  const url = asString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asString(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const tenantId = asString(process.env.TARGET_TENANT_ID);

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let query = supabase
    .from("fault_knowledge_base")
    .select("spn, fmi")
    .order("spn", { ascending: true })
    .order("fmi", { ascending: true })
    .limit(101);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const targetCodes = (data || []).map((row) => ({
    spn: row.spn,
    fmi: row.fmi,
  }));

  console.log(`const targetCodes = ${JSON.stringify(targetCodes, null, 2)};`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});