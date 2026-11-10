// Assembles department payloads. Finance-only viewers get the header and
// the budget; people, OKRs, rocks, services and sub-ministries are not read.

import { foldedDetailIds, loadMinistryAccess, type DepartmentAccessFlags } from "./access";
import { FOLDED_DEPARTMENTS, isBlockedHomeSlug } from "./homes";
import { personName } from "./names";
import { addIsoDays, currentQuarter, saTodayIso } from "./quarter";
import {
  countActiveMembers,
  getDepartmentBySlug,
  listActiveMembers,
  listActiveMemberships,
  listAliases,
  listBudgetLinks,
  listDepartmentRows,
  listProjectsById,
  listRocks,
  listRocksForQuarter,
  loadPeopleById,
  type DepartmentRecord,
  type MembershipRecord,
  type PersonRecord,
} from "./repository";
import { budgetLinks } from "./shape";
import type {
  DepartmentAccess,
  DepartmentHome,
  DepartmentOkrs,
  DepartmentPerson,
  DepartmentSummary,
  OkrStatus,
  Rock,
  SubMinistry,
  ViewerMembership,
} from "./ui-contract";
import { okrStatus } from "./ui-contract";
import { isEvangelismModeratorSlug } from "@/lib/services/evangelism-moderators";
import { listServiceOwnerRows } from "@/lib/services/repository";
import type { ServiceOwnerRow } from "@/lib/services/seed";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const CLUSTERS = new Set(["leadership", "inward", "outward", "backbone", "alongside"]);

function clusterOf(value: string | null | undefined): DepartmentSummary["cluster"] {
  if (value && CLUSTERS.has(value)) return value as DepartmentSummary["cluster"];
  return null;
}

function purposeOf(row: DepartmentRecord): string | null {
  return row.purpose ?? row.description ?? null;
}

function personOf(member: MembershipRecord, people: Map<string, PersonRecord>, emails: boolean): DepartmentPerson {
  const person = people.get(member.user_id);
  return {
    name: personName(person),
    capacity: member.member_role === "leader" ? "leader" : "member",
    ...(person?.job_title ? { role: person.job_title } : {}),
    email: emails ? (person?.email ?? null) : null,
  };
}

export function viewerMemberships(
  memberships: readonly { staff_ministry_id: string; member_role: string | null; is_point_leader: boolean }[],
  ministries: readonly { id: string; slug: string }[]
): ViewerMembership[] {
  const slugOf = new Map(ministries.map((ministry) => [ministry.id, ministry.slug]));
  return memberships.flatMap((membership) => {
    const slug = slugOf.get(membership.staff_ministry_id);
    if (!slug) return [];
    return [{
      departmentSlug: slug,
      capacity: membership.member_role === "leader" ? "leader" as const : "member" as const,
      isPointLeader: membership.is_point_leader,
    }];
  });
}

function parentFields(
  row: DepartmentRecord,
  parents: Map<string, { slug: string; name: string }>
): { parentSlug: string | null; parentName: string | null } {
  const foldedChild = Object.prototype.hasOwnProperty.call(FOLDED_DEPARTMENTS, row.slug);
  if (foldedChild || !row.parent_id) return { parentSlug: null, parentName: null };
  const parent = parents.get(row.parent_id);
  return { parentSlug: parent?.slug ?? null, parentName: parent?.name ?? null };
}

async function summaryFor(
  row: DepartmentRecord,
  access: DepartmentAccessFlags,
  counts: Map<string, number>,
  parents: Map<string, { slug: string; name: string }>
): Promise<DepartmentSummary> {
  return {
    slug: row.slug,
    name: row.name,
    cluster: clusterOf(row.cluster),
    ...parentFields(row, parents),
    purpose: purposeOf(row),
    memberCount: access.canSeeDepartmentDetail ? (counts.get(row.id) ?? 0) : null,
    active: row.is_active,
    budgetOnly: access.canSeeBudget && !access.canSeeDepartmentDetail,
    access,
  };
}

function isListedHome(row: DepartmentRecord, foldedSources: Set<string>): boolean {
  if (!row.is_active || row.ministry_type === "part_time" || isBlockedHomeSlug(row.slug)) return false;
  if (foldedSources.has(row.id)) return false;
  if (row.slug in FOLDED_DEPARTMENTS) return false;
  return true;
}

export async function listVisibleDepartments(
  reader: Client
): Promise<{ data: DepartmentSummary[] | null; error: { message: string } | null; accessError?: boolean }> {
  const [rows, aliases] = await Promise.all([listDepartmentRows(reader), listAliases(reader)]);
  if (rows.error || aliases.error) {
    return { data: null, error: rows.error ?? aliases.error, accessError: true };
  }
  const foldedSources = new Set(aliases.data.map((alias) => alias.staff_ministry_id));
  const parents = new Map(rows.data.map((row) => [row.id, { slug: row.slug, name: row.name }]));
  const homes = rows.data
    .filter((row) => isListedHome(row, foldedSources))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const [decisions, fold] = await Promise.all([
    Promise.all(homes.map((home) => loadMinistryAccess(reader, home.id, { fold: false }))),
    foldedDetailIds(reader, rows.data),
  ]);
  if (!fold.ok || decisions.some((decision) => !decision.ok)) {
    return { data: null, error: { message: "access lookup failed" }, accessError: true };
  }
  const visible = homes.flatMap((home, index) => {
    const decision = decisions[index];
    if (!decision.ok) return [];
    const access = {
      ...decision.access,
      canSeeDepartmentDetail: decision.access.canSeeDepartmentDetail || fold.ids.has(home.id),
    };
    if (!access.canSeeDepartmentDetail && !access.canSeeBudget) return [];
    return [{ home, access }];
  });
  const detailIds = visible.filter((row) => row.access.canSeeDepartmentDetail).map((row) => row.home.id);
  const counts = detailIds.length === 0
    ? { data: new Map<string, number>(), error: null }
    : await countActiveMembers(createAdminClient(), detailIds);
  if (counts.error) return { data: null, error: counts.error };
  const summaries: DepartmentSummary[] = [];
  for (const row of visible) {
    summaries.push(await summaryFor(row.home, row.access, counts.data, parents));
  }
  return { data: summaries, error: null };
}

async function loadBudget(admin: Client, department: DepartmentRecord) {
  const links = await listBudgetLinks(admin, department.id);
  if (links.error) return { data: null, error: links.error };
  const projects = await listProjectsById(
    admin,
    links.data.flatMap((link) => (link.finance_project_id ? [link.finance_project_id] : []))
  );
  if (projects.error) return { data: null, error: projects.error };
  return {
    data: budgetLinks(department.slug, links.data, new Map(projects.data.map((project) => [project.id, project.name]))),
    error: null,
  };
}

export async function loadPeople(admin: Client, departmentId: string, emails: boolean) {
  const members = await listActiveMembers(admin, departmentId);
  if (members.error) return { data: null, error: members.error };
  const people = await loadPeopleById(admin, members.data.map((member) => member.user_id));
  if (people.error) return { data: null, error: people.error };
  return {
    data: members.data
      .map((member) => personOf(member, people.data, emails))
      .sort((a, b) => (a.capacity === b.capacity ? a.name.localeCompare(b.name) : a.capacity === "leader" ? -1 : 1)),
    error: null,
  };
}

export async function loadOkrs(admin: Client, department: DepartmentRecord): Promise<{ data: DepartmentOkrs | null; error: { message: string } | null }> {
  const cycle = await admin.from("okr_cycles").select("id, name, slug, is_current").eq("is_current", true).maybeSingle();
  if (cycle.error) return { data: null, error: { message: String(cycle.error.message ?? "Request failed") } };
  const current = cycle.data as { id: string; name: string; slug: string } | null;
  if (!current) {
    return { data: { departmentSlug: department.slug, cycleName: null, cycleSlug: null, href: "/okrs", objectives: [] }, error: null };
  }
  const objectives = await admin
    .from("okr_objectives")
    .select("id, title, position, scope, is_archived")
    .eq("cycle_id", current.id)
    .eq("staff_ministry_id", department.id)
    .eq("scope", "ministry")
    .eq("is_archived", false);
  if (objectives.error) return { data: null, error: { message: String(objectives.error.message ?? "Request failed") } };
  const rows = (Array.isArray(objectives.data) ? objectives.data : []) as Array<{ id: string; title: string; position: number }>;
  rows.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  let results: Array<{ id: string; objective_id: string; label: string | null; description: string; current_status: string | null; position: number }> = [];
  if (rows.length > 0) {
    const keyResults = await admin
      .from("okr_key_results")
      .select("id, objective_id, label, description, current_status, position")
      .in("objective_id", rows.map((row) => row.id));
    if (keyResults.error) return { data: null, error: { message: String(keyResults.error.message ?? "Request failed") } };
    results = Array.isArray(keyResults.data) ? keyResults.data : [];
  }
  return {
    data: {
      departmentSlug: department.slug,
      cycleName: current.name,
      cycleSlug: current.slug,
      href: `/okrs?cycle=${current.slug}`,
      objectives: rows.map((objective) => ({
        title: objective.title,
        keyResults: results
          .filter((result) => result.objective_id === objective.id)
          .sort((a, b) => a.position - b.position)
          .map((result) => ({
            id: result.id,
            label: result.label,
            description: result.description,
            status: okrStatus(result.current_status) satisfies OkrStatus,
          })),
      })),
    },
    error: null,
  };
}

export async function rocksForDepartments(
  admin: Client,
  departments: readonly DepartmentRecord[],
  quarter: string
): Promise<{ data: Map<string, Rock[]> | null; error: { message: string } | null }> {
  const grouped = new Map<string, Rock[]>();
  for (const department of departments) grouped.set(department.id, []);
  if (departments.length === 0) return { data: grouped, error: null };
  const rocks = await listRocksForQuarter(admin, quarter);
  if (rocks.error) return { data: null, error: rocks.error };
  const ids = new Set(departments.map((department) => department.id));
  const slugOf = new Map(departments.map((department) => [department.id, department.slug]));
  const mine = rocks.data.filter((rock) => ids.has(rock.staff_ministry_id));
  const named = await loadPeopleById(
    admin,
    mine.flatMap((rock) => (rock.owner_user_id ? [rock.owner_user_id] : []))
  );
  if (named.error) return { data: null, error: named.error };
  for (const rock of mine) {
    grouped.get(rock.staff_ministry_id)?.push({
      id: rock.id,
      departmentSlug: slugOf.get(rock.staff_ministry_id) ?? "",
      title: rock.title,
      owner: rock.owner_user_id ? personName(named.data.get(rock.owner_user_id)) : "",
      status: rock.status,
      dueOn: rock.due_on,
      quarter: rock.quarter,
    });
  }
  for (const list of grouped.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  return { data: grouped, error: null };
}

export async function loadQuarterRocks(admin: Client, department: DepartmentRecord, quarter: string): Promise<{ data: Rock[] | null; error: { message: string } | null }> {
  const rocks = await listRocks(admin, department.id, quarter);
  if (rocks.error) return { data: null, error: rocks.error };
  const named = await loadPeopleById(admin, rocks.data.flatMap((rock) => (rock.owner_user_id ? [rock.owner_user_id] : [])));
  if (named.error) return { data: null, error: named.error };
  return {
    data: rocks.data
      .map((rock) => ({
        id: rock.id,
        departmentSlug: department.slug,
        title: rock.title,
        owner: rock.owner_user_id ? personName(named.data.get(rock.owner_user_id)) : "",
        status: rock.status,
        dueOn: rock.due_on,
        quarter: rock.quarter,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    error: null,
  };
}

async function servicesRun(admin: Client, department: DepartmentRecord) {
  const grants = await listServiceOwnerRows(admin);
  if (grants.error) return { data: null, error: grants.error };
  const runs: NonNullable<DepartmentHome["servicesRun"]> = [];
  const seen = new Set<string>();
  for (const grant of grants.data as ServiceOwnerRow[]) {
    if (grant.staff_ministry_id !== department.id) continue;
    const role = grant.capability === "own" ? "owner" : grant.capability === "manage" ? "manager" : grant.capability === "moderate" ? "moderator" : null;
    if (!role) continue;
    const key = `${grant.service_key}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    runs.push({ serviceId: grant.service_key, role });
  }
  if (isEvangelismModeratorSlug(department.slug)) {
    const key = "evangelism:moderator";
    if (!seen.has(key)) runs.push({ serviceId: "evangelism", role: "moderator" });
  }
  return { data: runs, error: null };
}

async function subMinistries(admin: Client, department: DepartmentRecord, emails: boolean) {
  if (department.slug !== "finances_legal") return { data: [] as SubMinistry[], error: null };
  const child = await getDepartmentBySlug(admin, "donors_dev");
  if (child.error) return { data: null, error: child.error };
  if (!child.data) return { data: [] as SubMinistry[], error: null };
  const people = await loadPeople(admin, child.data.id, emails);
  if (people.error) return { data: null, error: people.error };
  return {
    data: [{
      slug: child.data.slug,
      name: child.data.name,
      purpose: purposeOf(child.data),
      memberCount: people.data.length,
      people: people.data,
    }],
    error: null,
  };
}

export async function buildDepartmentHome(
  admin: Client,
  userClient: Client,
  userId: string,
  access: DepartmentAccessFlags,
  department: DepartmentRecord
): Promise<{ data: DepartmentHome | null; error: { message: string } | null }> {
  const detail = access.canSeeDepartmentDetail;
  const seeBudget = access.canSeeBudget;
  if (!detail && !seeBudget) return { data: null, error: null };
  const counts = detail ? await countActiveMembers(admin) : { data: new Map<string, number>(), error: null };
  if (counts.error) return { data: null, error: counts.error };
  const all = await listDepartmentRows(admin);
  if (all.error) return { data: null, error: all.error };
  const parentMap = new Map(all.data.map((row) => [row.id, { slug: row.slug, name: row.name }]));
  const summary = await summaryFor(department, access, counts.data, parentMap);
  const budget = seeBudget ? await loadBudget(admin, department) : { data: null, error: null };
  if (budget.error) return { data: null, error: budget.error };
  const mine = detail ? await listActiveMemberships(userClient, userId) : { data: [], error: null };
  if (mine.error) return { data: null, error: mine.error };
  const viewer = viewerMemberships(mine.data, all.data);

  if (!detail) {
    return {
      data: {
        department: summary,
        access,
        viewerMemberships: [],
        people: null,
        okrs: null,
        rocks: null,
        budget: budget.data,
        servicesRun: null,
        subMinistries: null,
      },
      error: null,
    };
  }

  const [people, okrs, rocks, services, subs] = await Promise.all([
    loadPeople(admin, department.id, access.canSeePeopleEmails),
    loadOkrs(admin, department),
    loadQuarterRocks(admin, department, currentQuarter()),
    servicesRun(admin, department),
    subMinistries(admin, department, access.canSeePeopleEmails),
  ]);
  const failed = people.error ?? okrs.error ?? rocks.error ?? services.error ?? subs.error;
  if (failed) return { data: null, error: failed };
  return {
    data: {
      department: summary,
      access,
      viewerMemberships: viewer,
      people: people.data,
      okrs: okrs.data,
      rocks: rocks.data,
      budget: seeBudget ? budget.data : null,
      servicesRun: services.data,
      subMinistries: subs.data,
    },
    error: null,
  };
}

export async function rocksDueFor(
  admin: Client,
  homes: readonly DepartmentRecord[],
  detailIds: ReadonlySet<string>
): Promise<{ data: Rock[] | null; error: { message: string } | null }> {
  const visible = homes.filter((home) => detailIds.has(home.id));
  if (visible.length === 0) return { data: [], error: null };
  const quarter = currentQuarter();
  const rocks = await listRocksForQuarter(admin, quarter);
  if (rocks.error) return { data: null, error: rocks.error };
  const ids = new Set(visible.map((home) => home.id));
  const slugOf = new Map(visible.map((home) => [home.id, home.slug]));
  const today = saTodayIso();
  const horizon = addIsoDays(today, 14);
  const due = rocks.data.filter(
    (rock) => ids.has(rock.staff_ministry_id) && rock.status !== "done" && rock.due_on != null && rock.due_on <= horizon
  );
  const people = await loadPeopleById(admin, due.flatMap((rock) => (rock.owner_user_id ? [rock.owner_user_id] : [])));
  if (people.error) return { data: null, error: people.error };
  return {
    data: due
      .map((rock) => ({
        id: rock.id,
        departmentSlug: slugOf.get(rock.staff_ministry_id) ?? "",
        title: rock.title,
        owner: rock.owner_user_id ? personName(people.data.get(rock.owner_user_id)) : "",
        status: rock.status,
        dueOn: rock.due_on,
        quarter: rock.quarter,
      }))
      .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.title.localeCompare(b.title)),
    error: null,
  };
}

export type { DepartmentRecord };
