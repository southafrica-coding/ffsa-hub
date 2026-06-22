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

/** True if the user holds at least one of the given granular permission keys. */
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
  return !!data && data.length > 0;
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

/**
 * True if the user may view/manage an event's ticketing reports — i.e. they
 * hold any events-management capability (create/edit, registrations, or
 * attendance). Used to gate the per-event "Reports" tab subscription routes.
 * The subscription rows themselves are self-scoped by RLS (migration 111);
 * this is the "may subscribe to this event at all" gate.
 */
export async function canAccessEventReports(
  supabase: Client,
  userId: string
): Promise<boolean> {
  return canManageEvents(supabase, userId, [
    "events.create",
    "events.manage_registrations",
    "events.manage_attendance",
  ]);
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
  if (await hasAnyRole(supabase, userId, FINANCE_MANAGE_ROLES)) return true;
  return hasAnyPermission(supabase, userId, FINANCE_MANAGE_PERMS);
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
