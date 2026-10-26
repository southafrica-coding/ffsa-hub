/**
 * Read the signed-in person's outreach standing — staff flags, team roles,
 * managed groups, group contents and their own "limited to own teams" flag
 * (migration 274) — with their own RLS-bound client, and
 * turn it into an OutreachViewer (see outreach-access.ts). Read fresh on
 * every request: nothing about group access is cached or copied.
 */

import { buildOutreachViewer, type OutreachViewer } from "@/lib/finance/outreach-access";
import {
  getMyManagedOutreachGroupIds,
  getOutreachGroupTeamLinks,
  isOutreachStaffEditorRpc,
  isOutreachStaffViewerRpc,
} from "@/services/outreach-groups";
import { getOutreachRestriction } from "@/services/outreach-restrictions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function loadOutreachViewer(supabase: Client, userId: string): Promise<OutreachViewer> {
  const [viewerRes, editorRes, membershipRes, managedRes, linksRes, restrictionRes] = await Promise.all([
    isOutreachStaffViewerRpc(supabase),
    isOutreachStaffEditorRpc(supabase),
    supabase.from("outreach_team_members").select("team_id, role").eq("user_id", userId),
    getMyManagedOutreachGroupIds(supabase, userId),
    getOutreachGroupTeamLinks(supabase),
    getOutreachRestriction(supabase, userId),
  ]);

  // Flagged "limited to own teams" (migration 274): staff access may only
  // come from an admin tier or the finance_admin role, so ask for those.
  const limitedToOwnTeams =
    !restrictionRes.error && restrictionRes.data?.limited_to_own_teams === true;
  let roleStaff = false;
  if (limitedToOwnTeams) {
    const [adminRes, financeAdminRes] = await Promise.all([
      supabase.rpc("is_admin"),
      supabase.rpc("has_role", { required_role: "finance_admin" }),
    ]);
    roleStaff =
      (!adminRes.error && adminRes.data === true) ||
      (!financeAdminRes.error && financeAdminRes.data === true);
  }

  // A failed read (e.g. migration 273 not applied yet) grants nothing extra.
  return buildOutreachViewer({
    limitedToOwnTeams,
    roleStaff,
    staffViewer: !viewerRes.error && viewerRes.data === true,
    staffEditor: !editorRes.error && editorRes.data === true,
    memberships: membershipRes.error ? [] : membershipRes.data ?? [],
    managedGroupIds: managedRes.error
      ? []
      : ((managedRes.data ?? []) as { group_id: string }[]).map((r) => r.group_id),
    groupTeamLinks: linksRes.error ? [] : linksRes.data ?? [],
  });
}
