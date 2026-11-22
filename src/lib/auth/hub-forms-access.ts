import { hasUnscopedRole, isUnscopedAdmin, loadEventAccess } from "@/lib/auth/event-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Roles that manage Hub forms (forms with no event). */
export const HUB_FORMS_ROLES = ["comms_admin"] as const;

/**
 * Who may list, create, edit and read responses of Hub forms (/forms):
 * an active, unscoped admin / super_admin, or an unscoped comms_admin.
 *
 * This is the rule /api/forms/[id] already applied to forms with no
 * event, lifted out so the pages, the create route and the sidebar all
 * agree. Event forms keep the event gate (FORMS_GATE) wherever they are
 * opened from.
 */
export async function canManageHubForms(supabase: Client, userId: string): Promise<boolean> {
  const snap = await loadEventAccess(supabase, userId);
  return isUnscopedAdmin(snap) || hasUnscopedRole(snap, HUB_FORMS_ROLES);
}
