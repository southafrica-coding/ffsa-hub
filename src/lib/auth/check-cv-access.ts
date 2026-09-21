// Authorization helpers for the staff CV / personal card feature
// (migration 218).
//
// Model:
//   - View: the card owner, an admin, any Leadership Team member (sees
//     everyone), or an active leader of a ministry the owner belongs to.
//   - Add a 'self'-scope entry: the owner, or admin (on-behalf editing).
//   - Add a 'leadership'-scope entry: any Leadership Team member, or admin.
//   - Manage (edit/delete) an existing entry: admin always; a 'self'-scope
//     entry only by its owner; a 'leadership'-scope entry only by a
//     Leadership Team member — the owner and their ministry leader may see
//     it but never touch it.
//
// RLS on staff_cv_entries only covers self + admin (see migration 218), so
// every cross-user read or Leadership-scope write MUST go through the
// service-role client, gated by these checks — mirrors the program-leader
// read in src/app/(admin)/users/[id]/page.tsx.

import { callerIsAdmin, getLedMinistryIds } from "./check-ministry-access";
import { isLeadershipTeam } from "./check-okr-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type CvEntryScope = "self" | "leadership";

export type CvEntry = {
  user_id: string;
  added_by_role: CvEntryScope;
};

/** True if `targetUserId` is an active member of any ministry `viewerId` leads. */
export async function viewerLeadsTargetsMinistry(
  supabase: Client,
  viewerId: string,
  targetUserId: string
): Promise<boolean> {
  const ledIds = await getLedMinistryIds(supabase, viewerId);
  if (ledIds.length === 0) return false;
  const { data } = await supabase
    .from("staff_ministry_members")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("status", "active")
    .in("staff_ministry_id", ledIds)
    .limit(1);
  return ((data as unknown[] | null)?.length ?? 0) > 0;
}

/**
 * Self, admin, Leadership Team (sees everyone), or a leader of a ministry
 * the target belongs to.
 */
export async function canViewStaffCard(
  supabase: Client,
  viewerId: string,
  targetUserId: string
): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  if (await callerIsAdmin(supabase, viewerId)) return true;
  if (await isLeadershipTeam(supabase, viewerId)) return true;
  return viewerLeadsTargetsMinistry(supabase, viewerId, targetUserId);
}

/** May the viewer add a new entry of this scope to targetUserId's card? */
export async function canAddCvEntry(
  supabase: Client,
  viewerId: string,
  targetUserId: string,
  scope: CvEntryScope
): Promise<boolean> {
  if (await callerIsAdmin(supabase, viewerId)) return true;
  if (scope === "self") return viewerId === targetUserId;
  return isLeadershipTeam(supabase, viewerId);
}

/** May the viewer edit or delete this existing entry? */
export async function canManageCvEntry(
  supabase: Client,
  viewerId: string,
  entry: CvEntry
): Promise<boolean> {
  if (await callerIsAdmin(supabase, viewerId)) return true;
  if (entry.added_by_role === "self") return viewerId === entry.user_id;
  return isLeadershipTeam(supabase, viewerId);
}

/** May the viewer edit targetUserId's essence statement? Self or admin only. */
export async function canEditEssenceStatement(
  supabase: Client,
  viewerId: string,
  targetUserId: string
): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  return callerIsAdmin(supabase, viewerId);
}

/**
 * May the viewer write targetUserId's job description? A ministry leader of
 * one of the target's ministries, or admin — deliberately NOT the target
 * themselves (their leader writes it, not them) and NOT a blanket
 * Leadership Team grant (unlike CV entries, this is specifically "your own
 * ministry leader's" call, not the whole team's).
 */
export async function canEditJobDescription(
  supabase: Client,
  viewerId: string,
  targetUserId: string
): Promise<boolean> {
  if (await callerIsAdmin(supabase, viewerId)) return true;
  return viewerLeadsTargetsMinistry(supabase, viewerId, targetUserId);
}
