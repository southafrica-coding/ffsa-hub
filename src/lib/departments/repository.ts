// Every department read and write. Routes stay free of table names.
//
// TODO(hub-data): rocks and department_budget_links are assumed — see
// src/lib/departments/types.ts. The confirmed tables (staff ministries,
// memberships, reporting lines, OKRs, finance projects) use the columns
// that exist on main.

import { personName } from "./names";
import { currentQuarter } from "./quarter";
import type { BudgetPatch, RockPatch, RockWrite } from "./validate";
import {
  BUDGET_LINKS_TABLE,
  ROCKS_TABLE,
  type BudgetLinkRow,
  type BudgetLinkView,
  type DbError,
  type DbResult,
  type DepartmentOkrs,
  type DepartmentOverview,
  type DepartmentPeople,
  type DepartmentRecord,
  type DepartmentRef,
  type FinanceOrgRecord,
  type FinanceProjectRecord,
  type KeyResultView,
  type LeadershipRocks,
  type MembershipRecord,
  type ObjectiveView,
  type OkrCycleRecord,
  type OkrKeyResultRecord,
  type OkrObjectiveRecord,
  type PersonRecord,
  type ReportingLineRecord,
  type RockRow,
  type RockView,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const DEPARTMENT_COLUMNS =
  "id, name, slug, description, is_active, ministry_type, sort_order";
const PERSON_COLUMNS =
  "id, first_name, last_name, preferred_name, display_name, email, job_title";
const ROCK_COLUMNS =
  "id, staff_ministry_id, quarter, title, description, owner_user_id, status, due_on, created_by, created_at, updated_at";
const BUDGET_COLUMNS =
  "id, staff_ministry_id, finance_project_id, budget_cents, spend_cents, currency, notes, updated_at, updated_by";

export function dbError(error: unknown): DbError | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return { message: typeof message === "string" ? message : "Request failed" };
}

function failed<T>(error: unknown): DbResult<T> {
  return { data: null as T, error: dbError(error) ?? { message: "Request failed" } };
}

export async function getDepartmentBySlug(
  supabase: Client,
  slug: string
): Promise<DbResult<DepartmentRecord | null>> {
  const { data, error } = await supabase
    .from("staff_ministries")
    .select(DEPARTMENT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return failed(error);
  return { data: (data as DepartmentRecord | null) ?? null, error: null };
}

export async function listMinistriesBySlug(
  supabase: Client,
  slugs: readonly string[]
): Promise<DbResult<Array<{ id: string; slug: string; name: string }>>> {
  if (slugs.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("staff_ministries")
    .select("id, slug, name")
    .in("slug", [...slugs]);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function listMinistriesById(
  supabase: Client,
  ids: readonly string[]
): Promise<DbResult<Array<{ id: string; slug: string; name: string }>>> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("staff_ministries")
    .select("id, slug, name")
    .in("id", [...ids]);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? data : [], error: null };
}

export type RoleGrant = {
  scope_type?: string | null;
  scope_id?: string | null;
  roles?: { name?: string } | { name?: string }[] | null;
};

/** Every role grant for this user. The caller applies the scope rule. */
export async function listUserRoleGrants(
  supabase: Client,
  userId: string
): Promise<DbResult<RoleGrant[]>> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("scope_type, scope_id, roles(name)")
    .eq("user_id", userId);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as RoleGrant[]) : [], error: null };
}

export type ActiveMembership = {
  staff_ministry_id: string;
  member_role: "member" | "leader";
};

/**
 * Active memberships only. A missing status is kept (the query already
 * asked for active). Anything else is dropped, so a pending row cannot
 * grant access if the filter is ever forgotten.
 */
export async function listActiveMemberships(
  supabase: Client,
  userId: string
): Promise<DbResult<ActiveMembership[]>> {
  const { data, error } = await supabase
    .from("staff_ministry_members")
    .select("staff_ministry_id, member_role, status")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) return failed(error);
  const rows = (Array.isArray(data) ? data : []) as Array<{
    staff_ministry_id?: unknown;
    member_role?: unknown;
    status?: unknown;
  }>;
  const memberships: ActiveMembership[] = [];
  for (const row of rows) {
    if (typeof row.staff_ministry_id !== "string") continue;
    if (row.status != null && row.status !== "active") continue;
    if (row.member_role !== "member" && row.member_role !== "leader") continue;
    memberships.push({
      staff_ministry_id: row.staff_ministry_id,
      member_role: row.member_role,
    });
  }
  return { data: memberships, error: null };
}

function refOf(department: DepartmentRecord): DepartmentRef {
  return { id: department.id, slug: department.slug, name: department.name };
}

async function loadPeople(supabase: Client, ids: readonly string[]): Promise<DbResult<PersonRecord[]>> {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("users").select(PERSON_COLUMNS).in("id", unique);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as PersonRecord[]) : [], error: null };
}

function peopleById(people: PersonRecord[]): Map<string, PersonRecord> {
  return new Map(people.map((person) => [person.id, person]));
}

async function listActiveMembers(
  supabase: Client,
  ministryId: string
): Promise<DbResult<MembershipRecord[]>> {
  const { data, error } = await supabase
    .from("staff_ministry_members")
    .select("id, staff_ministry_id, user_id, member_role, is_point_leader, status")
    .eq("staff_ministry_id", ministryId)
    .eq("status", "active");
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as MembershipRecord[]) : [], error: null };
}

export async function getDepartmentOverview(
  supabase: Client,
  department: DepartmentRecord,
  quarter = currentQuarter()
): Promise<DbResult<DepartmentOverview>> {
  const [members, rocks, cycle] = await Promise.all([
    listActiveMembers(supabase, department.id),
    supabase
      .from(ROCKS_TABLE)
      .select("id")
      .eq("staff_ministry_id", department.id)
      .eq("quarter", quarter),
    supabase
      .from("okr_cycles")
      .select("id, name, slug, starts_on, ends_on, is_current")
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (members.error) return failed(members.error);
  const rocksError = dbError(rocks.error);
  if (rocksError) return failed(rocksError);
  const cycleError = dbError(cycle.error);
  if (cycleError) return failed(cycleError);

  const cycleRow = (cycle.data as OkrCycleRecord | null) ?? null;
  let objectiveCount = 0;
  if (cycleRow) {
    const objectives = await supabase
      .from("okr_objectives")
      .select("id")
      .eq("cycle_id", cycleRow.id)
      .eq("staff_ministry_id", department.id)
      .eq("scope", "ministry")
      .eq("is_archived", false);
    const objectivesError = dbError(objectives.error);
    if (objectivesError) return failed(objectivesError);
    objectiveCount = Array.isArray(objectives.data) ? objectives.data.length : 0;
  }

  const leaders = members.data.filter((member) => member.member_role === "leader");
  const people = await loadPeople(
    supabase,
    leaders.map((leader) => leader.user_id)
  );
  if (people.error) return failed(people.error);
  const byId = peopleById(people.data);

  return {
    data: {
      department: {
        ...refOf(department),
        purpose: department.description,
        is_active: department.is_active,
      },
      leaders: leaders
        .map((leader) => {
          const person = byId.get(leader.user_id);
          return {
            user_id: leader.user_id,
            name: personName(person),
            email: person?.email ?? null,
            job_title: person?.job_title ?? null,
            is_point_leader: leader.is_point_leader === true,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      counts: {
        people: members.data.length,
        leaders: leaders.length,
        rocks: Array.isArray(rocks.data) ? rocks.data.length : 0,
        objectives: objectiveCount,
      },
      quarter,
      cycle: cycleRow
        ? {
            id: cycleRow.id,
            name: cycleRow.name,
            slug: cycleRow.slug,
            starts_on: cycleRow.starts_on,
            ends_on: cycleRow.ends_on,
          }
        : null,
    },
    error: null,
  };
}

export async function getDepartmentPeople(
  supabase: Client,
  department: DepartmentRecord
): Promise<DbResult<DepartmentPeople>> {
  const [roster, lines] = await Promise.all([
    supabase
      .from("staff_ministry_members")
      .select("id, staff_ministry_id, user_id, member_role, is_point_leader, status")
      .eq("staff_ministry_id", department.id),
    supabase
      .from("reporting_lines")
      .select("id, staff_ministry_id, leader_user_id, kind, label, starts_on, ends_on")
      .eq("staff_ministry_id", department.id)
      .is("ends_on", null),
  ]);
  const rosterError = dbError(roster.error);
  if (rosterError) return failed(rosterError);
  const linesError = dbError(lines.error);
  if (linesError) return failed(linesError);

  const members = (Array.isArray(roster.data) ? roster.data : []) as MembershipRecord[];
  const openLines = (Array.isArray(lines.data) ? lines.data : []) as ReportingLineRecord[];
  const people = await loadPeople(supabase, [
    ...members.map((member) => member.user_id),
    ...openLines.map((line) => line.leader_user_id),
  ]);
  if (people.error) return failed(people.error);
  const byId = peopleById(people.data);

  const entries = members
    .map((member) => {
      const person = byId.get(member.user_id);
      return {
        membership_id: member.id,
        user_id: member.user_id,
        name: personName(person),
        email: person?.email ?? null,
        job_title: person?.job_title ?? null,
        member_role: member.member_role,
        is_point_leader: member.is_point_leader === true,
        status: member.status,
      };
    })
    .sort((a, b) => {
      if (a.member_role !== b.member_role) return a.member_role === "leader" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    data: {
      department: refOf(department),
      roster: entries,
      reporting_lines: openLines
        .map((line) => ({
          id: line.id,
          leader_user_id: line.leader_user_id,
          leader_name: personName(byId.get(line.leader_user_id)),
          kind: line.kind,
          label: line.label,
          starts_on: line.starts_on,
          ends_on: line.ends_on,
        }))
        .sort((a, b) => a.leader_name.localeCompare(b.leader_name)),
    },
    error: null,
  };
}

export async function getDepartmentOkrs(
  supabase: Client,
  department: DepartmentRecord
): Promise<DbResult<DepartmentOkrs>> {
  const cycle = await supabase
    .from("okr_cycles")
    .select("id, name, slug, starts_on, ends_on, is_current")
    .eq("is_current", true)
    .maybeSingle();
  const cycleError = dbError(cycle.error);
  if (cycleError) return failed(cycleError);
  const cycleRow = (cycle.data as OkrCycleRecord | null) ?? null;
  if (!cycleRow) {
    return { data: { department: refOf(department), cycle: null, objectives: [] }, error: null };
  }

  const objectives = await supabase
    .from("okr_objectives")
    .select("id, cycle_id, scope, staff_ministry_id, title, description, position, timeline, owner_note, is_archived")
    .eq("cycle_id", cycleRow.id)
    .eq("staff_ministry_id", department.id)
    .eq("scope", "ministry")
    .eq("is_archived", false);
  const objectivesError = dbError(objectives.error);
  if (objectivesError) return failed(objectivesError);
  const objectiveRows = (Array.isArray(objectives.data) ? objectives.data : []) as OkrObjectiveRecord[];
  objectiveRows.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));

  let keyResults: OkrKeyResultRecord[] = [];
  if (objectiveRows.length > 0) {
    const results = await supabase
      .from("okr_key_results")
      .select(
        "id, objective_id, position, label, description, current_status, current_value, metric_unit, metric_start, metric_target"
      )
      .in(
        "objective_id",
        objectiveRows.map((objective) => objective.id)
      );
    const resultsError = dbError(results.error);
    if (resultsError) return failed(resultsError);
    keyResults = (Array.isArray(results.data) ? results.data : []) as OkrKeyResultRecord[];
  }

  const views: ObjectiveView[] = objectiveRows.map((objective) => ({
    id: objective.id,
    title: objective.title,
    description: objective.description,
    position: objective.position,
    timeline: objective.timeline,
    owner_note: objective.owner_note,
    key_results: keyResults
      .filter((result) => result.objective_id === objective.id)
      .sort((a, b) => a.position - b.position)
      .map(
        (result): KeyResultView => ({
          id: result.id,
          position: result.position,
          label: result.label,
          description: result.description,
          current_status: result.current_status,
          current_value: result.current_value,
          metric_unit: result.metric_unit,
          metric_start: result.metric_start,
          metric_target: result.metric_target,
        })
      ),
  }));

  return { data: { department: refOf(department), cycle: cycleRow, objectives: views }, error: null };
}

function rockView(row: RockRow, people: Map<string, PersonRecord>): RockView {
  return {
    id: row.id,
    staff_ministry_id: row.staff_ministry_id,
    quarter: row.quarter,
    title: row.title,
    description: row.description,
    status: row.status,
    due_on: row.due_on,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_user_id ? personName(people.get(row.owner_user_id)) : null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function withOwners(supabase: Client, rows: RockRow[]): Promise<DbResult<RockView[]>> {
  const people = await loadPeople(
    supabase,
    rows.flatMap((row) => (row.owner_user_id ? [row.owner_user_id] : []))
  );
  if (people.error) return failed(people.error);
  const byId = peopleById(people.data);
  return {
    data: rows
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((row) => rockView(row, byId)),
    error: null,
  };
}

export async function listDepartmentRocks(
  supabase: Client,
  department: DepartmentRecord,
  quarter: string
): Promise<DbResult<RockView[]>> {
  const { data, error } = await supabase
    .from(ROCKS_TABLE)
    .select(ROCK_COLUMNS)
    .eq("staff_ministry_id", department.id)
    .eq("quarter", quarter);
  if (error) return failed(error);
  return withOwners(supabase, (Array.isArray(data) ? data : []) as RockRow[]);
}

export async function createDepartmentRock(
  supabase: Client,
  department: DepartmentRecord,
  write: RockWrite,
  userId: string
): Promise<DbResult<RockView | null>> {
  const { data, error } = await supabase
    .from(ROCKS_TABLE)
    .insert({
      staff_ministry_id: department.id,
      quarter: write.quarter,
      title: write.title,
      description: write.description,
      owner_user_id: write.owner_user_id,
      status: write.status,
      due_on: write.due_on,
      created_by: userId,
    })
    .select(ROCK_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { data: null, error: { message: "Rock was not created" } };
  const views = await withOwners(supabase, [data as RockRow]);
  if (views.error) return failed(views.error);
  return { data: views.data[0] ?? null, error: null };
}

export async function updateDepartmentRock(
  supabase: Client,
  ministryId: string,
  rockId: string,
  patch: RockPatch
): Promise<DbResult<RockView | null>> {
  const { data, error } = await supabase
    .from(ROCKS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", rockId)
    .eq("staff_ministry_id", ministryId)
    .select(ROCK_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { data: null, error: null };
  const views = await withOwners(supabase, [data as RockRow]);
  if (views.error) return failed(views.error);
  return { data: views.data[0] ?? null, error: null };
}

export async function listLeadershipRocks(
  supabase: Client,
  quarter: string
): Promise<DbResult<LeadershipRocks>> {
  const [ministries, rocks] = await Promise.all([
    supabase.from("staff_ministries").select(DEPARTMENT_COLUMNS).eq("is_active", true),
    supabase.from(ROCKS_TABLE).select(ROCK_COLUMNS).eq("quarter", quarter),
  ]);
  const ministriesError = dbError(ministries.error);
  if (ministriesError) return failed(ministriesError);
  const rocksError = dbError(rocks.error);
  if (rocksError) return failed(rocksError);

  const departments = ((Array.isArray(ministries.data) ? ministries.data : []) as DepartmentRecord[]).slice();
  departments.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const rockRows = (Array.isArray(rocks.data) ? rocks.data : []) as RockRow[];
  const views = await withOwners(supabase, rockRows);
  if (views.error) return failed(views.error);

  return {
    data: {
      quarter,
      departments: departments.map((department) => ({
        ...refOf(department),
        rocks: views.data.filter((rock) => rock.staff_ministry_id === department.id),
      })),
    },
    error: null,
  };
}

async function projectsById(
  supabase: Client,
  ids: readonly string[]
): Promise<DbResult<{ projects: FinanceProjectRecord[]; orgs: FinanceOrgRecord[] }>> {
  if (ids.length === 0) return { data: { projects: [], orgs: [] }, error: null };
  const projects = await supabase
    .from("finance_projects")
    .select("id, name, org_id, project_type, is_active")
    .in("id", [...ids]);
  const projectsError = dbError(projects.error);
  if (projectsError) return failed(projectsError);
  const projectRows = (Array.isArray(projects.data) ? projects.data : []) as FinanceProjectRecord[];
  const orgIds = [...new Set(projectRows.map((project) => project.org_id))];
  if (orgIds.length === 0) return { data: { projects: projectRows, orgs: [] }, error: null };
  const orgs = await supabase.from("finance_orgs").select("id, key, name").in("id", orgIds);
  const orgsError = dbError(orgs.error);
  if (orgsError) return failed(orgsError);
  return {
    data: {
      projects: projectRows,
      orgs: (Array.isArray(orgs.data) ? orgs.data : []) as FinanceOrgRecord[],
    },
    error: null,
  };
}

function budgetViews(
  links: BudgetLinkRow[],
  projects: FinanceProjectRecord[],
  orgs: FinanceOrgRecord[]
): BudgetLinkView[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const orgById = new Map(orgs.map((org) => [org.id, org]));
  return links.map((link) => {
    const project = projectById.get(link.finance_project_id) ?? null;
    const org = project ? orgById.get(project.org_id) : undefined;
    return {
      id: link.id,
      budget_cents: link.budget_cents,
      spend_cents: link.spend_cents,
      currency: link.currency || "ZAR",
      notes: link.notes,
      project: project
        ? {
            id: project.id,
            name: project.name,
            org_id: project.org_id,
            org_key: org?.key ?? null,
            org_name: org?.name ?? null,
            project_type: project.project_type,
            is_active: project.is_active,
          }
        : null,
    };
  });
}

export async function getDepartmentBudget(
  supabase: Client,
  department: DepartmentRecord
): Promise<DbResult<BudgetLinkView[]>> {
  const { data, error } = await supabase
    .from(BUDGET_LINKS_TABLE)
    .select(BUDGET_COLUMNS)
    .eq("staff_ministry_id", department.id);
  if (error) return failed(error);
  const links = (Array.isArray(data) ? data : []) as BudgetLinkRow[];
  const related = await projectsById(
    supabase,
    links.map((link) => link.finance_project_id)
  );
  if (related.error) return failed(related.error);
  return { data: budgetViews(links, related.data.projects, related.data.orgs), error: null };
}

export async function updateDepartmentBudget(
  supabase: Client,
  ministryId: string,
  linkId: string,
  patch: BudgetPatch,
  userId: string
): Promise<DbResult<BudgetLinkView | null>> {
  const { data, error } = await supabase
    .from(BUDGET_LINKS_TABLE)
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("staff_ministry_id", ministryId)
    .select(BUDGET_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { data: null, error: null };
  const link = data as BudgetLinkRow;
  const related = await projectsById(supabase, [link.finance_project_id]);
  if (related.error) return failed(related.error);
  return { data: budgetViews([link], related.data.projects, related.data.orgs)[0] ?? null, error: null };
}
