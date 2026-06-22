import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || (!serviceKey && !anonKey)) {
      return NextResponse.json({ names: [] }, { status: 200 });
    }

    const supabase = createClient(url, serviceKey ?? anonKey ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("organizations")
      .select("organization_name")
      .order("organization_name", { ascending: true })
      .limit(4);

    if (error) {
      return NextResponse.json({ names: [] }, { status: 200 });
    }

    const names = (data ?? [])
      .map((row) => (typeof row.organization_name === "string" ? row.organization_name.trim() : ""))
      .filter((name) => name.length > 0);

    return NextResponse.json({ names }, { status: 200 });
  } catch {
    return NextResponse.json({ names: [] }, { status: 200 });
  }
}