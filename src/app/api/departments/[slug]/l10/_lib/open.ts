// Opens a department (the department routes' session, active-account and
// detail gates) and then one of its L10 teams for the caller. Kept under
// app/api because departments/internal is only for departments, services
// and the API (lib/departments/index.test.ts).

import "server-only";

import type { NextResponse } from "next/server";
import { isOpened, openDepartment, type OpenedDepartment } from "@/lib/departments/internal/open";
import { notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { rpcFlag } from "@/lib/departments/rpc";
import { isUuid } from "@/lib/departments/validate";
import { l10Access, type L10Access } from "@/lib/l10/access";
import { L10_COLUMNS, L10_TABLES, type L10TeamRole, type L10TeamRow } from "@/lib/l10/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type L10TeamContext = {
  supabase: Client;
  userId: string;
  department: OpenedDepartment["department"];
  team: L10TeamRow;
  role: L10TeamRole | null;
  access: L10Access;
};

export async function openL10Department(slug: string): Promise<{ response: NextResponse } | OpenedDepartment> {
  return openDepartment(slug, "any");
}

export { isOpened };

export async function openL10Team(slug: string, teamId: string): Promise<{ response: NextResponse } | L10TeamContext> {
  const opened = await openDepartment(slug, "any");
  if (!isOpened(opened)) return opened;
  if (!isUuid(teamId)) return { response: notFound("Team not found") };

  // RLS (l10_can_access_team) hides a team from anyone who is not on it or overseeing it.
  const team = await opened.supabase
    .from(L10_TABLES.teams)
    .select(L10_COLUMNS.teams)
    .eq("id", teamId)
    .eq("department_id", opened.department.id)
    .maybeSingle();
  if (team.error) return { response: serverError(team.error) };
  if (!team.data || team.data.is_active === false) return { response: notFound("Team not found") };

  const [canAccess, canManage, member] = await Promise.all([
    rpcFlag(opened.supabase, "l10_can_access_team", { p_team_id: teamId }),
    rpcFlag(opened.supabase, "l10_can_manage_team", { p_team_id: teamId }),
    opened.supabase.from(L10_TABLES.members).select("role").eq("team_id", teamId).eq("profile_id", opened.userId).maybeSingle(),
  ]);
  if (!canAccess.ok || !canManage.ok) return { response: notAuthorized() };
  if (!canAccess.value) return { response: notFound("Team not found") };
  if (member.error) return { response: serverError(member.error) };

  return {
    supabase: opened.supabase,
    userId: opened.userId,
    department: opened.department,
    team: team.data as L10TeamRow,
    role: (member.data?.role ?? null) as L10TeamRole | null,
    access: l10Access(canAccess.value, canManage.value),
  };
}

export function isTeamContext(result: { response: NextResponse } | L10TeamContext): result is L10TeamContext {
  return !("response" in result);
}
