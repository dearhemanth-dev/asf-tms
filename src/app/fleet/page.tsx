"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import FleetViewClient from "@/components/FleetViewClient";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { APP_ROLES, type AppRole, type UserProfile } from "@/lib/auth";

export default function FleetPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [modeReady, setModeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [demoRole] = useState<AppRole>(() => {
    if (typeof window === "undefined") return "management";

    const urlRole = new URLSearchParams(window.location.search).get("demoRole");
    const sessionRole = window.sessionStorage.getItem("demoRole");
    const candidate = urlRole ?? sessionRole;

    return APP_ROLES.includes(candidate as AppRole) ? (candidate as AppRole) : "management";
  });
  const [demoUsername] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("demoUsername") ?? "";
  });

  const getDisplayName = (username: string): string => {
    const value = username.trim();
    if (!value) return "User";
    if (value.length < 2) return value.toUpperCase();
    return `${value.slice(0, 2).toUpperCase()}${value.slice(2)}`;
  };

  const toggleViewMode = () => {
    setViewMode((current) => (current === "map" ? "list" : "map"));
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const urlRole = new URLSearchParams(window.location.search).get("demoRole");
    const sessionRole = window.sessionStorage.getItem("demoRole");
    const shouldUseDemoMode =
      process.env.NEXT_PUBLIC_FORCE_DEMO_FLEET === "true" ||
      !supabaseUrl ||
      !supabaseAnon ||
      supabaseAnon.startsWith("your_") ||
      Boolean(urlRole) ||
      Boolean(sessionRole);

    setDemoMode(shouldUseDemoMode);
    setModeReady(true);
    if (shouldUseDemoMode) {
      setLoading(false);
    }
  }, [supabaseAnon, supabaseUrl]);

  useEffect(() => {
    if (!modeReady || demoMode) return;

    async function init() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, tenant_id")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!data || error) {
        const fullName = (session.user.user_metadata.full_name as string | undefined) ?? "ASF User";
        const upsertRole: AppRole = "management";

        const { data: inserted } = await supabase
          .from("profiles")
          .upsert({
            id: session.user.id,
            full_name: fullName,
            role: upsertRole,
          })
          .select("id, full_name, role, tenant_id")
          .single();

        if (inserted) {
          setProfile(inserted as UserProfile);
        }
      } else {
        setProfile(data as UserProfile);
      }

      setLoading(false);
    }

    void init();
  }, [demoMode, modeReady, router]);

  useEffect(() => {
    if (demoMode) {
      setLoading(false);
    }
  }, [demoMode]);

  if (!modeReady) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading fleet workspace...</main>;
  }

  if (demoMode) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopNav
          fullName={getDisplayName(demoUsername)}
          role={demoRole}
          compact
          viewMode={viewMode}
          onToggleViewMode={toggleViewMode}
        />
        <main className="min-h-0 flex-1 text-white">
          <FleetViewClient role={demoRole} immersive viewMode={viewMode} />
        </main>
      </div>
    );
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading fleet workspace...</main>;
  }

  if (!profile) {
    return <main className="min-h-screen grid place-items-center text-rose-300">Profile setup failed.</main>;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopNav
        fullName={profile.full_name}
        role={profile.role}
        compact
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
      />
      <main className="min-h-0 flex-1 text-white">
        <FleetViewClient role={profile.role} immersive viewMode={viewMode} />
      </main>
    </div>
  );
}
