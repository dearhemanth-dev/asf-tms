"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import type { AppRole } from "@/lib/auth";

type TopNavProps = {
  fullName: string;
  compact?: boolean;
  role?: AppRole;
  viewMode?: "map" | "list";
  onToggleViewMode?: () => void;
};

export default function TopNav({
  fullName,
  compact = false,
  role = "management",
  viewMode,
  onToggleViewMode,
}: TopNavProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasSupabaseEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    !String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).startsWith("your_");

  const menuLinks = useMemo(() => {
    if (role === "management") {
      return [
        { href: "/reports/vehicle-ranking", label: "Vehicle Ranking" },
        { href: "/reports/repairs", label: "Repairs Report" },
        { href: "/fuel-expenses/report", label: "Fuel Report" },
      ];
    }

    if (role === "accounts") {
      return [
        { href: "/reports/repairs", label: "Repairs Report" },
        { href: "/fuel-expenses/report", label: "Fuel Report" },
      ];
    }

    if (role === "maintenance") {
      return [
        { href: "/fleet", label: "Fleet" },
        { href: "/maintenance/fault-codes", label: "Fault Codes" },
        { href: "/reports/repairs", label: "Repairs Report" },
      ];
    }

    if (role === "dispatch") {
      return [
        { href: "/fleet", label: "Fleet" },
        { href: "/tasks", label: "Tasks" },
      ];
    }

    return [{ href: "/fleet", label: "Fleet" }];
  }, [role]);

  async function handleSignOut() {
    if (hasSupabaseEnv) {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("demoRole");
      window.sessionStorage.removeItem("demoRole");
      window.sessionStorage.removeItem("demoUsername");
      document.cookie = "asf_login=; path=/; max-age=0; samesite=lax";
      document.cookie = "asf_role=; path=/; max-age=0; samesite=lax";
      window.location.href = "/login";
      return;
    }

    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-cyan-900/40 bg-slate-950/85 backdrop-blur">
      <div className={`mx-auto flex w-full max-w-7xl items-center justify-between px-4 ${compact ? "py-2" : "py-3"}`}>
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
            aria-label="Toggle menu"
          >
            ☰
          </button>

          {onToggleViewMode && viewMode && (
            <button
              onClick={onToggleViewMode}
              className="rounded-md border border-cyan-600/70 bg-cyan-900/30 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-800/45"
            >
              {viewMode === "map" ? "List View" : "Map View"}
            </button>
          )}

          {menuOpen && (
            <div className="absolute left-0 top-10 z-50 min-w-52 rounded-lg border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl">
              {menuLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <p className="max-w-[48vw] truncate text-sm font-semibold text-slate-100">{fullName}</p>
          <button
            onClick={handleSignOut}
            className="rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
