// Small auth helpers for API route handlers. Keeps the auth-check
// boilerplate consistent across the CRM / Events route handlers.

import {
  accountIsActive,
  grantCounts,
  namesOf,
  permissionOf,
  type PermissionCheck,
} from "@/lib/auth/grant-scope";
import { canManageEvent } from "@/lib/auth/event-access";

export type { GrantScope, PermissionCheck } from "@/lib/auth/grant-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getAuthedUser(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * True if an active user holds at least one of the given role names.
 * Unscoped assignments count for every caller. A program-scoped assignment
 * counts only when `scope.programId` is that program. Team and event
 * assignments never match. A lookup error is false.
 */
export async function hasAnyRole(
  supabase: Client,
  userId: string,
  roleNames: string[],
  scope?: PermissionCheck
): Promise<boolean> {
  if (roleNames.length === 0) return false;
  const [active, roles] = await Promise.all([
    accountIsActive(supabase, userId),
    supabase
      .from("user_roles")
      .select("scope_type, scope_id, roles!inner(name)")
      .eq("user_id", userId)
      .in("roles.name", roleNames),
  ]);
  if (!active || roles.error) return false;
  const rows = (Array.isArray(roles.data) ? roles.data : []) as Array<{
    scope_type?: string | null;
    scope_id?: string | null;
    roles?: { name?: string } | { name?: string }[] | null;
  }>;
  return rows.some(
    (row) =>
      namesOf(row.roles).some((name) => roleNames.includes(name)) &&
      grantCounts(row.scope_type, row.scope_id, scope)
  );
}

export const EVENTS_MANAGE_ROLES = ["super_admin", "admin", "events_admin"];
export const COMMS_MANAGE_ROLES = ["super_admin", "admin", "comms_admin"];

/**
 * True if an active user holds at least one of the given permission keys
 * on user_permissions. Same scope rule as hasAnyRole. finance.* keys count
 * only when that grant is unscoped, even if programId matches (migration 316).
 * Pass `{ viaRoleBundle: true }` to also accept the key from a role bundle
 * whose assignment matches the scope. A lookup error is false.
 */
export async function hasAnyPermission(
  supabase: Client,
  userId: string,
  permissionKeys: string[],
  scope?: PermissionCheck
): Promise<boolean> {
  if (permissionKeys.length === 0) return false;
  const [active, perms, roles] = await Promise.all([
    accountIsActive(supabase, userId),
    supabase
      .from("user_permissions")
      .select("scope_type, scope_id, permissions!inner(key)")
      .eq("user_id", userId)
      .in("permissions.key", permissionKeys),
    scope?.viaRoleBundle
      ? supabase.from("user_roles").select("role_id, scope_type, scope_id").eq("user_id", userId)
      : Promise.resolve(null),
  ]);
  if (!active || perms.error || (scope?.viaRoleBundle && roles?.error)) return false;

  const direct = (Array.isArray(perms.data) ? perms.data : []) as Array<{
    scope_type?: string | null;
    scope_id?: string | null;
    permissions?: { key?: string } | { key?: string }[] | null;
  }>;
  const directHit = direct.some((row) => {
    const key = permissionOf(row)?.key;
    return (
      typeof key === "string" &&
      permissionKeys.includes(key) &&
      grantCounts(row.scope_type, row.scope_id, scope, key)
    );
  });
  if (directHit || !scope?.viaRoleBundle) return directHit;

  const assignments = (Array.isArray(roles?.data) ? roles.data : []) as Array<{
    role_id?: string;
    scope_type?: string | null;
    scope_id?: string | null;
  }>;
  const roleIds = [
    ...new Set(
      assignments
        .filter((row) => typeof row.role_id === "string" && grantCounts(row.scope_type, row.scope_id, scope))
        .map((row) => row.role_id as string)
    ),
  ];
  if (roleIds.length === 0) return false;

  const bundled = await supabase
    .from("role_permissions")
    .select("role_id, permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", permissionKeys);
  if (bundled.error) return false;
  const rows = (Array.isArray(bundled.data) ? bundled.data : []) as Array<{
    role_id?: string;
    permissions?: { key?: string } | { key?: string }[] | null;
  }>;
  return rows.some((row) => {
    const key = permissionOf(row)?.key;
    if (typeof key !== "string" || !permissionKeys.includes(key)) return false;
    return assignments.some(
      (assignment) =>
        assignment.role_id === row.role_id &&
        grantCounts(assignment.scope_type, assignment.scope_id, scope, key)
    );
  });
}

// Roles or granular permissions that allow writing contact data.
export const CONTACTS_WRITE_ROLES = [
  "super_admin",
  "admin",
  "comms_admin",
  "contacts_admin",
];
export const CONTACTS_WRITE_PERMS = [
  "contacts.write",
  "contacts.edit",
  "contacts.create",
];

/**
 * True if the user may write contact data — either via a contacts-capable
 * role or a granular contacts write permission. Mirrors the RLS policy on
 * the contact tables (migration 087) so the admin-client routes and the
 * browser-client (RLS) paths agree.
 */
export async function canWriteContacts(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, CONTACTS_WRITE_ROLES)) return true;
  return hasAnyPermission(supabase, userId, CONTACTS_WRITE_PERMS);
}

// Roles / permissions that allow READING contact data. Mirrors the
// contacts SELECT RLS policy (migration 087): staff + admin roles, or a
// granular contacts.view / contacts.read grant (write implies read).
export const CONTACTS_VIEW_ROLES = [
  "super_admin",
  "admin",
  "staff",
  "events_admin",
  "comms_admin",
  "contacts_admin",
];
export const CONTACTS_VIEW_PERMS = [
  "contacts.view",
  "contacts.read",
  ...CONTACTS_WRITE_PERMS,
];

/** True if the user may view contact data (person quick-view, contact list). */
export async function canViewContacts(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, CONTACTS_VIEW_ROLES)) return true;
  return hasAnyPermission(supabase, userId, CONTACTS_VIEW_PERMS);
}

/**
 * Scope-aware events gate. `eventId` null counts only an unscoped grant
 * (has_event_permission's NULL rule) plus an unscoped admin / events_admin
 * role. The admin, super_admin and events_admin bypasses require an
 * active account (is_active IS NOT FALSE), matching is_admin() and
 * has_role() in migration 316.
 * Scan links must not use this — they have no events_admin bypass;
 * call canManageEvent with SCAN_LINK_GATE. Order routes need finance_admin
 * and should pass ORDERS_GATE to canManageEvent instead.
 */
export async function canManageEvents(
  supabase: Client,
  userId: string,
  perms: string[] = ["events.create"],
  eventId: string | null = null
): Promise<boolean> {
  return canManageEvent(supabase, userId, perms, eventId, {
    bypassRoles: ["events_admin"],
  });
}

// Roles or granular permissions that allow managing finance config
// (school billing setup, the country-tier backbone list, fee structures).
// Mirrors the finance RLS (admins / finance_admin).
export const FINANCE_MANAGE_ROLES = ["super_admin", "admin", "finance_admin"];
export const FINANCE_MANAGE_PERMS = ["finance.manage", "finance.write"];

/**
 * True if the user may manage finance configuration — either via a finance
 * role (FINANCE_MANAGE_ROLES) or a granular finance permission. Mirrors the
 * RLS on country_tiers / school billing tables (migrations 009, 095).
 */
export async function canManageFinance(
  supabase: Client,
  userId: string
): Promise<boolean> {
  // Independent reads — ask both at once rather than one after the other.
  const [byRole, byPermission] = await Promise.all([
    hasAnyRole(supabase, userId, FINANCE_MANAGE_ROLES),
    hasAnyPermission(supabase, userId, FINANCE_MANAGE_PERMS),
  ]);
  return byRole || byPermission;
}

// Granular communications permissions that imply "can manage / can send".
export const COMMS_MANAGE_PERMS = [
  "communications.send_emails",
  "communications.send_announcements",
  "communications.manage_templates",
  "campaigns.draft",
];
export const COMMS_SEND_PERMS = [
  "communications.send_emails",
  "communications.send_announcements",
  "campaigns.send",
];

/**
 * True if the user may manage communications — either via a comms role
 * (COMMS_MANAGE_ROLES) or a granular communications permission. Mirrors the
 * campaigns RLS (migration 091). Defaults to the "manage" capability; pass
 * COMMS_SEND_PERMS for the send / test-send routes.
 */
export async function canManageComms(
  supabase: Client,
  userId: string,
  perms: string[] = COMMS_MANAGE_PERMS
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, COMMS_MANAGE_ROLES)) return true;
  return hasAnyPermission(supabase, userId, perms);
}

// Roles or granular permissions that allow managing school/training
// applications — viewing applications, managing references, deciding outcomes.
// Mirrors the schools RLS (admins) plus the granular `schools.manage` grant
// used by the point-of-contact assignment scopes.
export const SCHOOLS_MANAGE_ROLES = ["super_admin", "admin", "schools_admin"];
export const SCHOOLS_MANAGE_PERMS = ["schools.manage"];

/**
 * True if the user may manage school applications (incl. editing reference
 * contacts) — either via a schools-capable role or the granular
 * `schools.manage` permission. Use to gate admin-client reference routes so
 * they don't rely on "is the caller merely logged in".
 */
export async function canManageSchools(
  supabase: Client,
  userId: string,
  perms: string[] = SCHOOLS_MANAGE_PERMS,
  scope?: PermissionCheck
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, SCHOOLS_MANAGE_ROLES, scope)) return true;
  return hasAnyPermission(supabase, userId, perms, scope);
}
