// Small auth helpers for API route handlers. Keeps the auth-check
// boilerplate consistent across the CRM / Events route handlers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getAuthedUser(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** True if the user holds at least one of the given role names. */
export async function hasAnyRole(
  supabase: Client,
  userId: string,
  roleNames: string[]
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", roleNames)
    .limit(1);
  return !!data && data.length > 0;
}

export const EVENTS_MANAGE_ROLES = ["super_admin", "admin", "events_admin"];
export const COMMS_MANAGE_ROLES = ["super_admin", "admin", "comms_admin"];

/**
 * True if the user holds at least one of the given granular permission keys,
 * either granted directly or through an assigned role's bundle
 * (user_roles -> role_permissions). Mirrors SQL has_permission() (migration
 * 089) and requireModuleAccess: role scope is not considered.
 */
export async function hasAnyPermission(
  supabase: Client,
  userId: string,
  permissionKeys: string[]
): Promise<boolean> {
  const { data } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key)")
    .eq("user_id", userId)
    .in("permissions.key", permissionKeys)
    .limit(1);
  if (data && data.length > 0) return true;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);
  const roleIds = ((roleRows ?? []) as { role_id: string }[]).map((r) => r.role_id);
  if (roleIds.length === 0) return false;

  const { data: viaRole } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", permissionKeys)
    .limit(1);
  return !!viaRole && viaRole.length > 0;
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
 * True if the user may manage events — either via a managing role
 * (EVENTS_MANAGE_ROLES) or a granular events permission. Mirrors the events
 * RLS (migration 086). Defaults to the "Create / Edit Events" capability
 * (events.create); pass a different key for registration/attendance routes
 * (e.g. ["events.manage_registrations"], ["events.manage_attendance"]).
 */
export async function canManageEvents(
  supabase: Client,
  userId: string,
  perms: string[] = ["events.create"]
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, EVENTS_MANAGE_ROLES)) return true;
  return hasAnyPermission(supabase, userId, perms);
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
  perms: string[] = SCHOOLS_MANAGE_PERMS
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, SCHOOLS_MANAGE_ROLES)) return true;
  return hasAnyPermission(supabase, userId, perms);
}

/**
 * canManageSchools for one program. canManageSchools counts a grant wherever
 * it is scoped, so a leader scoped to program A passes it for program B too;
 * call this once the target program is known. super_admin / admin pass;
 * everyone else needs one of the keys for THIS program through SQL
 * has_permission_for (migration 089): direct or via a role bundle, global or
 * scoped to the program. Pass the USER client — it reads auth.uid().
 */
export async function canManageSchoolsForProgram(
  supabase: Client,
  userId: string,
  programId: string,
  perms: string[] = SCHOOLS_MANAGE_PERMS
): Promise<boolean> {
  if (await hasAnyRole(supabase, userId, ["super_admin", "admin"])) return true;
  const results = await Promise.all(
    perms.map((key) =>
      supabase.rpc("has_permission_for", { required_permission: key, target_program_id: programId })
    )
  );
  return results.some((r: { data: unknown }) => r.data === true);
}
