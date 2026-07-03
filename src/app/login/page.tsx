"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import type { AppRole } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const hasSupabaseEnv =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    !String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).startsWith("your_");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [organizationNames, setOrganizationNames] = useState<string[]>([]);
  const defaultNames = ["ASF Carrier Inc.", "ASF Carrier LLC.", "Noble Express", "Simi Transports"];
  const displayNames = organizationNames.length > 0 ? organizationNames : defaultNames;
  const combinedOrganizationLabel =
    displayNames.length > 1
      ? `${displayNames.slice(0, -1).join(", ")}, and ${displayNames[displayNames.length - 1]}`
      : displayNames[0] ?? "";

  useEffect(() => {
    let mounted = true;

    async function loadOrganizationNames() {
      try {
        const response = await fetch("/api/organizations/public-names", { cache: "no-store" });
        const payload = (await response.json()) as { names?: string[] };
        if (!mounted) return;

        const names = Array.isArray(payload.names) ? payload.names.filter((name) => typeof name === "string") : [];
        setOrganizationNames(names.slice(0, 4));
      } catch {
        if (mounted) setOrganizationNames([]);
      }
    }

    void loadOrganizationNames();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const sanitized = username.trim().toLowerCase();
      const loginKey = sanitized.includes("@") ? sanitized.split("@")[0] : sanitized;
      const demoRoleByUser = {
        gsmanager: "management",
        gsaccounts: "accounts",
        gsmaintenance: "maintenance",
        gsdispatch: "dispatch",
        gsdriver: "driver",
        rbmanager: "management",
        rbaccounts: "accounts",
        rbmaintenance: "maintenance",
        rbdispatch: "dispatch",
        rbdriver: "driver",
      } as const;
      const roleFromLogin = demoRoleByUser[loginKey as keyof typeof demoRoleByUser];

      if (!hasSupabaseEnv) {
        if (!roleFromLogin || password !== "p") {
          setMessage("Invalid login credentials");
          return;
        }

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("demoUsername", loginKey);
          window.sessionStorage.setItem("demoRole", roleFromLogin);
          document.cookie = `asf_login=${encodeURIComponent(loginKey)}; path=/; max-age=28800; samesite=lax`;
          document.cookie = `asf_role=${encodeURIComponent(roleFromLogin)}; path=/; max-age=28800; samesite=lax`;
          window.location.href = `/fleet?demoRole=${roleFromLogin}&ts=${Date.now()}`;
          return;
        }

        router.replace(`/fleet?demoRole=${roleFromLogin}`);
        return;
      }

      const supabase = getSupabaseBrowserClient();

      const { data: userRow, error } = await supabase
        .from("Users")
        .select('id, "UserName", "Password", "UserType"')
        .eq("UserName", loginKey)
        .maybeSingle();

      if (error || !userRow || String(userRow.Password) !== password) {
        setMessage("Invalid login credentials");
        return;
      }

      const role = userRow.UserType as AppRole;
      const nextRoute = "/fleet";
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("demoUsername", loginKey);
        window.sessionStorage.setItem("demoRole", role);
        document.cookie = `asf_login=${encodeURIComponent(loginKey)}; path=/; max-age=28800; samesite=lax`;
        document.cookie = `asf_role=${encodeURIComponent(role)}; path=/; max-age=28800; samesite=lax`;
        window.location.href = `${nextRoute}?ts=${Date.now()}`;
        return;
      }

      router.replace(nextRoute);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: "url('/login-bg.jpg')", backgroundPosition: "center center" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0f2f4540_0%,#1b3f5740_35%,#23475933_62%,#10263542_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_14%,#ffffff2e_0%,transparent_36%),radial-gradient(circle_at_83%_20%,#9ec8df24_0%,transparent_40%)]" />

        <div className="absolute inset-0 bg-[linear-gradient(90deg,#b2223412_0%,transparent_32%,transparent_68%,#1d4e8912_100%)]" />
      </div>

      <section className="relative mx-auto mt-16 w-full max-w-md rounded-2xl border border-white/50 bg-[#0f2f4552] p-6 shadow-2xl shadow-[#17405940] backdrop-blur-md">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[#fff3e2]/88">Welcome to</p>
          <p className="text-[15px] leading-7 text-slate-100/88">{combinedOrganizationLabel}</p>
        </div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            placeholder="Login"
            className="w-full rounded-lg border border-[#7eb9d2] bg-[#0c2230cc] px-4 py-3 text-sm text-white outline-none focus:border-[#ffd086]"
          />

          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            placeholder="Password"
            className="w-full rounded-lg border border-[#7eb9d2] bg-[#0c2230cc] px-4 py-3 text-sm text-white outline-none focus:border-[#ffd086]"
          />

          <button
            disabled={loading}
            className="w-full rounded-lg bg-[#ffd086] px-4 py-3 text-sm font-bold text-[#0b2b44] disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {message && <p className="mt-3 text-xs text-[#ffd79b]">{message}</p>}
      </section>

    </main>
  );
}
