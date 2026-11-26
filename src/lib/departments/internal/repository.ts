import "server-only";

// Data access for department homes. Table and column names are the ones in
// src/lib/departments/db.types.ts (migrations 317–320 at 6a9a3b92):
//   rocks, department_budget_links, service_owners.
// rocks.notes and department_budget_links.year are not selected. year
// defaults in the database and is not a filter. created_at is selected.

import type { DepartmentBudgetLink, Rock as RockRow, StaffMinistryAlias } from "../db.types";
import { personName } from "../names";
import { currentQuarter } from "../quarter";
import type { BudgetPatch, BudgetWrite, RockPatch, RockWrite } from "../validate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type DbError = { message: string; code?: string };
export type DbResult<T> = { data: T; error: DbError | null };

const DEPARTMENT_COLUMNS =
  "id, name, slug, description, purpose, is_active, ministry_type, sort_order, cluster, parent_id";
const PERSON_COLUMNS =
  "id, first_name, last_name, preferred_name, display_name, email, job_title";
const ROCK_COLUMNS =
  "id, staff_ministry_id, quarter, title, description, owner_user_id, status, due_on, created_by, created_at, updated_at";
const BUDGET_COLUMNS =
  "id, staff_ministry_id, finance_project_id, budget_cents, spend_cents, currency, notes, updated_at, updated_by, created_at";

export type DepartmentRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  purpose: string | null;
  is_active: boolean;
  ministry_type: string | null;
  sort_order: number;
  cluster: string | null;
  parent_id: string | null;
};

export type PersonRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  display_name: string | null;
  email: string | null;
  job_title: string | null;
};

export type MembershipRecord = {
  id: string;
  staff_ministry_id: string;
  user_id: string;
  member_role: string;
  is_point_leader: boolean;
  status: string;
};

export type ActiveMembership = {
  staff_ministry_id: string;
  member_role: "member" | "leader";
  is_point_leader: boolean;
};

export type MinistryAlias = Pick<StaffMinistryAlias, "staff_ministry_id" | "resolves_to_id">;

export type RoleGrant = {
  scope_type?: string | null;
  scope_id?: string | null;
  roles?: { name?: string } | { name?: string }[] | null;
};

export function dbError(error: unknown): DbError | null {
  if (!error || typeof error !== "object") return null;
  const row = error as { message?: unknown; code?: unknown };
  return {
    message: typeof row.message === "string" ? row.message : "Request failed",
    code: typeof row.code === "string" ? row.code : undefined,
  };
}

function failed<T>(error: unknown): DbResult<T> {
  return { data: null as T, error: dbError(error) ?? { message: "Request failed" } };
}

export function relationMissing(error: DbError | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

export async function getDepartmentBySlug(supabase: Client, slug: string): Promise<DbResult<DepartmentRecord | null>> {
  const { data, error } = await supabase
    .from("staff_ministries")
    .select(DEPARTMENT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return failed(error);
  return { data: (data as DepartmentRecord | null) ?? null, error: null };
}

export async function getDepartmentById(supabase: Client, id: string): Promise<DbResult<DepartmentRecord | null>> {
  const { data, error } = await supabase
    .from("staff_ministries")
    .select(DEPARTMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return failed(error);
  return { data: (data as DepartmentRecord | null) ?? null, error: null };
}

export async function listMinistriesBySlug(
  supabase: Client,
  slugs: readonly string[]
): Promise<DbResult<Array<{ id: string; slug: string; name: string }>>> {
  if (slugs.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("staff_ministries").select("id, slug, name").in("slug", [...slugs]);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function listMinistriesById(
  supabase: Client,
  ids: readonly string[]
): Promise<DbResult<Array<{ id: string; slug: string; name: string }>>> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("staff_ministries").select("id, slug, name").in("id", [...ids]);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function listAliases(supabase: Client): Promise<DbResult<MinistryAlias[]>> {
  const { data, error } = await supabase.from("staff_ministry_aliases").select("staff_ministry_id, resolves_to_id");
  if (error) {
    if (relationMissing(dbError(error))) return { data: [], error: null };
    return failed(error);
  }
  const rows = (Array.isArray(data) ? data : []) as MinistryAlias[];
  return {
    data: rows.filter((row) => typeof row.staff_ministry_id === "string" && typeof row.resolves_to_id === "string"),
    error: null,
  };
}

export async function listDepartmentRows(supabase: Client): Promise<DbResult<DepartmentRecord[]>> {
  const { data, error } = await supabase.from("staff_ministries").select(DEPARTMENT_COLUMNS);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as DepartmentRecord[]) : [], error: null };
}

export async function listUserRoleGrants(supabase: Client, userId: string): Promise<DbResult<RoleGrant[]>> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("scope_type, scope_id, roles(name)")
    .eq("user_id", userId);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as RoleGrant[]) : [], error: null };
}

export async function listActiveMemberships(supabase: Client, userId: string): Promise<DbResult<ActiveMembership[]>> {
  const { data, error } = await supabase
    .from("staff_ministry_members")
    .select("staff_ministry_id, member_role, is_point_leader, status")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) return failed(error);
  const rows = (Array.isArray(data) ? data : []) as Array<{
    staff_ministry_id?: unknown;
    member_role?: unknown;
    is_point_leader?: unknown;
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
      is_point_leader: row.is_point_leader === true,
    });
  }
  return { data: memberships, error: null };
}

export async function isActiveMinistryMember(
  supabase: Client,
  ministryId: string,
  userId: string
): Promise<DbResult<boolean>> {
  const { data, error } = await supabase
    .from("staff_ministry_members")
    .select("id")
    .eq("staff_ministry_id", ministryId)
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  if (error) return failed(error);
  return { data: Array.isArray(data) && data.length > 0, error: null };
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

export async function listActiveMembers(
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

export async function countActiveMembers(
  supabase: Client,
  ministryIds?: readonly string[]
): Promise<DbResult<Map<string, number>>> {
  if (ministryIds && ministryIds.length === 0) return { data: new Map(), error: null };
  let query = supabase.from("staff_ministry_members").select("staff_ministry_id").eq("status", "active");
  if (ministryIds) query = query.in("staff_ministry_id", [...ministryIds]);
  const { data, error } = await query;
  if (error) return failed(error);
  const counts = new Map<string, number>();
  for (const row of Array.isArray(data) ? data : []) {
    const id = (row as { staff_ministry_id?: string }).staff_ministry_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { data: counts, error: null };
}

export async function getFinanceProject(
  supabase: Client,
  id: string
): Promise<DbResult<{ id: string; name: string } | null>> {
  const { data, error } = await supabase.from("finance_projects").select("id, name").eq("id", id).maybeSingle();
  if (error) return failed(error);
  return { data: (data as { id: string; name: string } | null) ?? null, error: null };
}

export async function listRocks(
  supabase: Client,
  ministryId: string,
  quarter: string
): Promise<DbResult<RockRow[]>> {
  const { data, error } = await supabase
    .from("rocks")
    .select(ROCK_COLUMNS)
    .eq("staff_ministry_id", ministryId)
    .eq("quarter", quarter)
    // 416: rows with team_id are L10 team rocks, not department rocks.
    .is("team_id", null);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as RockRow[]) : [], error: null };
}

export async function listRocksForQuarter(supabase: Client, quarter: string): Promise<DbResult<RockRow[]>> {
  // 416: rows with team_id are L10 team rocks, not department rocks.
  const { data, error } = await supabase.from("rocks").select(ROCK_COLUMNS).eq("quarter", quarter).is("team_id", null);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as RockRow[]) : [], error: null };
}

export async function createRock(
  supabase: Client,
  ministryId: string,
  write: RockWrite,
  userId: string
): Promise<DbResult<RockRow | null>> {
  const { data, error } = await supabase
    .from("rocks")
    .insert({
      staff_ministry_id: ministryId,
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
  return { data: data as RockRow, error: null };
}

export async function updateRock(
  supabase: Client,
  ministryId: string,
  rockId: string,
  patch: RockPatch
): Promise<DbResult<RockRow | null>> {
  const { data, error } = await supabase
    .from("rocks")
    .update(patch)
    .eq("id", rockId)
    .eq("staff_ministry_id", ministryId)
    // 416: the department rock routes must not edit an L10 team rock.
    .is("team_id", null)
    .select(ROCK_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  return { data: (data as RockRow | null) ?? null, error: null };
}

export async function listBudgetLinks(
  supabase: Client,
  ministryId: string
): Promise<DbResult<DepartmentBudgetLink[]>> {
  const { data, error } = await supabase
    .from("department_budget_links")
    .select(BUDGET_COLUMNS)
    .eq("staff_ministry_id", ministryId);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as DepartmentBudgetLink[]) : [], error: null };
}

export async function createBudgetLink(
  supabase: Client,
  ministryId: string,
  write: BudgetWrite,
  userId: string
): Promise<DbResult<DepartmentBudgetLink | null>> {
  const { data, error } = await supabase
    .from("department_budget_links")
    .insert({
      staff_ministry_id: ministryId,
      finance_project_id: write.finance_project_id,
      budget_cents: write.budget_cents,
      currency: write.currency,
      notes: write.notes,
      updated_by: userId,
    })
    .select(BUDGET_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  if (!data) return { data: null, error: { message: "Budget link was not created" } };
  return { data: data as DepartmentBudgetLink, error: null };
}

export async function updateBudgetLink(
  supabase: Client,
  ministryId: string,
  linkId: string,
  patch: BudgetPatch,
  userId: string
): Promise<DbResult<DepartmentBudgetLink | null>> {
  const { data, error } = await supabase
    .from("department_budget_links")
    .update({ ...patch, updated_by: userId })
    .eq("id", linkId)
    .eq("staff_ministry_id", ministryId)
    .select(BUDGET_COLUMNS)
    .maybeSingle();
  if (error) return failed(error);
  return { data: (data as DepartmentBudgetLink | null) ?? null, error: null };
}

export async function listProjectsById(
  supabase: Client,
  ids: readonly string[]
): Promise<DbResult<Array<{ id: string; name: string }>>> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.from("finance_projects").select("id, name").in("id", [...ids]);
  if (error) return failed(error);
  return { data: Array.isArray(data) ? (data as Array<{ id: string; name: string }>) : [], error: null };
}

export type NamedRock = RockRow & { owner_name: string | null };

export async function withOwnerNames(supabase: Client, rows: RockRow[]): Promise<DbResult<NamedRock[]>> {
  const people = await loadPeople(
    supabase,
    rows.flatMap((row) => (row.owner_user_id ? [row.owner_user_id] : []))
  );
  if (people.error) return failed(people.error);
  const byId = peopleById(people.data);
  return {
    data: rows.map((row) => ({
      ...row,
      owner_name: row.owner_user_id ? personName(byId.get(row.owner_user_id)) : null,
    })),
    error: null,
  };
}

export async function loadPeopleById(supabase: Client, ids: readonly string[]): Promise<DbResult<Map<string, PersonRecord>>> {
  const people = await loadPeople(supabase, ids);
  if (people.error) return failed(people.error);
  return { data: peopleById(people.data), error: null };
}

export { currentQuarter };
export type { DepartmentBudgetLink, RockRow };
