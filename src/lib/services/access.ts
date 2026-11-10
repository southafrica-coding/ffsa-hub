// Service gates, driven by service_owners rows.
//
// manage implies use. moderate does not imply manage or use. own is the
// ownership lookup only — it does not satisfy any of the three.
//
// Admin and super_admin (unscoped) are allowed when the service exists.
// An unknown key is not an allow: there is nothing to administer.
// is_active = false denies. A failed lookup denies, including a failed
// membership read for someone who is otherwise an admin.

import { accountIsActive } from "@/lib/auth/grant-scope";
import { holdsUnscopedRole } from "@/lib/departments/access";
import {
  listActiveMemberships,
  listMinistriesById,
  listUserRoleGrants,
  type ActiveMembership,
} from "@/lib/departments/repository";
import type { ServiceCapability, ServiceOwnerRow, ServiceOwnership } from "@/lib/departments/types";
import { listServiceOwnerRows } from "./repository";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const ADMIN_ROLES = ["super_admin", "admin"];
type LiveCapability = Exclude<ServiceCapability, "own">;

export function grantMatches(
  grant: Pick<ServiceOwnerRow, "capability" | "staff_ministry_id" | "member_role" | "any_point_leader">,
  memberships: readonly Pick<ActiveMembership, "staff_ministry_id" | "member_role">[],
  wanted: LiveCapability
): boolean {
  const capabilityOk = grant.capability === wanted || (wanted === "use" && grant.capability === "manage");
  if (!capabilityOk) return false;
  if (grant.any_point_leader) {
    return memberships.some((membership) => membership.member_role === "leader");
  }
  if (!grant.staff_ministry_id) return false;
  const membership = memberships.find((row) => row.staff_ministry_id === grant.staff_ministry_id);
  if (!membership) return false;
  if (grant.member_role === "leader") return membership.member_role === "leader";
  return membership.member_role === "member" || membership.member_role === "leader";
}

export function holdsServiceCapability(
  grants: readonly ServiceOwnerRow[],
  memberships: readonly ActiveMembership[],
  wanted: LiveCapability,
  isAdmin: boolean
): boolean {
  if (grants.length === 0) return false;
  if (isAdmin) return true;
  return grants.some((grant) => grantMatches(grant, memberships, wanted));
}

async function can(
  supabase: Client,
  userId: string,
  serviceKey: string,
  wanted: LiveCapability
): Promise<boolean> {
  const active = await accountIsActive(supabase, userId);
  if (!active) return false;

  const [roles, grants, memberships] = await Promise.all([
    listUserRoleGrants(supabase, userId),
    listServiceOwnerRows(supabase, serviceKey),
    listActiveMemberships(supabase, userId),
  ]);
  if (roles.error || grants.error || memberships.error) return false;
  return holdsServiceCapability(
    grants.data,
    memberships.data,
    wanted,
    holdsUnscopedRole(roles.data, ADMIN_ROLES)
  );
}

export async function canManageService(
  supabase: Client,
  userId: string,
  serviceKey: string
): Promise<boolean> {
  return can(supabase, userId, serviceKey, "manage");
}

export async function canUseService(
  supabase: Client,
  userId: string,
  serviceKey: string
): Promise<boolean> {
  return can(supabase, userId, serviceKey, "use");
}

export async function canModerateService(
  supabase: Client,
  userId: string,
  serviceKey: string
): Promise<boolean> {
  return can(supabase, userId, serviceKey, "moderate");
}

export function toServiceOwnership(
  serviceKey: string,
  grants: readonly ServiceOwnerRow[],
  ministries: readonly { id: string; slug: string; name: string }[]
): ServiceOwnership {
  const adminHref = grants.find((grant) => grant.admin_href)?.admin_href ?? null;
  const seen = new Set<string>();
  const owners = [];
  for (const grant of grants) {
    if (!grant.staff_ministry_id || seen.has(grant.staff_ministry_id)) continue;
    seen.add(grant.staff_ministry_id);
    const ministry = ministries.find((row) => row.id === grant.staff_ministry_id);
    owners.push({
      staff_ministry_id: grant.staff_ministry_id,
      slug: ministry?.slug ?? null,
      name: ministry?.name ?? null,
    });
  }
  owners.sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
  return { service_key: serviceKey, admin_href: adminHref, owners };
}

/**
 * Owning ministries for one service key, plus admin_href.
 * data null and error null means the key has no rows (unknown).
 */
export async function getServiceOwners(
  supabase: Client,
  serviceKey: string
): Promise<{ data: ServiceOwnership | null; error: { message: string } | null }> {
  const grants = await listServiceOwnerRows(supabase, serviceKey);
  if (grants.error) return { data: null, error: grants.error };
  if (grants.data.length === 0) return { data: null, error: null };
  const ids = grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []));
  const ministries = await listMinistriesById(supabase, ids);
  if (ministries.error) return { data: null, error: ministries.error };
  return { data: toServiceOwnership(serviceKey, grants.data, ministries.data), error: null };
}

/** Every service that has at least one service_owners row. */
export async function listServiceOwnership(
  supabase: Client
): Promise<{ data: ServiceOwnership[] | null; error: { message: string } | null }> {
  const grants = await listServiceOwnerRows(supabase);
  if (grants.error) return { data: null, error: grants.error };
  const ids = [...new Set(grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : [])))];
  const ministries = await listMinistriesById(supabase, ids);
  if (ministries.error) return { data: null, error: ministries.error };
  const keys = [...new Set(grants.data.map((grant) => grant.service_key))].sort((a, b) => a.localeCompare(b));
  return {
    data: keys.map((key) =>
      toServiceOwnership(
        key,
        grants.data.filter((grant) => grant.service_key === key),
        ministries.data
      )
    ),
    error: null,
  };
}
