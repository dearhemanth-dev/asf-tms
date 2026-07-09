"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ROLES, normalizeAppRole, type AppRole, type UserProfile } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";

type TabKey = "users" | "drivers" | "mechanics" | "assets";

type Tenant = {
  id: string;
  name: string;
  code: string | null;
};

type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  license_no: string | null;
  status: string;
};

type Mechanic = {
  id: string;
  full_name: string;
  phone: string | null;
  skill: string | null;
  status: string;
};

type Asset = {
  id: string;
  asset_no: string;
  asset_type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
};

const TAB_LIST: Array<{ key: TabKey; label: string }> = [
  { key: "users", label: "Users" },
  { key: "drivers", label: "Drivers" },
  { key: "mechanics", label: "Mechanics" },
  { key: "assets", label: "Assets" },
];

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("dispatch");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverPhone, setNewDriverPhone] = useState("");
  const [newDriverLicense, setNewDriverLicense] = useState("");
  const [newMechanicName, setNewMechanicName] = useState("");
  const [newMechanicPhone, setNewMechanicPhone] = useState("");
  const [newMechanicSkill, setNewMechanicSkill] = useState("");
  const [newAssetNo, setNewAssetNo] = useState("");
  const [newAssetType, setNewAssetType] = useState("");
  const [newAssetMake, setNewAssetMake] = useState("");
  const [newAssetModel, setNewAssetModel] = useState("");
  const [newAssetYear, setNewAssetYear] = useState("");

  const canManageMechanics = useMemo(
    () => currentProfile?.role === "admin" || currentProfile?.role === "management" || currentProfile?.role === "accounts",
    [currentProfile?.role]
  );

  useEffect(() => {
    async function bootstrap() {
      if (typeof window !== "undefined") {
        const demoRoleRaw = window.sessionStorage.getItem("demoRole");
        const demoRole = normalizeAppRole(demoRoleRaw, "management");
        const demoUsername = window.sessionStorage.getItem("demoUsername") ?? "demoadmin";
        const demoFullName = demoUsername
          .split(/[._-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");

        if (["admin", "management", "accounts"].includes(demoRole)) {
          setCurrentProfile({
            id: `demo:${demoUsername}`,
            full_name: demoFullName || "ASF Admin",
            role: demoRole,
            tenant_id: null,
          });
          setTenant({ id: "demo", name: "Demo Tenant", code: "DEMO" });
          setMessage("Demo admin mode is active. Data writes are disabled until a tenant session is connected.");
          setLoading(false);
          return;
        }
      }

      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id, full_name, role, tenant_id")
        .eq("id", session.user.id)
        .maybeSingle();

      const profileBase: UserProfile =
        (existingProfile as UserProfile | null) ?? {
          id: session.user.id,
          full_name: (session.user.user_metadata.full_name as string | undefined) ?? "ASF User",
          role: "management",
          tenant_id: null,
        };

      let tenantId = profileBase.tenant_id;
      let tenantRow: Tenant | null = null;

      if (!tenantId) {
        const { data: createdTenant, error: tenantError } = await supabase
          .from("tenants")
          .insert({
            name: "ASF Logistics",
            code: `ASF-${Math.floor(1000 + Math.random() * 9000)}`,
          })
          .select("id, name, code")
          .single();

        if (tenantError || !createdTenant) {
          setMessage(tenantError?.message ?? "Failed to initialize tenant");
          setLoading(false);
          return;
        }

        tenantRow = createdTenant as Tenant;
        tenantId = createdTenant.id;

        await supabase.from("profiles").upsert({
          id: session.user.id,
          full_name: profileBase.full_name,
          role: profileBase.role,
          tenant_id: tenantId,
        });
      } else {
        const { data: loadedTenant } = await supabase
          .from("tenants")
          .select("id, name, code")
          .eq("id", tenantId)
          .maybeSingle();
        tenantRow = (loadedTenant as Tenant | null) ?? null;
      }

      const profile: UserProfile = {
        ...profileBase,
        role: normalizeAppRole(profileBase.role, "management"),
        tenant_id: tenantId,
      };

      if (!["admin", "management", "accounts"].includes(profile.role)) {
        router.replace("/tasks");
        return;
      }

      setCurrentProfile(profile);
      setTenant(tenantRow);
      await loadData(tenantId, supabase);
      setLoading(false);
    }

    void bootstrap();
  }, [router]);

  async function loadData(tenantId: string | null, providedClient?: ReturnType<typeof getSupabaseBrowserClient>) {
    if (!tenantId) return;
    const supabase = providedClient ?? getSupabaseBrowserClient();

    const [{ data: usersData }, { data: driversData }, { data: mechanicsData }, { data: assetsData }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, role, tenant_id")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("drivers")
          .select("id, full_name, phone, license_no, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("mechanics")
          .select("id, full_name, phone, skill, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("assets")
          .select("id, asset_no, asset_type, make, model, year, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
      ]);

    setUsers((usersData as UserProfile[] | null) ?? []);
    setDrivers((driversData as Driver[] | null) ?? []);
    setMechanics((mechanicsData as Mechanic[] | null) ?? []);
    setAssets((assetsData as Asset[] | null) ?? []);
  }

  async function saveUserRole(userId: string, role: AppRole) {
    if (!currentProfile?.tenant_id) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("User role updated.");
    await loadData(currentProfile.tenant_id);
  }

  async function removeUser(userId: string) {
    if (!currentProfile?.tenant_id) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("profiles").delete().eq("id", userId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("User removed.");
    await loadData(currentProfile.tenant_id);
  }

  async function createOnboardingRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProfile?.tenant_id) return;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("user_onboarding_requests").insert({
      tenant_id: currentProfile.tenant_id,
      email: inviteEmail,
      requested_role: inviteRole,
      requested_by: currentProfile.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setInviteEmail("");
    setInviteRole("dispatch");
    setMessage("Onboarding request created.");
  }

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProfile?.tenant_id) return;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("drivers").insert({
      tenant_id: currentProfile.tenant_id,
      full_name: newDriverName,
      phone: newDriverPhone || null,
      license_no: newDriverLicense || null,
      created_by: currentProfile.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setNewDriverName("");
    setNewDriverPhone("");
    setNewDriverLicense("");
    setMessage("Driver added.");
    await loadData(currentProfile.tenant_id);
  }

  async function deleteDriver(driverId: string) {
    if (!currentProfile?.tenant_id) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("drivers").delete().eq("id", driverId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Driver removed.");
    await loadData(currentProfile.tenant_id);
  }

  async function createMechanic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProfile?.tenant_id || !canManageMechanics) return;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("mechanics").insert({
      tenant_id: currentProfile.tenant_id,
      full_name: newMechanicName,
      phone: newMechanicPhone || null,
      skill: newMechanicSkill || null,
      created_by: currentProfile.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setNewMechanicName("");
    setNewMechanicPhone("");
    setNewMechanicSkill("");
    setMessage("Mechanic added.");
    await loadData(currentProfile.tenant_id);
  }

  async function deleteMechanic(mechanicId: string) {
    if (!currentProfile?.tenant_id || !canManageMechanics) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("mechanics").delete().eq("id", mechanicId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Mechanic removed.");
    await loadData(currentProfile.tenant_id);
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentProfile?.tenant_id) return;

    const parsedYear = newAssetYear.trim() ? Number.parseInt(newAssetYear, 10) : null;

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("assets").insert({
      tenant_id: currentProfile.tenant_id,
      asset_no: newAssetNo,
      asset_type: newAssetType,
      make: newAssetMake || null,
      model: newAssetModel || null,
      year: Number.isNaN(parsedYear) ? null : parsedYear,
      created_by: currentProfile.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setNewAssetNo("");
    setNewAssetType("");
    setNewAssetMake("");
    setNewAssetModel("");
    setNewAssetYear("");
    setMessage("Asset added.");
    await loadData(currentProfile.tenant_id);
  }

  async function deleteAsset(assetId: string) {
    if (!currentProfile?.tenant_id) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("assets").delete().eq("id", assetId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Asset removed.");
    await loadData(currentProfile.tenant_id);
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center text-slate-300">Loading admin workspace...</main>;
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-6 text-white">
      <div className="glass mx-auto max-w-6xl rounded-3xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Onboarding + Ops Control</p>
            <h1 className="mt-2 text-2xl font-black">Role + Resource Admin</h1>
            <p className="mt-1 text-xs text-slate-400">Tenant: {tenant?.name ?? "Unassigned"}</p>
          </div>
          <button
            className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() => void loadData(currentProfile?.tenant_id ?? null)}
          >
            Refresh
          </button>
        </div>

        {message && <p className="rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-3 text-sm text-cyan-200">{message}</p>}

        <div className="flex flex-wrap gap-2">
          {TAB_LIST.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-2 text-sm ${
                activeTab === tab.key
                  ? "bg-cyan-300 text-slate-950 font-semibold"
                  : "bg-slate-900 text-slate-200 hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "users" && (
          <section className="space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200">Planned For Admin</p>
              <h2 className="mt-2 text-base font-semibold text-amber-100">Fault Alert Recipient Management</h2>
              <p className="mt-1 text-sm text-amber-100/90">
                Configure who receives Fault Code alerts (start with Maintenance + Manager), with add/remove controls per tenant.
              </p>
            </div>

            <form onSubmit={createOnboardingRequest} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-4">
              <input
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Invite email"
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(normalizeAppRole(event.target.value, "dispatch"))}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              >
                {APP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <button className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 md:col-span-2">
                Create onboarding request
              </button>
            </form>

            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">{user.full_name}</td>
                      <td className="px-3 py-2">
                        <select
                          value={user.role}
                          onChange={(event) => void saveUserRole(user.id, normalizeAppRole(event.target.value, "dispatch"))}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1"
                        >
                          {APP_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void removeUser(user.id)}
                          className="rounded-lg border border-rose-700 px-2 py-1 text-rose-300"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "drivers" && (
          <section className="space-y-4">
            <form onSubmit={createDriver} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-4">
              <input
                required
                value={newDriverName}
                onChange={(event) => setNewDriverName(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Driver name"
              />
              <input
                value={newDriverPhone}
                onChange={(event) => setNewDriverPhone(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Phone"
              />
              <input
                value={newDriverLicense}
                onChange={(event) => setNewDriverLicense(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="License"
              />
              <button className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950">Add driver</button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              {drivers.map((driver) => (
                <article key={driver.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="font-semibold">{driver.full_name}</p>
                  <p className="text-xs text-slate-400">{driver.phone ?? "No phone"} | {driver.license_no ?? "No license"}</p>
                  <button
                    onClick={() => void deleteDriver(driver.id)}
                    className="mt-3 rounded-lg border border-rose-700 px-2 py-1 text-xs text-rose-300"
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "mechanics" && (
          <section className="space-y-4">
            <form onSubmit={createMechanic} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-4">
              <input
                required
                disabled={!canManageMechanics}
                value={newMechanicName}
                onChange={(event) => setNewMechanicName(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                placeholder="Mechanic name"
              />
              <input
                disabled={!canManageMechanics}
                value={newMechanicPhone}
                onChange={(event) => setNewMechanicPhone(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                placeholder="Phone"
              />
              <input
                disabled={!canManageMechanics}
                value={newMechanicSkill}
                onChange={(event) => setNewMechanicSkill(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                placeholder="Skill"
              />
              <button
                disabled={!canManageMechanics}
                className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
              >
                Add mechanic
              </button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              {mechanics.map((mechanic) => (
                <article key={mechanic.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="font-semibold">{mechanic.full_name}</p>
                  <p className="text-xs text-slate-400">{mechanic.phone ?? "No phone"} | {mechanic.skill ?? "No skill"}</p>
                  <button
                    onClick={() => void deleteMechanic(mechanic.id)}
                    disabled={!canManageMechanics}
                    className="mt-3 rounded-lg border border-rose-700 px-2 py-1 text-xs text-rose-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "assets" && (
          <section className="space-y-4">
            <form onSubmit={createAsset} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-5">
              <input
                required
                value={newAssetNo}
                onChange={(event) => setNewAssetNo(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Asset no"
              />
              <input
                required
                value={newAssetType}
                onChange={(event) => setNewAssetType(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Type"
              />
              <input
                value={newAssetMake}
                onChange={(event) => setNewAssetMake(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Make"
              />
              <input
                value={newAssetModel}
                onChange={(event) => setNewAssetModel(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Model"
              />
              <input
                value={newAssetYear}
                onChange={(event) => setNewAssetYear(event.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Year"
              />
              <button className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 md:col-span-5">Add asset</button>
            </form>

            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-3 py-2">Asset</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">{asset.asset_no}</td>
                      <td className="px-3 py-2">{asset.asset_type}</td>
                      <td className="px-3 py-2 text-slate-300 text-xs">
                        {asset.make ?? "NA"} {asset.model ?? ""} {asset.year ?? ""}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void deleteAsset(asset.id)}
                          className="rounded-lg border border-rose-700 px-2 py-1 text-rose-300"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
