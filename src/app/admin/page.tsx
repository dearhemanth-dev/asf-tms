"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminPageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/fleet");
  }, [router]);

  return <main className="min-h-screen grid place-items-center text-slate-300">Redirecting to fleet...</main>;
}

/*
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { APP_ROLES, type AppRole } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";

type TabKey = "users" | "drivers" | "mechanics" | "assets";

type Tenant = {
  id: string;
  name: string;
  code: string | null;
};

type AppUser = {
  id: string;
  username: string;
  full_name: string;
  role: AppRole;
  tenant_id: string | null;
};

type Driver = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  license_number: string | null;
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
  organization_name: string | null;
  year: number | null;
  status: string;
};

const TAB_LIST: Array<{ key: TabKey; label: string }> = [
  { key: "users", label: "Users" },
  { key: "drivers", label: "Drivers" },
  { key: "mechanics", label: "Mechanics" },
  { key: "assets", label: "Assets" },
];

function capitalizeWords(rawValue: string) {
  return rawValue
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, prefix: string, char: string) => `${prefix}${char.toUpperCase()}`);
}

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [currentProfile, setCurrentProfile] = useState<AppUser | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
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
    () => currentProfile?.role === "management" || currentProfile?.role === "accounts",
    [currentProfile?.role]
  );

  function mapUserRow(row: {
    id: string;
    full_name: string | null;
    tenant_id: string | null;
    UserName: string;
    UserType: string;
  }): AppUser {
    return {
      id: row.id,
      username: row.UserName,
      full_name: row.full_name ?? row.UserName,
      role: row.UserType as AppRole,
      tenant_id: row.tenant_id,
    };
  }

  const loadData = useCallback(async (tenantId: string | null, providedClient?: ReturnType<typeof getSupabaseBrowserClient>) => {
    if (!tenantId) return;
    const supabase = providedClient ?? getSupabaseBrowserClient();

    const [{ data: usersData }, { data: driversData }, { data: mechanicsData }, { data: assetsData }] =
      await Promise.all([
        supabase
          .from("Users")
          .select('id, full_name, tenant_id, "UserName", "UserType"')
          .eq("tenant_id", tenantId)
          .order('"UserName"', { ascending: true }),
        supabase
          .from("drivers")
          .select("id, first_name, last_name, phone, license_number, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("mechanics")
          .select("id, full_name, phone, skill, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
        supabase
          .from("assets")
          .select("id, asset_no, organization_name, asset_type, make, model, year, status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }),
      ]);

    setUsers(
      ((usersData as Array<{
        id: string;
        full_name: string | null;
        tenant_id: string | null;
        UserName: string;
        UserType: string;
      }> | null) ?? []).map(mapUserRow)
    );
    setDrivers((driversData as Driver[] | null) ?? []);
    setMechanics((mechanicsData as Mechanic[] | null) ?? []);
    setAssets((assetsData as Asset[] | null) ?? []);
  }, []);

  useEffect(() => {
    async function bootstrap() {
      const supabase = getSupabaseBrowserClient();
      const username = typeof window !== "undefined" ? window.sessionStorage.getItem("demoUsername") : null;

      if (!username) {
        router.replace("/login");
        return;
      }

      const { data: existingUser } = await supabase
        .from("Users")
        .select('id, full_name, tenant_id, "UserName", "UserType"')
        .eq("UserName", username)
        .maybeSingle();

      if (!existingUser) {
        router.replace("/login");
        return;
      }

      const profileBase = mapUserRow(
        existingUser as {
          id: string;
          full_name: string | null;
          tenant_id: string | null;
          UserName: string;
          UserType: string;
        }
      );

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

        await supabase
          .from("Users")
          .update({
            tenant_id: tenantId,
            full_name: profileBase.full_name,
          })
          .eq("UserName", profileBase.username);
      } else {
        const { data: loadedTenant } = await supabase
          .from("tenants")
          .select("id, name, code")
          .eq("id", tenantId)
          .maybeSingle();
        tenantRow = (loadedTenant as Tenant | null) ?? null;
      }

      const profile: AppUser = {
        ...profileBase,
        tenant_id: tenantId,
      };

      if (!["management", "accounts"].includes(profile.role)) {
        router.replace("/tasks");
        return;
      }

      setCurrentProfile(profile);
      setTenant(tenantRow);
      await loadData(tenantId, supabase);
      setLoading(false);
    }

    void bootstrap();
  }, [loadData, router]);

  async function saveUserRole(userId: string, role: AppRole) {
    if (!currentProfile?.tenant_id) return;
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.from("Users").update({ UserType: role }).eq("id", userId);

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
    const { error } = await supabase.from("Users").delete().eq("id", userId);

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
    const normalizedDriverName = capitalizeWords(newDriverName.trim().replace(/\s+/g, " "));
    const splitName = normalizedDriverName.split(/\s+/).filter(Boolean);
    const firstName = splitName[0] ?? "";
    const lastName = splitName.length > 1 ? splitName.slice(1).join(" ") : null;

    if (!firstName) {
      setMessage("Driver name is required.");
      return;
    }

    const { error } = await supabase.from("drivers").insert({
      tenant_id: currentProfile.tenant_id,
      first_name: firstName,
      last_name: lastName,
      phone: newDriverPhone || null,
      license_number: newDriverLicense || null,
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
                onChange={(event) => setInviteRole(event.target.value as AppRole)}
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
                      <td className="px-3 py-2">
                        <div className="font-medium">{user.full_name}</div>
                        <div className="text-xs text-slate-400">{user.username}</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={user.role}
                          onChange={(event) => void saveUserRole(user.id, event.target.value as AppRole)}
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
                onChange={(event) => setNewDriverName(capitalizeWords(event.target.value))}
                autoCapitalize="words"
                className="capitalize rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
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
                  <p className="font-semibold">{[driver.first_name, driver.last_name].filter(Boolean).join(" ")}</p>
                  <p className="text-xs text-slate-400">{driver.phone ?? "No phone"} | {driver.license_number ?? "No license"}</p>
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
                    <th className="px-3 py-2">Organization</th>
                    <th className="px-3 py-2">Details</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id} className="border-t border-slate-800">
                      <td className="px-3 py-2">{asset.asset_no}</td>
                      <td className="px-3 py-2">{asset.organization_name ?? "NA"}</td>
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
*/
