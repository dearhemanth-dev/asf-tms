"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import FleetViewClient from "@/components/FleetViewClient";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { APP_ROLES, type AppRole } from "@/lib/auth";

type UserProfile = {
  id: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
};

export default function FleetPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const demoMode =
    process.env.NEXT_PUBLIC_FORCE_DEMO_FLEET === "true" ||
    !supabaseUrl ||
    !supabaseAnon ||
    supabaseAnon.startsWith("your_");
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(!demoMode);
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
    return username || "User";
  };

  useEffect(() => {
    if (demoMode) return;

    async function init() {
      const supabase = getSupabaseBrowserClient();
      
      // Check sessionStorage first (from Users table login)
      const username = typeof window !== "undefined" ? window.sessionStorage.getItem("demoUsername") : null;
      if (username) {
        const { data: userRow } = await supabase
          .from("Users")
          .select("id, full_name, tenant_id, UserName, UserType")
          .eq("UserName", username)
          .maybeSingle();
        
        if (userRow) {
          const userProfile: UserProfile = {
            id: userRow.id,
            full_name: userRow.full_name || username,
            role: userRow.UserType as AppRole,
            tenant_id: userRow.tenant_id,
          };
          setProfile(userProfile);
          setLoading(false);
          return;
        }
      }
      
      // Fallback to Supabase Auth session
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
  }, [demoMode, router]);

  if (demoMode) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopNav
          fullName={getDisplayName(demoUsername)}
          role={demoRole}
          viewMode={viewMode}
          onToggleViewMode={() => setViewMode((current) => (current === "map" ? "list" : "map"))}
          compact
        />
        <main className="min-h-0 flex-1 text-white">
          <FleetViewClient role={demoRole} viewMode={viewMode} immersive />
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
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode((current) => (current === "map" ? "list" : "map"))}
        compact
      />
      <main className="min-h-0 flex-1 text-white">
        <FleetViewClient role={profile.role} viewMode={viewMode} immersive />
      </main>
    </div>
  );
}
