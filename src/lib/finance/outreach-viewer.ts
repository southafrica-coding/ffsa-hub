/**
 * Read the signed-in person's outreach standing — staff flags, team roles,
 * managed groups and group contents — with their own RLS-bound client, and
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function loadOutreachViewer(supabase: Client, userId: string): Promise<OutreachViewer> {
  const [viewerRes, editorRes, membershipRes, managedRes, linksRes] = await Promise.all([
    isOutreachStaffViewerRpc(supabase),
    isOutreachStaffEditorRpc(supabase),
    supabase.from("outreach_team_members").select("team_id, role").eq("user_id", userId),
    getMyManagedOutreachGroupIds(supabase, userId),
    getOutreachGroupTeamLinks(supabase),
  ]);

  // A failed read (e.g. migration 273 not applied yet) grants nothing extra.
  return buildOutreachViewer({
    staffViewer: !viewerRes.error && viewerRes.data === true,
    staffEditor: !editorRes.error && editorRes.data === true,
    memberships: membershipRes.error ? [] : membershipRes.data ?? [],
    managedGroupIds: managedRes.error
      ? []
      : ((managedRes.data ?? []) as { group_id: string }[]).map((r) => r.group_id),
    groupTeamLinks: linksRes.error ? [] : linksRes.data ?? [],
  });
}
