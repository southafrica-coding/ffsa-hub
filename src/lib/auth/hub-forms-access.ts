import { hasUnscopedRole, isUnscopedAdmin, loadEventAccess } from "@/lib/auth/event-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Roles that manage Hub forms (forms with no event). */
export const HUB_FORMS_ROLES = ["comms_admin"] as const;

/** The one Hub form Missio pastors may edit (seeded, slug missio-weekly-feedback). */
export const MISSIO_WEEKLY_FEEDBACK_KIND = "missio_weekly_feedback";

/**
 * What a Missio-pastor-only editor may change on that form: its questions
 * and its name. Not kind, slug, access_mode (it stays on house links),
 * subject_type, is_active, labels, attendance or redirect, and never a delete.
 */
export const MISSIO_PASTOR_FORM_FIELDS = ["name", "schema"] as const;

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

/** True for the Missio weekly feedback form row: that kind, and no event. */
export function isMissioWeeklyFeedbackForm(form: { kind?: unknown; event_id?: unknown } | null | undefined): boolean {
  return Boolean(form && form.kind === MISSIO_WEEKLY_FEEDBACK_KIND && !form.event_id);
}

/**
 * The signed-in user is a pastor in the Missio org: the same
 * has_org_role('missio', ['pastor']) check behind Missio's pastor-only
 * routes (Finance, Calendar, People). A failed lookup is a no.
 */
export async function isMissioPastorUser(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_org_role", { p_org_slug: "missio", p_roles: ["pastor"] });
  return !error && data === true;
}

/**
 * How someone may handle a Hub form (no event):
 *   "manage"        — canManageHubForms: everything, as before.
 *   "missio_pastor" — only the Missio weekly feedback form, read and edit
 *                     its questions (MISSIO_PASTOR_FORM_FIELDS); no delete.
 *   null            — nothing.
 */
export async function hubFormAccess(
  supabase: Client,
  userId: string,
  form: { kind?: unknown; event_id?: unknown }
): Promise<"manage" | "missio_pastor" | null> {
  if (await canManageHubForms(supabase, userId)) return "manage";
  if (isMissioWeeklyFeedbackForm(form) && (await isMissioPastorUser(supabase))) return "missio_pastor";
  return null;
}

/**
 * May this user open and save the Missio weekly feedback form's questions?
 * Only for that form (kind missio_weekly_feedback, no event), and only a
 * Missio pastor or someone who already manages Hub forms.
 */
export async function canEditMissioWeeklyFeedbackForm(
  supabase: Client,
  userId: string,
  form: { kind?: unknown; event_id?: unknown }
): Promise<boolean> {
  if (!isMissioWeeklyFeedbackForm(form)) return false;
  return (await hubFormAccess(supabase, userId, form)) !== null;
}
