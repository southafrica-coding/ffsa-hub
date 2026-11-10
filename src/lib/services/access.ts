// Mirrors user_can_use_service, reading service_owners rows.
// open_to_all use row: any signed-in active user.
// any_point_leader use row: an active member with is_point_leader.
// ministry row: active member of staff_ministry_id. member_role null means
// any active member; member includes leaders; leader is leaders only.
// manage implies use. own does not. Unscoped admin may use a service that
// has at least one row.
//
// Evangelism moderation is only can_moderate_evangelism(). No service_owners
// moderate check for that key.

import { accountIsActive } from "@/lib/auth/grant-scope";
import { holdsUnscopedRole } from "@/lib/departments/access";
import { listActiveMemberships, listUserRoleGrants, type ActiveMembership } from "@/lib/departments/repository";
import { listServiceOwnerRows } from "./repository";
import type { ServiceOwnerRow } from "./seed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const ADMIN_ROLES = ["super_admin", "admin"];
type LiveCapability = "manage" | "use" | "moderate";

export function isOpenToAll(grant: { open_to_all?: boolean | null; capability?: string }): boolean {
  return grant.open_to_all === true && grant.capability === "use";
}

export function memberMatchesGrant(
  grant: Pick<ServiceOwnerRow, "capability" | "staff_ministry_id" | "member_role" | "any_point_leader" | "open_to_all">,
  memberships: readonly ActiveMembership[],
  wanted: LiveCapability
): boolean {
  const capabilityOk = grant.capability === wanted || (wanted === "use" && grant.capability === "manage");
  if (!capabilityOk) return false;
  if (grant.open_to_all === true) return true;
  if (grant.any_point_leader) return memberships.some((membership) => membership.is_point_leader);
  if (!grant.staff_ministry_id) return false;
  const membership = memberships.find((row) => row.staff_ministry_id === grant.staff_ministry_id);
  if (!membership) return false;
  if (grant.member_role == null || grant.member_role === "member") return true;
  return membership.member_role === "leader";
}

/** Use rights from rows. Does not check the account; the caller already did. */
export function mayUseService(
  grants: readonly ServiceOwnerRow[],
  memberships: readonly ActiveMembership[],
  isAdmin: boolean
): boolean {
  if (grants.some((grant) => isOpenToAll(grant))) return true;
  if (grants.length === 0) return false;
  if (isAdmin) return true;
  return grants.some((grant) => memberMatchesGrant(grant, memberships, "use"));
}

export function audienceFromGrants(
  grants: readonly Pick<ServiceOwnerRow, "open_to_all" | "any_point_leader">[]
): "all_signed_in" | "point_leaders" | "owners_only" {
  if (grants.some((grant) => grant.open_to_all === true)) return "all_signed_in";
  if (grants.some((grant) => grant.any_point_leader)) return "point_leaders";
  return "owners_only";
}

async function load(
  supabase: Client,
  userId: string
): Promise<{
  grants: ServiceOwnerRow[] | null;
  memberships: ActiveMembership[] | null;
  isAdmin: boolean;
  failed: boolean;
}> {
  const [roles, grants, memberships] = await Promise.all([
    listUserRoleGrants(supabase, userId),
    listServiceOwnerRows(supabase),
    listActiveMemberships(supabase, userId),
  ]);
  if (roles.error || grants.error || memberships.error) {
    return { grants: null, memberships: null, isAdmin: false, failed: true };
  }
  return {
    grants: grants.data,
    memberships: memberships.data,
    isAdmin: holdsUnscopedRole(roles.data, ADMIN_ROLES),
    failed: false,
  };
}

export async function canUseService(supabase: Client, userId: string, serviceKey: string): Promise<boolean> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return false;
  const loaded = await load(supabase, userId);
  if (loaded.failed || !loaded.grants || !loaded.memberships) return false;
  return mayUseService(
    loaded.grants.filter((grant) => grant.service_key === serviceKey),
    loaded.memberships,
    loaded.isAdmin
  );
}

export async function canManageService(supabase: Client, userId: string, serviceKey: string): Promise<boolean> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return false;
  const loaded = await load(supabase, userId);
  if (loaded.failed || !loaded.grants || !loaded.memberships) return false;
  const grants = loaded.grants.filter((grant) => grant.service_key === serviceKey);
  if (grants.length === 0) return false;
  if (loaded.isAdmin) return true;
  return grants.some((grant) => memberMatchesGrant(grant, loaded.memberships!, "manage"));
}

export async function canModerateService(supabase: Client, userId: string, serviceKey: string): Promise<boolean> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return false;
  if (serviceKey === "evangelism") {
    const { data, error } = await supabase.rpc("can_moderate_evangelism");
    if (error) return false;
    return data === true;
  }
  const loaded = await load(supabase, userId);
  if (loaded.failed || !loaded.grants || !loaded.memberships) return false;
  const grants = loaded.grants.filter((grant) => grant.service_key === serviceKey);
  if (grants.length === 0) return false;
  if (loaded.isAdmin) return true;
  return grants.some((grant) => memberMatchesGrant(grant, loaded.memberships!, "moderate"));
}
