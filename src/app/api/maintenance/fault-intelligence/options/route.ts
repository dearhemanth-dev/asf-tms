import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type FaultKnowledgeRow = {
  id: number;
  tenant_id: string;
  spn: number;
  fmi: number;
  affected_system: string;
  mechanic_repair_steps: string;
  operational_danger: string;
  mechanic_speak: string;
  default_dispatch_action: string;
  source_type: string;
};

export async function GET(request: Request): Promise<NextResponse> {
  const sessionUser = await getAppSessionUser(request);
  const username = (sessionUser?.username ?? "").trim().toLowerCase();

  if (username !== "hkmaintenance") {
    return NextResponse.json({ error: "This test endpoint is restricted to hkmaintenance." }, { status: 403 });
  }

  try {
    const supabase = await getSupabaseServerClient();

    let query = supabase
      .from("fault_knowledge_base")
      .select(
        "id, tenant_id, spn, fmi, affected_system, mechanic_repair_steps, operational_danger, mechanic_speak, default_dispatch_action, source_type"
      )
      .order("spn", { ascending: true })
      .order("fmi", { ascending: true })
      .limit(500);

    if (sessionUser?.tenantId) {
      query = query.eq("tenant_id", sessionUser.tenantId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Failed to fetch fault knowledge base rows: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({
      rows: (data ?? []) as FaultKnowledgeRow[],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load fault knowledge base rows.",
      },
      { status: 500 }
    );
  }
}