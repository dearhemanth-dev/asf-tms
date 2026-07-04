import { NextResponse } from "next/server";
import { getAppSessionUser } from "@/lib/app-session";
import { getRecentPushActions, recordPushAction } from "@/lib/notifications/push-audit";

type PushActionLogBody = {
  action?: string;
  status?: "success" | "failed" | "info";
  options?: Record<string, unknown>;
  errorMessage?: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (appUser.username.trim().toLowerCase() !== "hkmaintenance") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(asPositiveInt(searchParams.get("limit"), 30), 100);
    const rows = await getRecentPushActions({ tenantId: appUser.tenantId, limit });

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const appUser = await getAppSessionUser(request);
    if (!appUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (appUser.role !== "maintenance" && appUser.role !== "management") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as PushActionLogBody;
    const action = asString(body.action);
    if (!action) {
      return NextResponse.json({ error: "Action is required." }, { status: 400 });
    }

    await recordPushAction({
      tenantId: appUser.tenantId,
      username: appUser.username,
      userRole: appUser.role,
      action,
      status: body.status ?? "info",
      options: body.options ?? {},
      errorMessage: asString(body.errorMessage) || null,
      userAgent: asString(request.headers.get("user-agent")) || null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
