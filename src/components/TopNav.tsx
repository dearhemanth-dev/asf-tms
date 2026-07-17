"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import type { AppRole } from "@/lib/auth";

type AppTheme = "dark" | "light" | "steel";

const THEME_STORAGE_KEY = "asf:tms:theme";
const LEGACY_THEME_STORAGE_KEY = "asf:tms:fault-theme";

type TopNavProps = {
  fullName: string;
  compact?: boolean;
  role?: AppRole;
  viewMode?: "map" | "list";
  onToggleViewMode?: () => void;
  showMenu?: boolean;
  showThemeSelector?: boolean;
  backHref?: string;
  backLabel?: string;
};

export default function TopNav({
  fullName,
  compact = false,
  role = "management",
  viewMode,
  onToggleViewMode,
  showMenu = true,
  showThemeSelector = false,
  backHref,
  backLabel = "Back",
}: TopNavProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("steel");
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const hasSupabaseEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    !String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).startsWith("your_");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedTheme =
      window.localStorage.getItem(THEME_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);

    if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "steel") {
      setTheme(savedTheme);
      return;
    }

    if (savedTheme === "ops") {
      setTheme("steel");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, theme);
    document.documentElement.setAttribute("data-app-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (themeMenuRef.current?.contains(target)) return;
      setThemeMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [themeMenuOpen]);

  const menuLinks = useMemo(() => {
    if (role === "admin") {
      return [
        { href: "/admin", label: "Admin" },
        { href: "/fleet", label: "Fleet" },
        { href: "/reports/vehicle-ranking", label: "Vehicle Ranking" },
      ];
    }

    if (role === "management") {
      return [
        { href: "/maintenance/fault-codes", label: "Fleet Health Monitor" },
        { href: "/fuel-expenses/report", label: "Fuel Report" },
        { href: "/reports/repairs", label: "Repairs Report" },
        { href: "/reports/driver-ranking", label: "Driver Ranking" },
        { href: "/reports/vehicle-ranking", label: "Vehicle Ranking" },
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
        { href: "/maintenance/fault-codes", label: "Fleet Health Monitor" },
        { href: "/maintenance/fault-intelligence", label: "Fault Intelligence" },
        { href: "/reports/driver-ranking", label: "Drivers Report" },
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
          {backHref ? (
            <Link
              href={backHref}
              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
            >
              {backLabel}
            </Link>
          ) : null}

          {showMenu ? (
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
              aria-label="Toggle menu"
            >
              ☰
            </button>
          ) : null}

          {onToggleViewMode && viewMode && (
            <button
              onClick={onToggleViewMode}
              className="topnav-view-toggle rounded-md border border-cyan-600/70 bg-cyan-900/30 px-2.5 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-800/45"
            >
              {viewMode === "map" ? "List View" : "Map View"}
            </button>
          )}

          {showMenu && menuOpen && (
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
          {showThemeSelector ? (
            <div ref={themeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setThemeMenuOpen((open) => !open)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-200 hover:bg-slate-800"
                aria-label="Theme settings"
                aria-expanded={themeMenuOpen}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2.8v2.4" />
                  <path d="M12 18.8v2.4" />
                  <path d="M21.2 12h-2.4" />
                  <path d="M5.2 12H2.8" />
                  <path d="M18.5 5.5l-1.7 1.7" />
                  <path d="M7.2 16.8l-1.7 1.7" />
                  <path d="M18.5 18.5l-1.7-1.7" />
                  <path d="M7.2 7.2 5.5 5.5" />
                </svg>
              </button>
              {themeMenuOpen ? (
                <div className="absolute right-0 top-11 z-50 min-w-36 rounded-lg border border-slate-700 bg-slate-900/95 p-1.5 shadow-2xl">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Theme</p>
                  {(["dark", "light", "steel"] as AppTheme[]).map((option) => {
                    const selected = theme === option;
                    const label = option.charAt(0).toUpperCase() + option.slice(1);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setTheme(option);
                          setThemeMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                          selected ? "bg-cyan-900/35 text-cyan-100" : "text-slate-100 hover:bg-slate-800"
                        }`}
                      >
                        <span>{label}</span>
                        {selected ? <span className="text-xs">On</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
