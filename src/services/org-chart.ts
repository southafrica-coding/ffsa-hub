// Org chart — reads every table the chart draws (frames 40a / 41a) and hands
// the rows to lib/org-chart/model.ts. Nothing here is chart data of its own:
// teams are staff ministries, people are their rosters, lines are reporting
// lines and shared people, objectives are the current OKR cycle (doc 18,
// migration 250). The 099 drawing (org_nodes / org_edges) is no longer read.
//
// Call with the SERVICE-ROLE client, after the page has checked access:
// staff_ministry_members' RLS only shows a roster to its own leaders, and the
// chart's whole point is that anyone with access sees every team.

import {
  buildOrgModel,
  updateMonthStart,
  type OrgModel,
  type RawKr,
  type RawMember,
} from "@/lib/org-chart/model";
import { personName } from "@/services/org-import";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const PAGE = 1000;

/** PostgREST stops at 1000 rows without saying so; read every page. */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export type OrgChartData = { model: OrgModel; layout: Record<string, { x: number; y: number }> };

export async function loadOrgChart(admin: Client, now = new Date()): Promise<OrgChartData> {
  const { data: cycle } = await admin
    .from("okr_cycles")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  const [teams, memberRows, lines, objectives, shepherds, layout, programs, enrollments] = await Promise.all([
    readAll((a, b) =>
      admin
        .from("staff_ministries")
        .select("id, name, slug, cluster, parent_id, purpose, description, ministry_type, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name")
        .range(a, b)
    ),
    readAll((a, b) =>
      admin
        .from("staff_ministry_members")
        .select(
          "staff_ministry_id, user_id, member_role, is_point_leader, role_title, responsibilities, staff_ministry_member_subcategories(staff_ministry_subcategories(name))"
        )
        .eq("status", "active")
        .range(a, b)
    ),
    readAll((a, b) =>
      admin
        .from("reporting_lines")
        .select("staff_ministry_id, leader_user_id, kind, label")
        .is("ends_on", null)
        .range(a, b)
    ),
    cycle
      ? readAll((a, b) =>
          admin
            .from("okr_objectives")
            .select(
              "id, staff_ministry_id, title, description, direction, position, okr_key_results(id, description, position, current_status, current_value, metric_start, metric_target, metric_unit, owner_user_id, owner_note, last_checkin_at)"
            )
            .eq("cycle_id", cycle.id)
            .eq("scope", "ministry")
            .eq("is_archived", false)
            .not("staff_ministry_id", "is", null)
            .range(a, b)
        )
      : Promise.resolve([]),
    cycle
      ? readAll((a, b) => admin.from("okr_shepherds").select("staff_ministry_id, user_id").eq("cycle_id", cycle.id).range(a, b))
      : Promise.resolve([]),
    readAll((a, b) => admin.from("org_layout").select("staff_ministry_id, x, y").range(a, b)),
    readAll((a, b) => admin.from("programs").select("id, name").eq("status", "active").range(a, b)),
    readAll((a, b) =>
      admin.from("enrollments").select("program_id").eq("status", "active").is("removed_at", null).range(a, b)
    ),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: RawMember[] = (memberRows as any[]).map((m) => ({
    staff_ministry_id: m.staff_ministry_id,
    user_id: m.user_id,
    member_role: m.member_role,
    is_point_leader: m.is_point_leader,
    role_title: m.role_title,
    responsibilities: m.responsibilities,
    subcategories: (m.staff_ministry_member_subcategories ?? [])
      .map((j: { staff_ministry_subcategories: { name: string } | null }) => j.staff_ministry_subcategories?.name)
      .filter(Boolean),
  }));

  // Everyone the chart names: roster people, leaders, KR owners, shepherds.
  const ids = new Set<string>();
  members.forEach((m) => ids.add(m.user_id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (lines as any[]).forEach((l) => ids.add(l.leader_user_id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (shepherds as any[]).forEach((s) => ids.add(s.user_id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (objectives as any[]).forEach((o) => (o.okr_key_results ?? []).forEach((kr: RawKr) => kr.owner_user_id && ids.add(kr.owner_user_id)));

  const people: { id: string; name: string; job_title: string | null }[] = [];
  const idList = [...ids];
  for (let i = 0; i < idList.length; i += 200) {
    const { data, error } = await admin
      .from("users")
      .select("id, first_name, last_name, preferred_name, display_name, email, job_title")
      .in("id", idList.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const u of data ?? []) people.push({ id: u.id, name: personName(u), job_title: u.job_title });
  }

  const studentsBy = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (enrollments as any[]).forEach((e) => studentsBy.set(e.program_id, (studentsBy.get(e.program_id) ?? 0) + 1));

  const model = buildOrgModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    teams: teams as any,
    members,
    people,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: lines as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    objectives: (objectives as any[]).map((o) => ({ ...o, krs: o.okr_key_results ?? [] })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shepherds: shepherds as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schools: (programs as any[])
      .map((p) => ({ id: p.id, name: p.name, students: studentsBy.get(p.id) ?? 0 }))
      .filter((p) => p.students > 0)
      .sort((a, b) => b.students - a.students),
    cycleName: cycle?.name ?? null,
    updateMonthStart: updateMonthStart(now),
  });

  return {
    model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layout: Object.fromEntries((layout as any[]).map((l) => [l.staff_ministry_id, { x: Number(l.x), y: Number(l.y) }])),
  };
}
