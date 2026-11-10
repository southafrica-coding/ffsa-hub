// Assembles department payloads. Finance-only viewers get the header and
// the budget; people, OKRs, rocks, services and sub-ministries are not read.

import { accessFlags, canOpenDepartment, canSeeBudget, canSeeDepartmentDetail, loadDepartmentGate, type DepartmentGate } from "./access";
import { FOLDED_DEPARTMENTS, isBlockedHomeSlug } from "./homes";
import { personName } from "./names";
import { addIsoDays, currentQuarter, saTodayIso } from "./quarter";
import {
  countActiveMembers,
  getDepartmentBySlug,
  listActiveMembers,
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
import { listServiceOwnerRows } from "@/lib/services/repository";
import type { ServiceOwnerRow } from "@/lib/services/seed";

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

export function viewerMemberships(gate: DepartmentGate, ministries: readonly { id: string; slug: string }[]): ViewerMembership[] {
  const slugOf = new Map(ministries.map((ministry) => [ministry.id, ministry.slug]));
  return gate.memberships.flatMap((membership) => {
    const slug = slugOf.get(membership.staff_ministry_id);
    if (!slug) return [];
    return [{
      departmentSlug: slug,
      capacity: membership.member_role === "leader" ? "leader" as const : "member" as const,
      isPointLeader: membership.is_point_leader,
    }];
  });
}

async function summaryFor(
  row: DepartmentRecord,
  gate: DepartmentGate,
  counts: Map<string, number>,
  parents: Map<string, string>
): Promise<DepartmentSummary> {
  const access = accessFlags(gate, row.id);
  const parentSlug = row.parent_id ? (parents.get(row.parent_id) ?? null) : null;
  const foldedChild = Object.prototype.hasOwnProperty.call(FOLDED_DEPARTMENTS, row.slug);
  return {
    slug: row.slug,
    name: row.name,
    cluster: clusterOf(row.cluster),
    parentSlug: foldedChild ? null : parentSlug,
    purpose: purposeOf(row),
    memberCount: counts.get(row.id) ?? 0,
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
  admin: Client,
  gate: DepartmentGate
): Promise<{ data: DepartmentSummary[] | null; error: { message: string } | null }> {
  const [rows, aliases, counts] = await Promise.all([
    listDepartmentRows(admin),
    listAliases(admin),
    countActiveMembers(admin),
  ]);
  if (rows.error || aliases.error || counts.error) {
    return { data: null, error: rows.error ?? aliases.error ?? counts.error };
  }
  const foldedSources = new Set(aliases.data.map((alias) => alias.staff_ministry_id));
  const parents = new Map(rows.data.map((row) => [row.id, row.slug]));
  const homes = rows.data
    .filter((row) => isListedHome(row, foldedSources) && canOpenDepartment(gate, row.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const summaries: DepartmentSummary[] = [];
  for (const home of homes) summaries.push(await summaryFor(home, gate, counts.data, parents));
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

async function loadPeople(admin: Client, departmentId: string, emails: boolean) {
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

async function loadOkrs(admin: Client, department: DepartmentRecord): Promise<{ data: DepartmentOkrs | null; error: { message: string } | null }> {
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

async function loadQuarterRocks(admin: Client, department: DepartmentRecord, quarter: string): Promise<{ data: Rock[] | null; error: { message: string } | null }> {
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
  if (department.slug === "media" || department.slug === "hulk") {
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
  gate: DepartmentGate,
  department: DepartmentRecord
): Promise<{ data: DepartmentHome | null; error: { message: string } | null }> {
  const detail = canSeeDepartmentDetail(gate, department.id);
  const seeBudget = canSeeBudget(gate, department.id);
  if (!detail && !seeBudget) return { data: null, error: null };
  const counts = await countActiveMembers(admin);
  if (counts.error) return { data: null, error: counts.error };
  const all = await listDepartmentRows(admin);
  if (all.error) return { data: null, error: all.error };
  const parentMap = new Map(all.data.map((row) => [row.id, row.slug]));
  const summary = await summaryFor(department, gate, counts.data, parentMap);
  const access = accessFlags(gate, department.id);
  const budget = seeBudget ? await loadBudget(admin, department) : { data: null, error: null };
  if (budget.error) return { data: null, error: budget.error };

  if (!detail) {
    return {
      data: {
        department: summary,
        access,
        viewerMemberships: viewerMemberships(gate, all.data),
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
      viewerMemberships: viewerMemberships(gate, all.data),
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
  gate: DepartmentGate,
  homes: readonly DepartmentRecord[]
): Promise<{ data: Rock[] | null; error: { message: string } | null }> {
  const visible = homes.filter((home) => canSeeDepartmentDetail(gate, home.id));
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
