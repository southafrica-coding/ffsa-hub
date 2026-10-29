export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditGroups, canManageGroupTeams } from "@/lib/finance/outreach-access";
import { loadOutreachViewer } from "@/lib/finance/outreach-viewer";
import {
  getOutreachGroupManagers,
  getOutreachGroupTeamDirectory,
  getOutreachGroups,
} from "@/services/outreach-groups";
import { GroupsClient, type GroupRow, type DirectoryTeam, type PersonOption } from "./groups-client";

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

function displayName(u: UserRow): string {
  const name = [u.preferred_name || u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.email || "Unnamed";
}

/**
 * Outreach groups (migration 273). Administrators create groups, pick their
 * teams and assign managers; managers add and remove teams in the groups
 * they manage. Everything shown is read with the viewer's own RLS-bound
 * client, except people's names and emails, which come from the service
 * role and are cut down to just that before they reach the browser.
 */
export default async function OutreachGroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const viewer = await loadOutreachViewer(supabase, user.id);
  const isEditor = canEditGroups(viewer);

  if (!viewer.staffViewer && viewer.managedGroupIds.length === 0) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-[color:var(--text-secondary)] md:px-8">
          Outreach groups are run by admins, finance staff and group managers.
        </p>
      </div>
    );
  }

  const [{ data: groups }, { data: managerLinks }, { data: directory }] = await Promise.all([
    getOutreachGroups(supabase),
    getOutreachGroupManagers(supabase),
    getOutreachGroupTeamDirectory(supabase),
  ]);

  // A manager who also leads a team can read that team's groups; this
  // screen only lists the ones they manage.
  const visibleGroups = ((groups ?? []) as { id: string; name: string; category: string | null; description: string | null }[])
    .filter((g) => viewer.staffViewer || viewer.managedGroupIds.includes(g.id));

  const links = (managerLinks ?? []) as { group_id: string; user_id: string }[];

  // Names for managers, and (administrators only) everyone they could assign.
  const admin = createAdminClient();
  const managerIds = [...new Set(links.map((l) => l.user_id))];
  const [{ data: managerUsers }, { data: peopleRows }] = await Promise.all([
    managerIds.length
      ? admin
          .from("users")
          .select("id, first_name, last_name, preferred_name, email")
          .in("id", managerIds)
      : Promise.resolve({ data: [] }),
    isEditor
      ? admin
          .from("users")
          .select("id, first_name, last_name, preferred_name, email")
          .eq("is_active", true)
          .order("last_name", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map(((managerUsers ?? []) as UserRow[]).map((u) => [u.id, displayName(u)]));
  const emailOf = new Map(((managerUsers ?? []) as UserRow[]).map((u) => [u.id, u.email]));

  const rows: GroupRow[] = visibleGroups.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category,
    description: g.description,
    teamIds: viewer.groupTeams[g.id] ?? [],
    managers: links
      .filter((l) => l.group_id === g.id)
      .map((l) => ({
        user_id: l.user_id,
        name: nameOf.get(l.user_id) ?? "Unknown",
        email: emailOf.get(l.user_id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    canManageTeams: canManageGroupTeams(viewer, g.id),
  }));

  const people: PersonOption[] = ((peopleRows ?? []) as UserRow[]).map((u) => ({
    id: u.id,
    name: displayName(u),
    email: u.email,
  }));

  return (
    <GroupsClient
      groups={rows}
      directory={(directory ?? []) as DirectoryTeam[]}
      people={people}
      canEditGroups={isEditor}
    />
  );
}
