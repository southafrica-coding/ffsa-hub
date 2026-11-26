// ============================================================
// Store — staff vs buyer
// ============================================================
// Staff: super_admin / admin, or a store.manage (or store.view) grant —
// the same rule as public.store_can_manage() / store_can_view() in 412.
// Buyers: any signed-in Supabase user. Being a buyer grants nothing in the
// staff Hub: no users row, no user_roles, no module.
// ============================================================

export type StoreStaffLevel = "manage" | "view" | null;

/** Pure decision, from the user's role names and permission keys. */
export function storeStaffLevel(input: { roles: string[]; permissionKeys: string[]; isActive: boolean }): StoreStaffLevel {
  if (!input.isActive) return null;
  if (input.roles.includes("super_admin") || input.roles.includes("admin")) return "manage";
  if (input.permissionKeys.includes("store.manage")) return "manage";
  if (input.permissionKeys.includes("store.view")) return "view";
  return null;
}

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Load and decide for one user. A buyer with no users row is never staff. */
export async function getStoreStaffLevel(supabase: Client, userId: string): Promise<StoreStaffLevel> {
  const [account, roles, manage, view] = await Promise.all([
    supabase.from("users").select("is_active").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("roles(name)").eq("user_id", userId),
    supabase.rpc("has_permission", { required_permission: "store.manage" }),
    supabase.rpc("has_permission", { required_permission: "store.view" }),
  ]);
  if (!account.data) return null; // buyers have no users row
  const roleNames = ((roles.data ?? []) as Array<{ roles?: { name?: string } | { name?: string }[] | null }>).flatMap((r) =>
    Array.isArray(r.roles) ? r.roles.map((x) => x?.name ?? "") : [r.roles?.name ?? ""]
  );
  const keys = [manage.data === true ? "store.manage" : "", view.data === true ? "store.view" : ""].filter(Boolean);
  return storeStaffLevel({ roles: roleNames, permissionKeys: keys, isActive: account.data.is_active !== false });
}

export type Buyer = { userId: string; email: string };

/** The signed-in reader, by verified email. Null when signed out. */
export async function getBuyer(supabase: Client): Promise<Buyer | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { userId: user.id, email: String(user.email).toLowerCase() };
}
